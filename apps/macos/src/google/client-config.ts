import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GoogleClient } from "./oauth.js";
import { bundledGoogleClient } from "./public-client.js";

/** Read only Desktop OAuth application fields; never import account grants. */
export function parseDesktopClient(value: unknown): GoogleClient {
  const installed = (value as { installed?: Record<string, unknown> } | null)
    ?.installed;
  if (
    !installed ||
    typeof installed.client_id !== "string" ||
    !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(
      installed.client_id,
    ) ||
    (installed.client_secret !== undefined &&
      (typeof installed.client_secret !== "string" ||
        !installed.client_secret.trim()))
  ) {
    throw new Error("Expected a Google Desktop app client JSON");
  }
  return {
    clientId: installed.client_id,
    ...(typeof installed.client_secret === "string"
      ? { clientSecret: installed.client_secret }
      : {}),
  };
}

export function loadGoogleClient(
  directory: string,
  overridePath: string | undefined,
  bundled: GoogleClient | undefined = bundledGoogleClient,
): GoogleClient | undefined {
  const path = overridePath ?? join(directory, "google-client.json");
  // An explicit override must not silently fall back to a different OAuth app.
  if (overridePath !== undefined || existsSync(path)) {
    try {
      return parseDesktopClient(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      throw new Error(
        "Cannot load Google Desktop OAuth override. Check TASKER_GOOGLE_CLIENT_JSON or the local google-client.json file.",
      );
    }
  }
  return bundled;
}
