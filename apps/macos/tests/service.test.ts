import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startService, type ServiceOptions } from "../src/service/server.js";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(options: Partial<ServiceOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "tasker-swiftbar-test-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const service = await startService({ ...options, directory, port: 0 });
  cleanups.push(() => service.close());
  const session = await fetch(service.origin + "/session", {
    method: "POST",
    headers: { origin: service.origin, "x-tasker-bootstrap": service.token },
  });
  expect(session.status).toBe(204);
  const cookie = session.headers.get("set-cookie")!.split(";")[0]!;
  const rpc = (channel: string, args: unknown[] = []) =>
    fetch(service.origin + "/rpc", {
      method: "POST",
      headers: {
        origin: service.origin,
        cookie,
        "content-type": "application/json",
        "x-tasker-request": "1",
      },
      body: JSON.stringify({ channel, args }),
    });
  return { ...service, directory, cookie, rpc };
}
describe("private loopback task service", () => {
  it("keeps restored changes pending with sync paused and its device identity outside the backup", async () => {
    const s = await fixture({ automaticBackups: false });
    const manage = async (payload: Record<string, unknown>) => {
      const response = await fetch(s.origin + "/manage", {
        method: "POST",
        headers: {
          origin: s.origin,
          cookie: s.cookie,
          "content-type": "application/json",
          "x-tasker-request": "1",
        },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const before = JSON.parse(
      await readFile(join(s.directory, "sync-state.json"), "utf8"),
    );
    const [, added] = await (
      await s.rpc("tasks:add", ["Before restore", "tasks"])
    ).json();
    const backup = await manage({ action: "backup" });
    await s.rpc("tasks:rename", [added.task.id, "After backup"]);
    await manage({ action: "restore", id: backup.id, confirm: true });
    const [, restored] = await (
      await s.rpc("tasks:getById", [added.task.id])
    ).json();
    expect(restored.description).toBe("Before restore");
    expect(await manage({ action: "sync-status" })).toMatchObject({
      enabled: false,
      syncing: false,
      pending: true,
      lastSync: null,
    });
    const after = JSON.parse(
      await readFile(join(s.directory, "sync-state.json"), "utf8"),
    );
    expect(after.replica).not.toBe(before.replica);
    expect(after.restoreBaseline).toBeUndefined();
    await s.rpc("tasks:rename", [added.task.id, "After restore"]);
    const [error] = await (await s.rpc("undo:undo")).json();
    expect(error).toBeNull();
  });
  it("rejects unauthenticated, foreign-origin, and malformed requests", async () => {
    const s = await fixture();
    expect((await fetch(s.origin + "/rpc", { method: "POST" })).status).toBe(
      403,
    );
    expect(
      (
        await fetch(s.origin + "/session", {
          method: "POST",
          headers: {
            origin: "https://example.com",
            "x-tasker-bootstrap": s.token,
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(s.origin + "/rpc", {
          method: "POST",
          headers: {
            origin: "https://example.com",
            cookie: s.cookie,
            "content-type": "application/json",
            "x-tasker-request": "1",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect((await s.rpc("tasks:setStatus", ["abc", 99])).status).toBe(400);
    expect((await s.rpc("__proto__")).status).toBe(400);
  });
  it("persists metadata and checkbox edits, and undo restores the description", async () => {
    const s = await fixture();
    const [, added] = await (
      await s.rpc("tasks:add", [
        "Title\n\n- [ ] same\n- [ ] same\np1 #test",
        "tasks",
      ])
    ).json();
    const id = added.task.id;
    const edited = "Title\n\n- [ ] same\n- [x] same\np1 #test";
    expect((await s.rpc("tasks:rename", [id, edited])).status).toBe(200);
    const [, task] = await (await s.rpc("tasks:getById", [id])).json();
    expect(task.description).toBe(edited);
    expect(task.tags).toEqual(["test"]);
    await s.rpc("undo:undo");
    const [, previous] = await (await s.rpc("tasks:getById", [id])).json();
    expect(previous.description).toContain("- [ ] same\n- [ ] same");
  });
});

it("rejects a second service and preserves the first listener", async () => {
  const s = await fixture();
  await expect(startService({ directory: s.directory })).rejects.toThrow(
    "already running",
  );
  expect((await s.rpc("tasks:getAll")).status).toBe(200);
  const status = await new Promise<number | undefined>((ok, fail) => {
    const req = request(
      s.origin + "/health",
      { headers: { host: "evil.example" } },
      (res) => {
        res.resume();
        ok(res.statusCode);
      },
    );
    req.on("error", fail);
    req.end();
  });
  expect(status).toBe(403);
});
it("requires confirmation for restore and protects image bytes", async () => {
  const s = await fixture();
  const headers = {
    origin: s.origin,
    cookie: s.cookie,
    "x-tasker-request": "1",
  };
  const image = await (
    await fetch(s.origin + "/attachments", {
      method: "POST",
      headers: { ...headers, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71]),
    })
  ).json();
  expect((await fetch(s.origin + image.reference)).status).toBe(403);
  expect(
    new Uint8Array(
      await (
        await fetch(s.origin + image.reference, {
          headers: { cookie: s.cookie },
        })
      ).arrayBuffer(),
    ),
  ).toEqual(new Uint8Array([137, 80, 78, 71]));
  const backup = await (
    await fetch(s.origin + "/manage", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "backup" }),
    })
  ).json();
  expect(
    (
      await fetch(s.origin + "/manage", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "restore", id: backup.id }),
      })
    ).status,
  ).toBe(400);
});

it("opens stored image bytes through a private native-viewer file and rejects arbitrary paths", async () => {
  const opened: string[] = [];
  const s = await fixture({
    openTarget: async (target) => {
      opened.push(target);
    },
  });
  const headers = {
    origin: s.origin,
    cookie: s.cookie,
    "x-tasker-request": "1",
  };
  const bytes = Buffer.from([137, 80, 78, 71]);
  const image = await (
    await fetch(s.origin + "/attachments", {
      method: "POST",
      headers: { ...headers, "content-type": "image/png" },
      body: bytes,
    })
  ).json();
  const open = (url: string, requestHeaders = headers) =>
    fetch(s.origin + "/manage", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ action: "open", url }),
    });
  expect((await open(image.reference, { ...headers, cookie: "" })).status).toBe(
    403,
  );
  expect(opened).toHaveLength(0);
  expect((await open(image.reference)).status).toBe(200);
  cleanups.splice(cleanups.length - 1, 0, async () => {
    await expect(stat(opened[0]!)).rejects.toMatchObject({ code: "ENOENT" });
  });
  expect(opened[0]).toMatch(/tasker-images-[^/]+\/[a-f0-9-]+\.png$/);
  expect(await readFile(opened[0]!)).toEqual(bytes);
  expect((await stat(opened[0]!)).mode & 0o777).toBe(0o600);
  for (const url of [
    "file:///etc/passwd",
    "/attachments/../../etc/passwd",
    "javascript:alert(1)",
  ])
    expect((await open(url)).status).toBe(400);
  expect(
    (await open("/attachments/00000000-0000-0000-0000-000000000000")).status,
  ).toBe(404);
  expect(opened).toHaveLength(1);
  expect((await open("https://example.com/image.png")).status).toBe(200);
  expect(opened[1]).toBe("https://example.com/image.png");
});
