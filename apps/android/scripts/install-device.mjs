import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const apk = fileURLToPath(
  new URL(
    "../native/app/build/outputs/apk/debug/app-debug.apk",
    import.meta.url,
  ),
);
const selector = process.env.ANDROID_SERIAL
  ? ["-s", process.env.ANDROID_SERIAL]
  : [];
for (const args of [
  ["install", "-r", apk],
  [
    "shell",
    "am",
    "start",
    "-n",
    "org.tasker.android.debug/org.tasker.android.MainActivity",
  ],
]) {
  const result = spawnSync("adb", [...selector, ...args], { stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
