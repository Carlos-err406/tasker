import { expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
const script = resolve("../../install.sh");
const shell = (code: string, ...args: string[]) =>
  exec("/bin/bash", [
    "-c",
    'source "$1"; shift; ' + code,
    "test-installer",
    script,
    ...args,
  ]);
it("validates versions without accepting paths or shell syntax", async () => {
  for (const version of ["v0.1.0", "1.2.3", "1.0.0-beta.1"])
    await shell('valid_version "$1"', version);
  for (const version of ["../main", "v1.0", "1.0.0;echo bad", "latest", ""])
    await expect(shell('valid_version "$1"', version)).rejects.toThrow();
});
it("rejects unsupported systems before creating an install directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tasker-installer-"));
  try {
    await expect(
      shell('uname() { echo Linux; }; TASKER_INSTALL_ROOT="$1/new"; main', dir),
    ).rejects.toThrow("macOS only");
    await expect(readFile(join(dir, "new/.install-lock"))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("rejects tampered downloads and unexpected archive roots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tasker-installer-"));
  try {
    const file = join(dir, "payload");
    await writeFile(file, "release");
    await shell(
      'verify_sha256 "$1" "$2"',
      file,
      createHash("sha256").update("release").digest("hex"),
    );
    await expect(
      shell('verify_sha256 "$1" "$2"', file, "0".repeat(64)),
    ).rejects.toThrow("Checksum mismatch");
    await expect(shell('verify_sha256 "$1" "$2"', file, "bad")).rejects.toThrow(
      "Invalid SHA-256",
    );
    await mkdir(join(dir, "unexpected"));
    await writeFile(join(dir, "unexpected/file"), "data");
    const archive = join(dir, "archive.tar.gz");
    await exec("/usr/bin/tar", ["-czf", archive, "-C", dir, "unexpected"]);
    await expect(
      shell('check_archive "$1" tasker-swiftbar', archive),
    ).rejects.toThrow("unexpected path");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("restores previous integration files on rollback without touching task data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tasker-installer-"));
  try {
    await writeFile(join(dir, "previous.plist"), "old agent");
    await writeFile(join(dir, "previous.plugin"), "old plugin");
    await writeFile(join(dir, "agent"), "new agent");
    await writeFile(join(dir, "plugin"), "new plugin");
    await writeFile(join(dir, "tasker.db"), "KEEP USER DATA");
    await shell(
      'scratch="$1"; plist="$1/agent"; plugin="$1/plugin"; launchctl_tasker() { printf "%s\\n" "$*" >> "$scratch/calls"; }; rollback',
      dir,
    );
    expect(await readFile(join(dir, "agent"), "utf8")).toBe("old agent");
    expect(await readFile(join(dir, "plugin"), "utf8")).toBe("old plugin");
    expect(await readFile(join(dir, "tasker.db"), "utf8")).toBe(
      "KEEP USER DATA",
    );
    expect(await readFile(join(dir, "calls"), "utf8")).toContain("bootstrap");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
