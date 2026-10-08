import { randomUUID, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../src/db-node.js";
import { createRegistry } from "../../src/operations/registry.js";
import { UndoManager } from "../../src/undo/index.js";
import {
  SyncCoordinator,
  SyncStore,
  canonical,
  type Checkpoint,
  type CheckpointFile,
  type SyncTransport,
  type SyncSettings,
} from "../../src/sync/index.js";
function setup(cloud = new Map<string, Checkpoint>(), actor = "a") {
  const db = createTestDb(),
    store = new SyncStore(db, actor, randomUUID);
  let account = "account",
    published = 0;
  const transport: SyncTransport = {
    account: async () => account,
    list: async () =>
      [...cloud].map(([id, c]) => ({
        id,
        replica: c.replica,
        sequence: c.sequence,
        sha256: createHash("sha256").update(canonical(c)).digest("hex"),
      })),
    read: async (f: CheckpointFile) => cloud.get(f.id),
    reserveId: async () => randomUUID(),
    publish: async (id, c) => {
      cloud.set(id, structuredClone(c));
      published++;
    },
    localImages: async () => [],
    uploadImages: async () => {},
    downloadImages: async () => {},
    prune: async () => {},
    cancel: () => {},
  };
  let settings: SyncSettings = {
    replica: actor,
    enabled: false,
    account: null,
    lastSync: null,
    sequence: 0,
  };
  const changed = vi.fn(),
    engine = new SyncCoordinator(
      store,
      transport,
      settings,
      (s) => {
        settings = s;
      },
      changed,
    );
  return {
    db,
    store,
    transport,
    engine,
    changed,
    registry: createRegistry(db, new UndoManager(db), store),
    setAccount: (v: string) => {
      account = v;
    },
    settings: () => settings,
    published: () => published,
  };
}
describe("sync coordination", () => {
  it("converges two devices through verified complete checkpoints", async () => {
    const cloud = new Map<string, Checkpoint>(),
      a = setup(cloud, "a"),
      b = setup(cloud, "b");
    await a.registry.invoke("tasks:add", ["Mac", "tasks"]);
    await b.registry.invoke("tasks:add", ["Phone", "tasks"]);
    await a.engine.enable();
    await b.engine.enable();
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(a.store.records()).toEqual(b.store.records());
    expect(a.store.records().filter((r) => r.kind === "task")).toHaveLength(2);
    expect(a.engine.status()).toMatchObject({
      enabled: true,
      syncing: false,
      pending: false,
      error: null,
    });
  });
  it("coalesces requests and always clears uploading after rejection", async () => {
    const a = setup();
    await a.engine.enable();
    a.transport.list = async () => {
      throw new Error("offline");
    };
    await Promise.all([a.engine.syncNow(), a.engine.syncNow()]);
    expect(a.engine.status()).toMatchObject({
      syncing: false,
      error: "offline",
    });
  });
  it("retries an accepted upload with the identical file ID and content", async () => {
    const a = setup(),
      publish = a.transport.publish;
    let first = true;
    const attempts: string[] = [];
    a.transport.publish = async (id, c) => {
      attempts.push(id);
      await publish(id, c);
      if (first) {
        first = false;
        throw new Error("timeout");
      }
    };
    await a.engine.enable();
    expect(a.engine.status()).toMatchObject({
      syncing: false,
      pending: true,
      error: "timeout",
    });
    await a.engine.syncNow();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toBe(attempts[1]);
    expect(a.engine.status()).toMatchObject({
      syncing: false,
      pending: false,
      error: null,
    });
  });
  it("does not apply a download completed after pause", async () => {
    const cloud = new Map<string, Checkpoint>(),
      a = setup(cloud, "a"),
      b = setup(cloud, "b");
    await a.engine.enable();
    await b.engine.enable();
    await a.registry.invoke("tasks:add", ["Incoming", "tasks"]);
    await a.engine.syncNow();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = b.transport.read;
    b.transport.read = async (f) => {
      await held;
      return read(f);
    };
    const running = b.engine.syncNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    b.engine.pause();
    release();
    await running;
    expect(b.store.records().filter((r) => r.kind === "task")).toHaveLength(0);
    expect(b.engine.status()).toMatchObject({ enabled: false, syncing: false });
  });
  it("keeps edits made while a checkpoint is uploading pending", async () => {
    const a = setup(),
      publish = a.transport.publish;
    a.transport.publish = async (id, c) => {
      await a.registry.invoke("tasks:add", ["During upload", "tasks"]);
      await publish(id, c);
    };
    await a.engine.enable();
    expect(a.engine.status().pending).toBe(true);
  });
  it("pauses before reading or publishing to a different Google account", async () => {
    const a = setup();
    await a.engine.enable();
    const count = a.published();
    a.setAccount("other");
    await a.engine.syncNow();
    expect(a.published()).toBe(count);
    expect(a.engine.status()).toMatchObject({ enabled: false, syncing: false });
    await expect(a.engine.enable()).rejects.toThrow("same Google account");
  });
  it("does not start another sync while Android is hidden", async () => {
    const a = setup();
    await a.engine.enable();
    a.engine.foreground(false);
    const list = vi.spyOn(a.transport, "list");
    await a.engine.syncNow();
    expect(list).not.toHaveBeenCalled();
  });
  it("defers incoming changes while an editor is open and resumes after it closes", async () => {
    const cloud = new Map<string, Checkpoint>(),
      a = setup(cloud, "a"),
      b = setup(cloud, "b");
    await a.engine.enable();
    await b.engine.enable();
    await a.registry.invoke("tasks:add", ["Incoming", "tasks"]);
    await a.engine.syncNow();
    const read = b.transport.read;
    b.transport.read = async (file) => {
      b.engine.setEditing(true);
      return read(file);
    };
    await b.engine.syncNow();
    expect(b.store.records().filter((r) => r.kind === "task")).toHaveLength(0);
    b.transport.read = read;
    b.engine.setEditing(false);
    await b.engine.syncNow();
    expect(b.store.records().filter((r) => r.kind === "task")).toHaveLength(1);
    expect(b.engine.status()).toMatchObject({ syncing: false, error: null });
  });
});
