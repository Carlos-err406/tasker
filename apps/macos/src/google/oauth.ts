import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { Credentials } from "./credentials.js";
export interface GoogleClient {
  clientId: string;
  clientSecret?: string;
}
export class GoogleConnection {
  private listener?: Server;
  private timeout?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private access?: { token: string; expires: number };
  error: string | null = null;
  pending = false;
  constructor(
    private client: GoogleClient,
    private credentials: Credentials,
    private request: typeof fetch = fetch,
  ) {}
  private refreshToken: string | null | undefined;
  private savedGrant() {
    if (this.refreshToken === undefined)
      this.refreshToken = this.credentials.read();
    return this.refreshToken;
  }
  connected() {
    return !!this.savedGrant();
  }
  close() {
    this.generation++;
    this.listener?.close();
    this.listener = undefined;
    clearTimeout(this.timeout);
    this.pending = false;
  }
  disconnect() {
    this.close();
    this.access = undefined;
    this.credentials.remove();
    this.refreshToken = null;
    this.error = null;
  }
  async connect() {
    this.close();
    this.error = null;
    this.pending = true;
    const generation = this.generation;
    const verifier = randomBytes(48).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    let redirect = "";
    let used = false;
    const listener = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", redirect);
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      if (
        req.method !== "GET" ||
        req.headers.host !== new URL(redirect).host ||
        url.pathname !== "/callback" ||
        url.searchParams.get("state") !== state ||
        used ||
        generation !== this.generation
      ) {
        res.writeHead(400).end("Invalid authorization response");
        return;
      }
      used = true;
      try {
        if (url.searchParams.has("error") || !url.searchParams.get("code"))
          throw new Error("Google authorization was not granted");
        const result = await this.exchange({
          code: url.searchParams.get("code")!,
          code_verifier: verifier,
          redirect_uri: redirect,
          grant_type: "authorization_code",
        });
        if (generation !== this.generation)
          throw new Error("Authorization was cancelled");
        if (typeof result.refresh_token !== "string")
          throw new Error(
            "Google did not return an offline grant. Reconnect and grant access.",
          );
        this.setAccess(result);
        this.credentials.write(result.refresh_token);
        this.refreshToken = result.refresh_token;
        res.end("Google Drive backups connected. You can return to Tasker.");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Authorization failed";
        if (generation === this.generation) this.error = message;
        res.writeHead(400).end(message);
      } finally {
        listener.close();
        if (generation === this.generation) {
          this.pending = false;
          clearTimeout(this.timeout);
        }
      }
    });
    this.listener = listener;
    await new Promise<void>((ok, fail) => {
      listener.once("error", fail);
      listener.listen(0, "127.0.0.1", ok);
    });
    const address = listener.address();
    if (!address || typeof address === "string")
      throw new Error("Could not start Google callback");
    redirect = `http://127.0.0.1:${address.port}/callback`;
    this.timeout = setTimeout(
      () => {
        this.error = "Google connection timed out. Try again.";
        this.close();
      },
      5 * 60 * 1000,
    );
    this.timeout.unref();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.client.clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }
  private async exchange(fields: Record<string, string>) {
    const body = new URLSearchParams({
      ...fields,
      client_id: this.client.clientId,
    });
    if (this.client.clientSecret)
      body.set("client_secret", this.client.clientSecret);
    const response = await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        "Google authorization expired or failed. Reconnect Google Drive.",
      );
    return (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
  }
  private setAccess(result: { access_token?: string; expires_in?: number }) {
    if (
      typeof result.access_token !== "string" ||
      typeof result.expires_in !== "number"
    )
      throw new Error("Invalid Google token response");
    this.access = {
      token: result.access_token,
      expires: Date.now() + Math.max(0, result.expires_in - 60) * 1000,
    };
  }
  async accessToken() {
    if (this.access && this.access.expires > Date.now())
      return this.access.token;
    const token = this.savedGrant();
    if (!token) throw new Error("Connect Google Drive first");
    const generation = this.generation;
    try {
      const result = await this.exchange({
        grant_type: "refresh_token",
        refresh_token: token,
      });
      if (generation !== this.generation)
        throw new Error("Google disconnected");
      this.setAccess(result);
      return this.access!.token;
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Google connection failed";
      throw error;
    }
  }
}
