import type { GoogleClient } from "./oauth.js";

// Source checkouts have no shared OAuth identity. Official release builds inject
// only Desktop OAuth application fields into the ignored compiled module.
// Never put downloaded client JSON or account grants in the source tree.
export const bundledGoogleClient: GoogleClient | undefined = undefined;
