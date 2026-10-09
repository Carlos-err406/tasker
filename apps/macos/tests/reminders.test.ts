import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startService } from "../src/service/server.js";
import { ServiceClient } from "../src/mcp/client.js";
import type { Reminder } from "@tasker/core";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("the service posts each due reminder once, respects the setting, and skips finished tasks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tasker-reminders-test-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const posted: Reminder[] = [];
  let now = new Date(2026, 9, 10, 8, 0);
  const service = await startService({
    directory,
    port: 0,
    notify: async (r) => void posted.push(r),
    now: () => now,
  });
  cleanups.push(() => service.close());
  const client = new ServiceClient(directory);
  const add = async (text: string) => (await client.rpc<{ task: { id: string } }>("tasks:add", text, "tasks")).task.id;
  const show = await add("Watch Frieren\n@2026-10-10 6:30pm *weekly");
  await add("Pay rent\n@2026-10-10");
  const done = await add("Already done\n@2026-10-10");
  await client.rpc("tasks:setStatus", done, 2);

  await service.reminders!.check();
  expect(posted).toEqual([]);

  now = new Date(2026, 9, 10, 9, 0);
  await service.reminders!.check();
  expect(posted.map((r) => [r.title, r.time])).toEqual([["Pay rent", null]]);
  await service.reminders!.check();
  expect(posted).toHaveLength(1);

  await client.rpc("settings:set", "notifications", false);
  now = new Date(2026, 9, 10, 18, 30);
  await service.reminders!.check();
  expect(posted).toHaveLength(1);

  await client.rpc("settings:set", "notifications", true);
  await service.reminders!.check();
  expect(posted.map((r) => r.taskId)).toEqual([expect.any(String), show]);
  expect(posted[1]).toMatchObject({ title: "Watch Frieren", time: "6:30pm", listName: "tasks" });
});
