import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Only the tag publication job receives this secret. Never print it.
const value = JSON.parse(process.env.TASKER_ANDROID_SIGNING_JSON || "null");
if (
  !value ||
  !["keystoreBase64", "storePassword", "keyAlias", "keyPassword"].every(
    (key) => typeof value[key] === "string" && value[key],
  )
)
  throw new Error("Missing Android production signing configuration");
const dir = await mkdtemp(
  join(process.env.RUNNER_TEMP || tmpdir(), "tasker-signing-"),
);
try {
  const keystore = join(dir, "release.p12");
  await writeFile(keystore, Buffer.from(value.keystoreBase64, "base64"), {
    mode: 0o600,
  });
  const env = {
    ...process.env,
    TASKER_ANDROID_KEYSTORE: keystore,
    TASKER_ANDROID_STORE_PASSWORD: value.storePassword,
    TASKER_ANDROID_KEY_ALIAS: value.keyAlias,
    TASKER_ANDROID_KEY_PASSWORD: value.keyPassword,
  };
  delete env.TASKER_ANDROID_SIGNING_JSON;
  delete env.TASKER_ANDROID_SIGNING_FILE;
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../apps/android/scripts/release.mjs", import.meta.url),
      ),
    ],
    { env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Android release build failed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
