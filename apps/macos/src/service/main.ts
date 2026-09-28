import { startService } from "./server.js";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadGoogleClient } from "../google/client-config.js";
const directory =
  process.env["TASKER_SWIFTBAR_DATA_DIR"] ??
  join(homedir(), "Library/Application Support/tasker-swiftbar");
const google = loadGoogleClient(
  directory,
  process.env["TASKER_GOOGLE_CLIENT_JSON"],
);
const service = await startService({
  directory,
  google,
  assets: fileURLToPath(new URL("../../dist/", import.meta.url)),
  port: Number(process.env["TASKER_SWIFTBAR_PORT"] ?? 0),
});
console.log(`Tasker service listening at ${service.origin}`);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void service.close().then(() => process.exit(0));
  });
