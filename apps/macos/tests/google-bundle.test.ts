import { expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Build script is plain Node ESM.
import { bundleGoogleClient } from "../../../scripts/bundle-google-client.mjs";
it("bundles only desktop app fields, strips grants, and clears stale defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tasker-bundle-test-"));
  try {
    const input = join(dir, "client.json"),
      output = join(dir, "public-client.js");
    await writeFile(
      input,
      JSON.stringify({
        installed: {
          client_id: "fixture.apps.googleusercontent.com",
          client_secret: "public-desktop-fixture",
          refresh_token: "PRIVATE_SENTINEL",
        },
        access_token: "PRIVATE_SENTINEL",
      }),
    );
    expect(await bundleGoogleClient(input, output)).toBe(true);
    const content = await readFile(output, "utf8");
    expect(content).toContain(
      '"clientId":"fixture.apps.googleusercontent.com"',
    );
    expect(content).toContain('"clientSecret":"public-desktop-fixture"');
    expect(content).not.toContain("PRIVATE_SENTINEL");
    expect(await bundleGoogleClient(undefined, output)).toBe(false);
    expect(await readFile(output, "utf8")).not.toContain(
      "fixture.apps.googleusercontent.com",
    );
    expect(await readFile(output, "utf8")).toContain("= undefined;");
    await writeFile(input, JSON.stringify({ web: { client_id: "wrong" } }));
    await expect(bundleGoogleClient(input, output)).rejects.toThrow(
      "Cannot bundle Google Desktop OAuth configuration",
    );
    await expect(
      bundleGoogleClient(join(dir, "missing"), output),
    ).rejects.toThrow("Cannot bundle Google Desktop OAuth configuration");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
