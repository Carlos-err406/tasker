import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
const cwd = fileURLToPath(new URL("../native/", import.meta.url));
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  join(
    homedir(),
    process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk",
  );
const result = spawnSync(
  process.platform === "win32" ? "gradlew.bat" : "./gradlew",
  process.argv.slice(2),
  { cwd, stdio: "inherit", env: { ...process.env, ANDROID_HOME: sdk } },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
