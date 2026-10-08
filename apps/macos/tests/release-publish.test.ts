import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, basename } from "node:path";
import { createHash } from "node:crypto";
// @ts-expect-error Release scripts are plain Node ESM.
import { checkReleaseVersion } from "../../../scripts/check-release-version.mjs";
// @ts-expect-error Release scripts are plain Node ESM.
import { publishRelease } from "../../../scripts/publish-release.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "tasker-publish-"));
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  for (const path of [
    "package.json",
    "apps/macos/package.json",
    "apps/android/package.json",
    "packages/core/package.json",
    "packages/ui/package.json",
  ])
    await write(path, JSON.stringify({ version: "0.1.1" }));
  await write(
    "apps/macos/plugin/Tasker.1m.sh",
    "# <xbar.version>0.1.1</xbar.version>",
  );
  await write("docs/releases/0.1.1.md", "Release notes");
  await write("install.sh", "installer");
  const archive = "release/tasker-swiftbar-0.1.1-macos.tar.gz";
  await write(archive, "archive");
  const digest = createHash("sha256").update("archive").digest("hex");
  await write(archive + ".sha256", `${digest}  ${basename(archive)}\n`);
  const android = "release/tasker-android.apk";
  await write(android, "android");
  await write(
    android + ".sha256",
    `${createHash("sha256").update("android").digest("hex")}  tasker-android.apk\n`,
  );
  const assets = await Promise.all(
    [
      archive,
      archive + ".sha256",
      "install.sh",
      android,
      android + ".sha256",
    ].map(async (path) => {
      const bytes = await readFile(join(root, path));
      return {
        name: basename(path),
        state: "uploaded",
        size: bytes.length,
        digest: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
  return {
    root,
    write,
    assets,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

it("rejects mismatched tags and workspace/plugin versions before publication", async () => {
  const f = await fixture();
  try {
    expect(await checkReleaseVersion(f.root, "v0.1.1")).toBe("0.1.1");
    await expect(checkReleaseVersion(f.root, "v0.1.2")).rejects.toThrow(
      "Tag must match",
    );
    await f.write("packages/ui/package.json", '{"version":"0.1.0"}');
    await expect(checkReleaseVersion(f.root)).rejects.toThrow(
      "Version mismatch",
    );
    await f.write("packages/ui/package.json", '{"version":"0.1.1"}');
    await f.write("apps/macos/plugin/Tasker.1m.sh", "old plugin");
    await expect(checkReleaseVersion(f.root)).rejects.toThrow(
      "Plugin version mismatch",
    );
  } finally {
    await f.cleanup();
  }
});

for (const existingDraft of [false, true]) {
  it(`verifies every asset before publishing ${existingDraft ? "an existing" : "a new"} draft`, async () => {
    const f = await fixture();
    const calls: string[][] = [];
    try {
      await publishRelease({
        root: f.root,
        repo: "owner/tasker",
        tag: "v0.1.1",
        run: (args: string[]) => {
          calls.push(args);
          if (args[0] === "api")
            return JSON.stringify([
              existingDraft ? [{ tag_name: "v0.1.1", draft: true }] : [],
            ]);
          if (args[1] === "view") return JSON.stringify({ assets: f.assets });
          return "";
        },
      });
      expect(calls.map((args) => args[1])).toEqual(
        existingDraft
          ? ["repos/owner/tasker/releases", "upload", "view", "edit"]
          : ["repos/owner/tasker/releases", "create", "upload", "view", "edit"],
      );
      expect(calls.at(-1)).toContain("--draft=false");
      if (!existingDraft) expect(calls[1]).toContain("--draft");
    } finally {
      await f.cleanup();
    }
  });
}

for (const failure of [
  "api",
  "upload",
  "asset verification",
  "android verification",
]) {
  it(`leaves releases unpublished on ${failure} failure`, async () => {
    const f = await fixture();
    const calls: string[][] = [];
    try {
      await expect(
        publishRelease({
          root: f.root,
          repo: "owner/tasker",
          tag: "v0.1.1",
          run: (args: string[]) => {
            calls.push(args);
            if (args[0] === failure || args[1] === failure)
              throw new Error("Injected failure");
            if (args[0] === "api") return "[[]]";
            if (args[1] === "view")
              return JSON.stringify({
                assets:
                  failure === "android verification"
                    ? f.assets.slice(0, 3)
                    : f.assets.slice(1),
              });
            return "";
          },
        }),
      ).rejects.toThrow();
      expect(calls.some((args) => args[1] === "edit")).toBe(false);
      if (failure === "api") expect(calls).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  });
}

it("does not replace a published release on retry", async () => {
  const f = await fixture();
  const calls: string[][] = [];
  try {
    await publishRelease({
      root: f.root,
      repo: "owner/tasker",
      tag: "v0.1.1",
      run: (args: string[]) => {
        calls.push(args);
        return '[[{"tag_name":"v0.1.1","draft":false}]]';
      },
    });
    expect(calls).toHaveLength(1);
    await f.write("release/tasker-swiftbar-0.1.1-macos.tar.gz", "tampered");
    await expect(
      publishRelease({
        root: f.root,
        repo: "owner/tasker",
        tag: "v0.1.1",
        run: () => {
          throw new Error("Must not call GitHub");
        },
      }),
    ).rejects.toThrow("checksum mismatch");
  } finally {
    await f.cleanup();
  }
});

for (const missing of [true, false]) {
  it(`refuses publication when the Android artifact is ${missing ? "missing" : "corrupted"}`, async () => {
    const f = await fixture();
    try {
      if (missing) await rm(join(f.root, "release/tasker-android.apk"));
      else await f.write("release/tasker-android.apk.sha256", "wrong checksum");
      let called = false;
      await expect(
        publishRelease({
          root: f.root,
          repo: "owner/tasker",
          tag: "v0.1.1",
          run: () => {
            called = true;
            throw new Error("Must not reach GitHub");
          },
        }),
      ).rejects.toThrow();
      expect(called).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
}
