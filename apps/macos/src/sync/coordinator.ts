import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { getRawDb, type TaskerDb } from "@tasker/core";
import {
  SyncCoordinator,
  SyncDrive,
  SyncStore,
  type SyncSettings,
  type SyncHttp,
  type SyncHttpResponse,
} from "@tasker/core/sync";
import type { BackupCoordinator } from "../backup/coordinator.js";

export function createMacSync(
  db: TaskerDb,
  directory: string,
  google: BackupCoordinator,
  changed: () => void,
) {
  const path = join(directory, "sync-state.json");
  type State = SyncSettings & {
    restoreBaseline?: ReturnType<SyncStore["exportRestoreBaseline"]>;
  };
  let settings: State = {
    replica: randomUUID(),
    enabled: false,
    account: null,
    lastSync: null,
    sequence: 0,
  };
  if (existsSync(path)) {
    const candidate = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof candidate.replica !== "string" ||
      !/^[a-f0-9-]{36}$/.test(candidate.replica) ||
      typeof candidate.enabled !== "boolean" ||
      !Number.isSafeInteger(candidate.sequence) ||
      candidate.sequence < 0
    )
      throw new Error("Invalid local sync settings");
    settings = candidate;
  }
  const save = (value: SyncSettings) => {
    settings = { ...settings, ...value };
    writeFileSync(path + ".tmp", JSON.stringify(settings), { mode: 0o600 });
    renameSync(path + ".tmp", path);
  };
  save(settings);
  if (settings.restoreBaseline)
    for (const table of ["sync_records", "sync_aliases", "sync_meta"])
      getRawDb(db).exec(`DROP TABLE IF EXISTS ${table}`);
  const store = new SyncStore(db, settings.replica, randomUUID);
  if (settings.restoreBaseline) {
    store.rebaseAfterRestore(settings.restoreBaseline);
    delete settings.restoreBaseline;
    save(settings);
  }
  let cancelled = new AbortController();
  const http: SyncHttp = {
    cancel() {
      cancelled.abort();
      cancelled = new AbortController();
    },
    async request(
      url,
      method,
      headers,
      bytes,
      maxBytes,
    ): Promise<SyncHttpResponse> {
      const signal = AbortSignal.any([
        cancelled.signal,
        AbortSignal.timeout(120000),
      ]);
      const token = await google.syncAccessToken();
      const response = await fetch(url, {
        method,
        headers: { ...headers, Authorization: `Bearer ${token}` },
        ...(bytes ? { body: new Uint8Array(bytes) } : {}),
        redirect: "error",
        signal,
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader)
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxBytes)
              throw new Error("Sync response exceeds its size limit");
            chunks.push(value);
          }
        } catch (error) {
          await reader.cancel();
          throw error;
        }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        bytes: new Uint8Array(Buffer.concat(chunks)),
      };
    },
  };
  const drive = new SyncDrive(http, {
    async read(id) {
      const r = getRawDb(db)
        .prepare("SELECT data,mime_type,created_at FROM attachments WHERE id=?")
        .get(id) as
        | { data: Buffer; mime_type: string; created_at: string }
        | undefined;
      return r
        ? {
            bytes: new Uint8Array(r.data),
            mimeType: r.mime_type,
            createdAt: r.created_at,
          }
        : null;
    },
    async write(image, bytes) {
      getRawDb(db)
        .prepare(
          "INSERT OR IGNORE INTO attachments(id,mime_type,byte_length,created_at,data) VALUES(?,?,?,?,?)",
        )
        .run(
          image.id,
          image.mimeType,
          bytes.length,
          image.createdAt,
          Buffer.from(bytes),
        );
    },
  });
  const engine = new SyncCoordinator(
    store,
    drive,
    settings,
    save,
    changed,
    async () => {
      google.local.create("safety");
    },
  );
  return {
    store,
    engine,
    settings: () => settings,
    beforeRestore() {
      engine.pause();
      engine.close();
      settings = {
        ...settings,
        replica: randomUUID(),
        sequence: 0,
        lastSync: null,
        restoreBaseline: store.exportRestoreBaseline(),
      };
      save(settings);
    },
  };
}
