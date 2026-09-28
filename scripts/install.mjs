import { setTimeout as delay } from "node:timers/promises";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory =
  process.env.TASKER_SWIFTBAR_DATA_DIR ??
  join(homedir(), "Library/Application Support/tasker-swiftbar");
const pluginDir =
  process.env.TASKER_SWIFTBAR_PLUGIN_DIR ?? join(homedir(), ".config/swiftbar");
const agents =
  process.env.TASKER_SWIFTBAR_LAUNCHAGENT_DIR ??
  join(homedir(), "Library/LaunchAgents");
const dry = process.argv.includes("--dry-run"),
  uninstall = process.argv.includes("--uninstall");
const label = "org.tasker-swiftbar.service",
  plist = join(agents, label + ".plist"),
  plugin = join(pluginDir, "Tasker.1m.sh");
const target = `gui/${process.getuid()}/${label}`;
const launch = (args, optional = false) => {
  if (dry) return;
  try {
    execFileSync("/bin/launchctl", args, { stdio: "pipe" });
  } catch (error) {
    if (!optional) throw error;
  }
};
if (uninstall) {
  launch(["bootout", target], true);
  rmSync(plist, { force: true });
  if (
    existsSync(plugin) &&
    readFileSync(plugin, "utf8").includes("# Managed by tasker-swiftbar")
  )
    rmSync(plugin);
  console.log(
    "Removed Tasker service and plugin. Tasks, backups and Keychain credentials are preserved.",
  );
  process.exit(0);
}
if (
  !existsSync(join(root, "apps/macos/dist/index.html")) ||
  !existsSync(join(root, "apps/macos/dist-service/service/main.js"))
)
  throw new Error("Run pnpm build before installing");
if (
  existsSync(plugin) &&
  !readFileSync(plugin, "utf8").includes("# Managed by tasker-swiftbar")
)
  throw new Error(
    "An unmanaged Tasker.1m.sh already exists; choose TASKER_SWIFTBAR_PLUGIN_DIR",
  );
for (const path of [directory, pluginDir, agents])
  mkdirSync(path, { recursive: true, mode: 0o700 });
const xml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const shell = (s) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
writeFileSync(
  plugin,
  `#!/bin/bash
# Managed by tasker-swiftbar
export TASKER_SWIFTBAR_DATA_DIR=${shell(directory)}
exec /bin/bash ${shell(join(root, "apps/macos/plugin/Tasker.1m.sh"))}
`,
  { mode: 0o755 },
);
chmodSync(plugin, 0o755);
writeFileSync(
  plist,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(root, "apps/macos/dist-service/service/main.js"))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>TASKER_SWIFTBAR_DATA_DIR</key><string>${xml(directory)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(directory, "service.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(directory, "service-error.log"))}</string>
</dict></plist>`,
  { mode: 0o600 },
);
execFileSync("/usr/bin/plutil", ["-lint", plist], { stdio: "pipe" });
launch(["bootout", target], true);
// launchd can report successful bootout before unregistering the old label.
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    launch(["bootstrap", `gui/${process.getuid()}`, plist]);
    break;
  } catch (error) {
    if (attempt === 19) throw error;
    await delay(250);
  }
}
if (!dry) {
  try {
    execFileSync("/usr/bin/open", ["swiftbar://refreshallplugins"], {
      stdio: "pipe",
    });
  } catch {
    console.warn(
      "Service installed. Open your SwiftBar build to load Tasker; the refresh URL is currently unavailable.",
    );
  }
}
console.log(
  dry
    ? "Validated installation files; service launch skipped."
    : "Tasker installed. Open its SwiftBar item.",
);
