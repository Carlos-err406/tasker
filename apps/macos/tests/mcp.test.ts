import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startService } from "../src/service/server.js";
import { ServiceClient } from "../src/mcp/client.js";
import { createMcpServer } from "../src/mcp/server.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "tasker-mcp-test-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const service = await startService({ directory, port: 0 });
  cleanups.push(() => service.close().catch(() => {}));
  const server = createMcpServer(new ServiceClient(directory), "test");
  const client = new Client({ name: "test", version: "test" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  cleanups.push(() => client.close());
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text?: string; data?: string; mimeType?: string }[];
    };
    const text = result.content.find((c) => c.type === "text")?.text ?? "";
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { ...result, data };
  };
  return { service, directory, client, call, rpc: new ServiceClient(directory) };
}

describe("Tasker MCP server", () => {
  it("describes the task syntax and every tool", async () => {
    const { client } = await fixture();
    expect(client.getInstructions()).toContain(">list-name");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_task",
      "create_list",
      "delete_list",
      "delete_task",
      "edit_task",
      "get_task",
      "list_lists",
      "list_tasks",
      "move_task",
      "rename_list",
      "restore_task",
      "search_tasks",
      "set_task_status",
    ]);
    expect(tools.find((t) => t.name === "get_task")!.annotations?.readOnlyHint).toBe(true);
  });

  it("creates, reads, searches and edits tasks", async () => {
    const { call } = await fixture();
    expect((await call("list_lists")).data.default).toBeTruthy();

    const added = await call("add_task", { text: "Write the report\n\nDetails here\np1 #work" });
    expect(added.data).toMatchObject({ title: "Write the report", priority: "high", tags: ["work"], status: "pending" });
    const id: string = added.data.id;

    const child = await call("add_task", { text: `Gather numbers\n^${id}` });
    const task = await call("get_task", { id });
    // Adding a child records it on the parent's metadata line too.
    expect(task.data.description).toBe(`Write the report\n\nDetails here\n-^${child.data.id} p1 #work`);
    expect(task.data.subtasks.map((t: { id: string }) => t.id)).toEqual([child.data.id]);

    expect((await call("search_tasks", { query: "tag:work report" })).data.map((t: { id: string }) => t.id)).toEqual([id]);

    expect((await call("edit_task", { id, text: "Write the final report\np2" })).isError).toBe(false);
    expect((await call("get_task", { id })).data).toMatchObject({ title: "Write the final report", priority: "medium", tags: [] });
  });

  it("changes status, moves, trashes and restores", async () => {
    const { call, rpc } = await fixture();
    const id = (await call("add_task", { text: "Ship it" })).data.id;
    expect((await call("add_task", { text: "Nowhere\n>side-project" })).data).toContain("No list matches");
    await rpc.rpc("lists:create", "side-project");
    const other = await call("add_task", { text: "Make room\n>side-project" });
    expect(other.data.list).toBe("side-project");

    expect((await call("set_task_status", { id, status: "done" })).isError).toBe(false);
    expect((await call("list_tasks", { status: ["done"] })).data.map((t: { id: string }) => t.id)).toEqual([id]);

    expect((await call("move_task", { id, list: "side-project" })).isError).toBe(false);
    expect((await call("list_tasks", { list: "side-project" })).data.map((t: { id: string }) => t.id).sort()).toEqual(
      [id, other.data.id].sort(),
    );

    expect((await call("delete_task", { id })).isError).toBe(false);
    expect((await call("get_task", { id })).isError).toBe(true);
    expect((await call("restore_task", { id })).isError).toBe(false);
    expect((await call("get_task", { id })).data.status).toBe("done");

    const missing = await call("set_task_status", { id: "zzz", status: "done" });
    expect(missing).toMatchObject({ isError: true, data: "No task with ID zzz." });
  });

  it("creates, renames and deletes lists like the app allows", async () => {
    const { call } = await fixture();
    expect((await call("create_list", { name: " side project " })).data).toBe('Created list "side project"');
    expect((await call("create_list", { name: "side project" })).data).toBe('A list named "side project" already exists.');
    expect((await call("create_list", { name: "  " })).isError).toBe(true);

    expect((await call("rename_list", { name: "side project", new_name: "hobby" })).isError).toBe(false);
    await call("add_task", { text: "One", list: "hobby" });
    const two = (await call("add_task", { text: "Two", list: "hobby" })).data.id;
    await call("delete_task", { id: two });
    expect((await call("list_lists")).data.lists).toEqual(["tasks", "hobby"]);

    for (const [name, args, message] of [
      ["rename_list", { name: "tasks", new_name: "inbox" }, '"tasks" is the default list and can\'t be changed.'],
      ["delete_list", { name: "tasks" }, '"tasks" is the default list and can\'t be changed.'],
      ["delete_list", { name: "nope" }, 'No list named "nope".'],
      ["rename_list", { name: "hobby", new_name: "tasks" }, 'A list named "tasks" already exists.'],
    ] as const)
      expect(await call(name, args)).toMatchObject({ isError: true, data: message });

    expect((await call("delete_list", { name: "hobby" })).data).toBe('Deleted list "hobby" and its 1 task.');
    expect((await call("list_lists")).data.lists).toEqual(["tasks"]);
    expect((await call("get_task", { id: two })).isError).toBe(true);
  });

  it("returns a task's images as image content", async () => {
    const { call, service } = await fixture();
    const session = await fetch(service.origin + "/session", {
      method: "POST",
      headers: { origin: service.origin, "x-tasker-bootstrap": service.token },
    });
    const upload = await fetch(service.origin + "/attachments", {
      method: "POST",
      headers: {
        origin: service.origin,
        cookie: session.headers.get("set-cookie")!.split(";")[0]!,
        "content-type": "image/png",
        "x-tasker-request": "1",
      },
      body: PNG,
    });
    const { reference } = (await upload.json()) as { reference: string };
    const id = (await call("add_task", { text: `Bad layout\n\n![shot](${reference})\n![again](${reference})` })).data.id;
    const task = await call("get_task", { id });
    const images = task.content.filter((c) => c.type === "image");
    expect(images).toEqual([{ type: "image", mimeType: "image/png", data: PNG.toString("base64") }]);
  });

  it("refreshes an open popover after agent edits", async () => {
    const { call, service } = await fixture();
    const session = await fetch(service.origin + "/session", {
      method: "POST",
      headers: { origin: service.origin, "x-tasker-bootstrap": service.token },
    });
    const revision = async () => {
      const response = await fetch(service.origin + "/manage", {
        method: "POST",
        headers: {
          origin: service.origin,
          cookie: session.headers.get("set-cookie")!.split(";")[0]!,
          "content-type": "application/json",
          "x-tasker-request": "1",
        },
        body: JSON.stringify({ action: "sync-status" }),
      });
      return ((await response.json()) as { revision: number }).revision;
    };
    const before = await revision();
    await call("list_tasks");
    expect(await revision()).toBe(before);
    await call("add_task", { text: "From an agent" });
    expect(await revision()).toBeGreaterThan(before);
  });

  it("explains when Tasker isn't running and reconnects after a restart", async () => {
    const { call, service, directory } = await fixture();
    await call("list_lists");
    await service.close();
    const down = await call("list_lists");
    expect(down.isError).toBe(true);
    expect(down.data).toContain("Tasker isn't running");
    // A restarted service publishes a new address and token.
    const other = await mkdtemp(join(tmpdir(), "tasker-mcp-test-"));
    cleanups.push(() => rm(other, { recursive: true, force: true }));
    const restarted = await startService({ directory: other, port: 0 });
    cleanups.push(() => restarted.close());
    await copyFile(join(other, "runtime.json"), join(directory, "runtime.json"));
    expect((await call("list_lists")).isError).toBeFalsy();
  });
});
