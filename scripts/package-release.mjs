import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// Explicit runtime inputs only. Never archive the checkout or app data directory.
export async function stageRelease(root, destination) {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version))
    throw new Error("Invalid release version");
  await mkdir(destination, { recursive: true });
  async function copyFile(path) {
    if (!(await lstat(join(root, path))).isFile())
      throw new Error(`Expected regular release file: ${path}`);
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(root, path), target, {
      dereference: false,
      errorOnExist: true,
      force: false,
    });
  }
  async function copyTree(path, allowed) {
    for (const entry of await readdir(join(root, path), {
      withFileTypes: true,
    })) {
      if (entry.name.startsWith(".")) continue;
      const relative = join(path, entry.name);
      if (entry.isDirectory()) await copyTree(relative, allowed);
      else if (entry.isFile() && allowed.test(entry.name))
        await copyFile(relative);
      // Symlinks are deliberately excluded, including node_modules-style links.
    }
  }
  for (const path of [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
    "scripts/install.mjs",
    "packages/core/package.json",
    "packages/ui/package.json",
    "apps/macos/package.json",
    "apps/macos/plugin/Tasker.1m.sh",
    "apps/macos/plugin/assets/trayTemplate.png",
    "apps/macos/plugin/assets/trayTemplate@2x.png",
  ])
    await copyFile(path);
  await copyTree("packages/core/dist", /\.(?:js|d\.ts)$/);
  await copyTree("apps/macos/dist-service", /\.js$/);
  await copyTree("apps/macos/dist", /\.(?:html|js|css|png|svg|woff2?)$/);
  // Fail early for incomplete builds rather than ship a nonfunctional archive.
  for (const path of [
    "packages/core/dist/index.js",
    "apps/macos/dist/index.html",
    "apps/macos/dist-service/service/main.js",
    "apps/macos/dist-service/google/public-client.js",
  ])
    await readFile(join(destination, path));
  manifest.scripts = {
    start: "pnpm --filter @tasker/macos start",
    "install:macos": "node scripts/install.mjs",
    "uninstall:macos": "node scripts/install.mjs --uninstall",
  };
  await writeFile(
    join(destination, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(
    join(destination, "README.md"),
    `# Tasker ${manifest.version}\n\nPrebuilt macOS SwiftBar runtime. Install Node.js and pnpm 10.14.0, and use the supported SwiftBar host (including its clipboard routing fix).\n\nFrom this extracted directory:\n\n\`\`\`sh\npnpm install --frozen-lockfile\npnpm install:macos\n\`\`\`\n\nKeep this directory in place: the service runs from here. Native dependencies install for your Mac; this archive is not a standalone signed app. Do not run a source build here.\n\nOpen Tasker → Backups → Connect Google. Official builds include Tasker's Desktop OAuth app configuration; no JSON setup is needed. Your Google account requires its own consent, and its tokens stay in your Mac's Keychain. Availability also depends on the Google project's audience and publishing settings.\n\nDevelopers can override the app configuration with google-client.json in ~/Library/Application Support/tasker-swiftbar. Existing overrides are preserved. Remove that override to use the bundled app identity.\n\nThis archive contains no user database, backups, runtime token, or account authorization tokens.\n`,
  );
  return manifest.version;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const { bundledGoogleClient } = await import(
    "../apps/macos/dist-service/google/public-client.js"
  );
  if (!bundledGoogleClient?.clientId)
    throw new Error(
      "Release archive needs bundled OAuth configuration. Set TASKER_GOOGLE_BUILD_CLIENT_JSON when running pnpm release:archive.",
    );
  const temp = await mkdtemp(join(tmpdir(), "tasker-release-"));
  try {
    const staged = join(temp, "tasker-swiftbar");
    const version = await stageRelease(root, staged);
    const output = join(
      root,
      "release",
      `tasker-swiftbar-${version}-macos.tar.gz`,
    );
    await mkdir(dirname(output), { recursive: true });
    execFileSync("/usr/bin/tar", [
      "-czf",
      output,
      "-C",
      temp,
      basename(staged),
    ]);
    console.log(`Prepared ${output}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
