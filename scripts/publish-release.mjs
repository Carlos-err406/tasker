import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleaseVersion } from "./check-release-version.mjs";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

export async function publishRelease({ root, tag, repo, run = gh }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? ""))
    throw new Error("Invalid release repository");
  if (!tag) throw new Error("Missing release tag");
  const version = await checkReleaseVersion(root, tag);
  const archive = join(
    root,
    "release",
    `tasker-swiftbar-${version}-macos.tar.gz`,
  );
  const checksum = archive + ".sha256";
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (
    (await readFile(checksum, "utf8")).trim() !==
    `${digest}  ${basename(archive)}`
  ) {
    throw new Error("Release archive checksum mismatch");
  }
  const installer = join(root, "install.sh");
  await readFile(installer);
  const android = join(root, "release/tasker-android.apk");
  const androidChecksum = android + ".sha256";
  const androidBytes = await readFile(android);
  const androidDigest = createHash("sha256").update(androidBytes).digest("hex");
  if (
    !androidBytes.length ||
    (await readFile(androidChecksum, "utf8")).trim() !==
      `${androidDigest}  ${basename(android)}`
  ) {
    throw new Error("Android release checksum mismatch");
  }
  const artifacts = [archive, checksum, installer, android, androidChecksum];
  // A failed API request throws; it must never be mistaken for a missing release.
  const pages = JSON.parse(
    run(["api", `repos/${repo}/releases`, "--paginate", "--slurp"]),
  );
  const existing = pages.flat().find((release) => release.tag_name === tag);
  if (existing && !existing.draft) {
    console.log(`${tag} is already published; no assets were changed.`);
    return;
  }
  const notes = join(root, `docs/releases/${version}.md`);
  if (!existing) {
    run([
      "release",
      "create",
      tag,
      "--repo",
      repo,
      "--verify-tag",
      "--draft",
      "--title",
      `Tasker ${version}`,
      "--notes-file",
      notes,
    ]);
  }
  // Only drafts may be retried/replaced. Public releases stay immutable.
  run(["release", "upload", tag, "--repo", repo, "--clobber", ...artifacts]);
  const uploaded = JSON.parse(
    run(["release", "view", tag, "--repo", repo, "--json", "assets"]),
  );
  for (const path of artifacts) {
    const bytes = await readFile(path);
    const hash = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const asset = uploaded.assets.find((item) => item.name === basename(path));
    if (
      !asset ||
      asset.state !== "uploaded" ||
      asset.size !== bytes.length ||
      asset.digest !== hash
    ) {
      throw new Error(`Uploaded asset verification failed: ${basename(path)}`);
    }
  }
  run([
    "release",
    "edit",
    tag,
    "--repo",
    repo,
    "--draft=false",
    "--latest",
    "--title",
    `Tasker ${version}`,
    "--notes-file",
    notes,
  ]);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await publishRelease({
    root: fileURLToPath(new URL("../", import.meta.url)),
    tag: process.env.RELEASE_TAG,
    repo: process.env.RELEASE_REPO,
  });
}
