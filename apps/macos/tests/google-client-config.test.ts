import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadGoogleClient,
  parseDesktopClient,
} from "../src/google/client-config.js";
import { bundledGoogleClient } from "../src/google/public-client.js";
const folders: string[] = [];
afterEach(() =>
  folders
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);
function directory() {
  const path = mkdtempSync(join(tmpdir(), "tasker-oauth-config-"));
  folders.push(path);
  return path;
}
const desktop = (name: string) => ({
  installed: {
    client_id: `${name}.apps.googleusercontent.com`,
    client_secret: "desktop-public-value",
  },
});
const bundled = { clientId: "bundled.apps.googleusercontent.com" };
it("uses the bundled identity on a fresh installation without a local JSON", () => {
  expect(loadGoogleClient(directory(), undefined, bundled)).toEqual(bundled);
  expect(loadGoogleClient(directory(), undefined) === bundledGoogleClient).toBe(
    true,
  );
});
it("prefers local JSON, and prefers an explicit override over both defaults", () => {
  const dir = directory();
  writeFileSync(
    join(dir, "google-client.json"),
    JSON.stringify(desktop("local")),
  );
  const override = join(dir, "override.json");
  writeFileSync(override, JSON.stringify(desktop("developer")));
  expect(loadGoogleClient(dir, undefined, bundled)?.clientId).toBe(
    "local.apps.googleusercontent.com",
  );
  expect(loadGoogleClient(dir, override, bundled)?.clientId).toBe(
    "developer.apps.googleusercontent.com",
  );
});
it("does not fall back silently when an explicit override is missing or malformed", () => {
  const dir = directory(),
    path = join(dir, "missing.json");
  expect(() => loadGoogleClient(dir, path, bundled)).toThrow(
    "Cannot load Google Desktop OAuth override",
  );
  writeFileSync(path, "invalid-sensitive-content");
  expect(() => loadGoogleClient(dir, path, bundled)).toThrow(
    "Cannot load Google Desktop OAuth override",
  );
  writeFileSync(
    join(dir, "google-client.json"),
    JSON.stringify({ web: desktop("wrong").installed }),
  );
  expect(() => loadGoogleClient(dir, undefined, bundled)).toThrow(
    "Cannot load Google Desktop OAuth override",
  );
});
it("extracts only application fields and rejects non-desktop credentials", () => {
  const value = desktop("valid");
  expect(
    parseDesktopClient({
      ...value,
      refresh_token: "account-grant",
      access_token: "account-access",
      installed: { ...value.installed, refresh_token: "nested-grant" },
    }),
  ).toEqual({
    clientId: "valid.apps.googleusercontent.com",
    clientSecret: "desktop-public-value",
  });
  for (const invalid of [
    null,
    {},
    { web: value.installed },
    { type: "service_account" },
    desktop("bad/path"),
    {
      installed: {
        client_id: "a.apps.googleusercontent.com",
        client_secret: 42,
      },
    },
  ]) {
    expect(() => parseDesktopClient(invalid)).toThrow(
      "Expected a Google Desktop app client JSON",
    );
  }
  expect(
    parseDesktopClient({
      installed: { client_id: "a.apps.googleusercontent.com" },
    }),
  ).toEqual({ clientId: "a.apps.googleusercontent.com" });
});
