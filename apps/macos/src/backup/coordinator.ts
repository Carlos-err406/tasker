import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BackupManager, type BackupKind } from "./manager.js";
import { GoogleConnection, type GoogleClient } from "../google/oauth.js";
import { keychainCredentials } from "../google/credentials.js";
import { DriveBackups } from "../google/drive.js";
export class BackupCoordinator {
  private google?: GoogleConnection;
  private drive?: DriveBackups;
  private active?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private cancelled = new AbortController();
  private retryAt = 0;
  private failures = 0;
  private generation = 0;
  private cloudTime: string | null = null;
  private localError: string | null = null;
  private cloudError: string | null = null;
  constructor(
    readonly local: BackupManager,
    private directory: string,
    client?: GoogleClient,
  ) {
    if (client) {
      this.google = new GoogleConnection(
        client,
        keychainCredentials(client.clientId),
      );
      this.drive = new DriveBackups(
        () => this.google!.accessToken(),
        (url, options) =>
          fetch(url, {
            ...options,
            signal: AbortSignal.any([
              this.cancelled.signal,
              options?.signal ?? AbortSignal.timeout(120000),
            ]),
          }),
      );
    }
    const state = join(directory, "backup-state.json");
    if (existsSync(state)) {
      try {
        this.cloudTime =
          JSON.parse(readFileSync(state, "utf8")).cloudTime ?? null;
      } catch {
        /* Rebuild display state from future successful uploads. */
      }
    }
  }
  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 60000);
    this.timer.unref();
  }
  close() {
    this.generation++;
    clearInterval(this.timer);
    this.cancelled.abort();
    this.google?.close();
  }
  status() {
    let connected = false;
    try {
      connected = this.google?.connected() ?? false;
    } catch (error) {
      this.cloudError = String(error);
    }
    return {
      local: this.local.list(),
      configured: !!this.google,
      connected,
      pending: this.google?.pending ?? false,
      lastCloud: connected ? this.cloudTime : null,
      localError: this.localError,
      cloudError: this.google?.error ?? this.cloudError,
      uploading: !!this.active,
    };
  }
  create(kind: BackupKind = "manual") {
    const backup = this.local.create(kind);
    this.localError = null;
    void this.upload();
    return backup;
  }
  private tick() {
    try {
      if (this.local.due()) this.local.create("automatic");
      this.localError = null;
    } catch (error) {
      this.localError =
        error instanceof Error ? error.message : "Local backup failed";
    }
    if (Date.now() >= this.retryAt) void this.upload();
  }
  async upload() {
    if (this.active) return this.active;
    if (!this.drive || !this.google) return;
    try {
      if (!this.google.connected()) return;
    } catch (error) {
      this.cloudError = String(error);
      return;
    }
    const generation = this.generation;
    // Defer work until active is assigned: synchronous validation failures must
    // not clear active before the completed promise is stored here.
    this.active = Promise.resolve().then(async () => {
      try {
        for (const backup of this.local.list()) {
          if (generation !== this.generation) return;
          this.local.validate(backup.id);
          await this.drive!.upload(
            backup,
            readFileSync(this.local.file(backup.id)),
          );
          if (generation !== this.generation) return;
        }
        await this.drive!.prune();
        if (generation !== this.generation) return;
        this.cloudTime = new Date().toISOString();
        writeFileSync(
          join(this.directory, "backup-state.json"),
          JSON.stringify({ cloudTime: this.cloudTime }),
          { mode: 0o600 },
        );
        this.cloudError = null;
        this.failures = 0;
        this.retryAt = Date.now() + 60 * 60 * 1000;
      } catch (error) {
        if (generation === this.generation) {
          this.cloudError =
            error instanceof Error ? error.message : "Cloud backup failed";
          this.retryAt =
            Date.now() +
            Math.min(60 * 60 * 1000, 60000 * 2 ** Math.min(this.failures++, 6));
        }
      } finally {
        this.active = undefined;
      }
    });
    return this.active;
  }
  async syncAccessToken() {
    if (!this.google?.connected()) throw new Error("Connect Google Drive to sync");
    return this.google.accessToken();
  }
  async connect() {
    if (!this.google)
      throw new Error(
        "Configure a Google desktop OAuth client first; see docs/google-setup.md",
      );
    return this.google.connect();
  }
  disconnect() {
    this.generation++;
    this.cancelled.abort();
    this.cancelled = new AbortController();
    this.google?.disconnect();
    this.cloudTime = null;
    this.cloudError = null;
    writeFileSync(
      join(this.directory, "backup-state.json"),
      JSON.stringify({ cloudTime: null }),
      { mode: 0o600 },
    );
  }
  async listCloud() {
    if (!this.drive) throw new Error("Google Drive is not configured");
    return this.drive.list();
  }
  async restoreCloud(fileId: string) {
    if (!this.drive) throw new Error("Google Drive is not configured");
    const { manifest, bytes } = await this.drive.download(fileId);
    this.local.importSnapshot(manifest, bytes);
    return this.local.restore(manifest.id);
  }
}
