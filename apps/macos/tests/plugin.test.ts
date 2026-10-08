import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
const exec = promisify(execFile),
  cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "tasker-plugin-"));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function plugin(env: Record<string, string>) {
  return (
    await exec("/bin/bash", [resolve("plugin/Tasker.1m.sh")], {
      env: { ...process.env, ...env },
    })
  ).stdout;
}
it("keeps the original template icon when the service is unavailable", async () => {
  const data = await directory();
  const output = await plugin({
    TASKER_SWIFTBAR_DATA_DIR: data,
    TASKER_SWIFTBAR_AUTOSTART: "0",
  });
  const first = output.split("\n")[0]!;
  expect(first.includes("templateImage=")).toBe(true);
  const encoded = first.match(/templateImage=([^ ]+)/)![1]!;
  expect(
    createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex"),
  ).toBe("aa3586a286078d6989ae4027bfe32bd79780ca6a73c852c82162dc3e90058e7f");
  expect(first.startsWith("Tasker")).toBe(false);
  expect(output.includes("Service unavailable")).toBe(true);
});
it("recovers a missing launch agent without creating a second service", async () => {
  const data = await directory();
  // Never use the bundled production OAuth identity or real account grants in tests.
  await writeFile(
    join(data, "google-client.json"),
    JSON.stringify({
      installed: {
        client_id: `test-${randomUUID()}.apps.googleusercontent.com`,
      },
    }),
  );
  const label = "org.tasker-swiftbar.test." + randomUUID(),
    target = `gui/${process.getuid!()}/${label}`;
  const plist = join(data, "service.plist");
  const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  await writeFile(
    plist,
    `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(resolve("dist-service/service/main.js"))}</string></array><key>EnvironmentVariables</key><dict><key>TASKER_SWIFTBAR_DATA_DIR</key><string>${xml(data)}</string></dict><key>RunAtLoad</key><true/></dict></plist>`,
  );
  cleanups.push(() =>
    exec("/bin/launchctl", ["bootout", target]).catch(() => {}),
  );
  const env = {
    TASKER_SWIFTBAR_DATA_DIR: data,
    TASKER_SWIFTBAR_SERVICE_LABEL: label,
    TASKER_SWIFTBAR_LAUNCHAGENT_PATH: plist,
  };
  const first = await plugin(env);
  expect(first.includes("webview=true")).toBe(true);
  const runtime = JSON.parse(
    await readFile(join(data, "runtime.json"), "utf8"),
  );
  const second = await plugin(env);
  expect(second.includes("webview=true")).toBe(true);
  expect(
    JSON.parse(await readFile(join(data, "runtime.json"), "utf8")).pid,
  ).toBe(runtime.pid);
  expect((await fetch(runtime.origin + "/health")).status).toBe(204);
}, 15000);
it("keeps the popover open while overlays such as Raycast take focus", async () => {
  // SwiftBar reads metadata from the installed wrapper, not the script it runs.
  for (const file of ["plugin/Tasker.1m.sh", "../../scripts/install.mjs"]) {
    expect(await readFile(resolve(file), "utf8")).toContain(
      "<swiftbar.keepWebViewOpenForOverlays>true</swiftbar.keepWebViewOpenForOverlays>",
    );
  }
});
