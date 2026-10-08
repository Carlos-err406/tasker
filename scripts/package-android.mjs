import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export function androidTools(env = process.env) {
  const sdk =
    env.ANDROID_HOME ||
    env.ANDROID_SDK_ROOT ||
    join(
      homedir(),
      process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk",
    );
  return join(sdk, "build-tools", "35.0.0");
}

export function validateAndroidPackage({
  badging,
  certificate,
  version,
  expectedCertificate,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Invalid Android release version");
  const [major, minor, patch] = version.split(".").map(Number);
  const code = major * 1000000 + minor * 1000 + patch;
  if (
    minor > 999 ||
    patch > 999 ||
    !Number.isSafeInteger(code) ||
    code < 1 ||
    code > 2100000000
  )
    throw new Error("Unsupported Android release version");
  const pkg =
    /^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m.exec(
      badging,
    );
  if (
    !pkg ||
    pkg[1] !== "org.tasker.android" ||
    pkg[2] !== String(code) ||
    pkg[3] !== version
  )
    throw new Error("Android package identity/version mismatch");
  if (/^application-debuggable/m.test(badging))
    throw new Error("Refusing a debuggable production APK");
  const signatures = [
    ...certificate.matchAll(
      /^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})\s*$/gm,
    ),
  ];
  if (
    !/^[a-f0-9]{64}$/.test(expectedCertificate) ||
    signatures.length !== 1 ||
    signatures[0][1].toLowerCase() !== expectedCertificate
  )
    throw new Error("Android signing certificate mismatch");
}

export async function packageAndroid({
  repoRoot = root,
  run = (file, args) =>
    execFileSync(file, args, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }),
  env = process.env,
} = {}) {
  const version = JSON.parse(
    await readFile(join(repoRoot, "apps/android/package.json"), "utf8"),
  ).version;
  const apk = join(
    repoRoot,
    "apps/android/native/app/build/outputs/apk/release/app-release.apk",
  );
  const stat = await lstat(apk);
  if (!stat.isFile() || stat.size < 1 || stat.size > 100 * 1024 * 1024)
    throw new Error("Invalid Android APK size or file type");
  validateAndroidPackage({
    badging: run(join(androidTools(env), "aapt"), ["dump", "badging", apk]),
    certificate: run(join(androidTools(env), "apksigner"), [
      "verify",
      "--verbose",
      "--print-certs",
      apk,
    ]),
    version,
    expectedCertificate: (
      await readFile(
        join(repoRoot, "apps/android/release-certificate.sha256"),
        "utf8",
      )
    ).trim(),
  });
  const bytes = await readFile(apk);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const output = join(repoRoot, "release/tasker-android.apk");
  await mkdir(join(repoRoot, "release"), { recursive: true });
  await writeFile(output, bytes);
  await writeFile(output + ".sha256", `${digest}  tasker-android.apk\n`);
  return output;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(`Verified and packaged ${await packageAndroid()}`);
