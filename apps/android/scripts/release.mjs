import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Optional private local configuration; CI supplies the same fields as environment variables.
const env = { ...process.env };
if (env.TASKER_ANDROID_SIGNING_FILE) {
  const value = JSON.parse(
    readFileSync(env.TASKER_ANDROID_SIGNING_FILE, "utf8"),
  );
  Object.assign(env, {
    TASKER_ANDROID_KEYSTORE: value.keystore,
    TASKER_ANDROID_STORE_PASSWORD: value.storePassword,
    TASKER_ANDROID_KEY_ALIAS: value.keyAlias,
    TASKER_ANDROID_KEY_PASSWORD: value.keyPassword,
  });
}
for (const key of [
  "TASKER_ANDROID_KEYSTORE",
  "TASKER_ANDROID_STORE_PASSWORD",
  "TASKER_ANDROID_KEY_ALIAS",
  "TASKER_ANDROID_KEY_PASSWORD",
]) {
  if (!env[key])
    throw new Error(
      `Missing ${key}; provide a private TASKER_ANDROID_SIGNING_FILE or signing environment variables`,
    );
}
for (const [script, args] of [
  [
    new URL("./gradle.mjs", import.meta.url),
    ["--no-daemon", "assembleRelease", "lintRelease"],
  ],
  [new URL("../../../scripts/package-android.mjs", import.meta.url), []],
]) {
  const result = spawnSync(process.execPath, [fileURLToPath(script), ...args], {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
