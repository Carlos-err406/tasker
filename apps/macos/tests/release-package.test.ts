import { expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error Runtime packaging script is plain Node ESM.
import { stageRelease } from "../../../scripts/package-release.mjs";
it("packages only runtime inputs and excludes account files, local state, and symlinks", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tasker-package-test-"));
  const root = join(temp, "repo"),
    output = join(temp, "release");
  async function fixture(path: string, content = "fixture") {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  try {
    await fixture(
      "package.json",
      JSON.stringify({
        name: "tasker",
        version: "0.1.0",
        scripts: { build: "source-only" },
      }),
    );
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
      "packages/core/dist/index.js",
      "apps/macos/dist/index.html",
      "apps/macos/dist-service/service/main.js",
      "apps/macos/dist-service/google/public-client.js",
    ])
      await fixture(path);
    for (const path of [
      "google-client.json",
      ".env",
      "runtime.json",
      "tasker.db",
      "backups/snapshot.sqlite",
      "apps/macos/dist-service/account-tokens.json",
      "apps/macos/dist-service/tasker.db",
      "apps/macos/dist/.env",
      "apps/macos/dist/refresh-token.json",
    ])
      await fixture(path, "PRIVATE_SENTINEL");
    await symlink(
      join(root, "google-client.json"),
      join(root, "apps/macos/dist-service/escape.js"),
    );
    await stageRelease(root, output);
    const files = (await readdir(output, { recursive: true })).map(String);
    expect(files).toContain("apps/macos/dist-service/google/public-client.js");
    expect(
      files.some((p) =>
        /google-client|runtime\.json|tasker\.db|snapshot|account-tokens|refresh-token|escape\.js|\.env/.test(
          p,
        ),
      ),
    ).toBe(false);
    const pkg = JSON.parse(
      await readFile(join(output, "package.json"), "utf8"),
    );
    expect(pkg.scripts.build).toBeUndefined();
    expect(pkg.scripts["install:macos"]).toBe("node scripts/install.mjs");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
