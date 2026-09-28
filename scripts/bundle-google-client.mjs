import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDesktopClient } from "../apps/macos/dist-service/google/client-config.js";

export async function bundleGoogleClient(inputPath, outputPath) {
  let client;
  if (inputPath !== undefined) {
    try {
      client = parseDesktopClient(
        JSON.parse(await readFile(inputPath, "utf8")),
      );
    } catch {
      throw new Error(
        "Cannot bundle Google Desktop OAuth configuration. Check TASKER_GOOGLE_BUILD_CLIENT_JSON.",
      );
    }
  }
  // Always overwrite: a build without a configured input must remove stale identity.
  await writeFile(
    outputPath,
    "// Generated public Desktop OAuth application configuration. No account grants.\n" +
      `export const bundledGoogleClient = ${client ? JSON.stringify(client) : "undefined"};\n`,
    { mode: 0o644 },
  );
  return !!client;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const bundled = await bundleGoogleClient(
    process.env.TASKER_GOOGLE_BUILD_CLIENT_JSON,
    fileURLToPath(
      new URL(
        "../apps/macos/dist-service/google/public-client.js",
        import.meta.url,
      ),
    ),
  );
  console.log(
    bundled
      ? "Bundled Desktop OAuth app configuration (account grants excluded)."
      : "No release OAuth input; local runtime overrides remain available.",
  );
}
