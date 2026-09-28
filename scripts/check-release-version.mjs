import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function checkReleaseVersion(root, tag) {
  const { version } = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Expected a stable release version");
  if (tag !== undefined && tag !== `v${version}`)
    throw new Error("Tag must match package.json version");
  for (const path of ["apps/macos", "apps/android", "packages/core", "packages/ui"]) {
    const pkg = JSON.parse(
      await readFile(join(root, path, "package.json"), "utf8"),
    );
    if (pkg.version !== version) throw new Error(`Version mismatch in ${path}`);
  }
  const plugin = await readFile(
    join(root, "apps/macos/plugin/Tasker.1m.sh"),
    "utf8",
  );
  if (!plugin.includes(`<xbar.version>${version}</xbar.version>`))
    throw new Error("Plugin version mismatch");
  await readFile(join(root, `docs/releases/${version}.md`));
  return version;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await checkReleaseVersion(
    fileURLToPath(new URL("../", import.meta.url)),
    process.argv[2],
  );
  console.log("Release version and notes verified.");
}
