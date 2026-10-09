import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ServiceClient } from "./client.js";
import { createMcpServer } from "./server.js";

const directory =
  process.env["TASKER_SWIFTBAR_DATA_DIR"] ??
  join(homedir(), "Library/Application Support/tasker-swiftbar");
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
await createMcpServer(new ServiceClient(directory), version).connect(
  new StdioServerTransport(),
);
