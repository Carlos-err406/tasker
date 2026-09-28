import { canonical, compareText } from "./merge.js";
import { SyncStore } from "./store.js";
import { validateCheckpoint } from "./validation.js";
import type { Checkpoint, SyncImage } from "./types.js";
export interface CheckpointFile {
  id: string;
  replica: string;
  sequence: number;
  sha256: string;
}
export interface SyncTransport {
  account(): Promise<string>;
  list(): Promise<CheckpointFile[]>;
  read(file: CheckpointFile): Promise<unknown>;
  reserveId(): Promise<string>;
  publish(id: string, checkpoint: Checkpoint): Promise<void>;
  localImages(ids: string[]): Promise<SyncImage[]>;
  uploadImages(images: SyncImage[]): Promise<void>;
  downloadImages(images: SyncImage[]): Promise<void>;
  prune(replica: string): Promise<void>;
  cancel(): void;
}
export interface SyncSettings {
  replica: string;
  enabled: boolean;
  account: string | null;
  lastSync: string | null;
  sequence: number;
}
export interface SyncStatus {
  enabled: boolean;
  syncing: boolean;
  pending: boolean;
  lastSync: string | null;
  error: string | null;
}
/** Network awaits never hold a database transaction. Each resume checks its generation. */
export class SyncCoordinator {
  private active: Promise<void> | undefined;
  private generation = 0;
  private eligible = true;
  private editing = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private retryAt = 0;
  private failures = 0;
  private error: string | null = null;
  constructor(
    readonly store: SyncStore,
    private transport: SyncTransport,
    private settings: SyncSettings,
    private save: (settings: SyncSettings) => void,
    private changed: () => void = () => {},
    private safetyBackup: () => Promise<void> = async () => {},
  ) {}
  status(): SyncStatus {
    return {
      enabled: this.settings.enabled,
      syncing: !!this.active,
      pending: this.store.getMeta("dirty") === "1",
      lastSync: this.settings.lastSync,
      error: this.error,
    };
  }
  setEditing(value: boolean) {
    this.editing = value;
    if (!value) void this.run();
  }
  start() {
    this.timer ??= setInterval(() => {
      if (this.eligible && Date.now() >= this.retryAt) void this.run();
    }, 30000);
    void this.run();
  }
  foreground(visible: boolean) {
    this.eligible = visible;
    if (visible) void this.run();
    else this.cancel();
  }
  close() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.eligible = false;
    this.cancel();
  }
  private cancel() {
    clearTimeout(this.debounce);
    this.generation++;
    this.transport.cancel();
  }
  pause() {
    this.cancel();
    this.settings = { ...this.settings, enabled: false };
    this.save(this.settings);
  }
  async enable() {
    const generation = this.generation,
      account = await this.transport.account();
    if (generation !== this.generation) return;
    if (this.settings.account && account !== this.settings.account)
      throw new Error("Use the same Google account to resume this sync.");
    await this.safetyBackup();
    if (generation !== this.generation) return;
    this.settings = { ...this.settings, account, enabled: true };
    this.save(this.settings);
    this.retryAt = 0;
    await this.run();
  }
  localChanged() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.run(), 1000);
  }
  async syncNow() {
    this.retryAt = 0;
    await this.run();
    return this.status();
  }
  run(): Promise<void> {
    if (this.active) return this.active;
    if (!this.settings.enabled || !this.eligible || this.editing)
      return Promise.resolve();
    const generation = this.generation;
    const current = () => {
      if (
        generation !== this.generation ||
        !this.settings.enabled ||
        !this.eligible
      )
        throw new Error("Sync cancelled");
    };
    this.active = Promise.resolve().then(async () => {
      try {
        const account = await this.transport.account();
        current();
        if (account !== this.settings.account) {
          this.pause();
          this.error =
            "Google account changed. Sync is paused; reconnect the original account.";
          return;
        }
        const files = await this.transport.list();
        current();
        const latest = new Map<string, CheckpointFile>();
        for (const file of files) {
          const previous = latest.get(file.replica);
          if (
            previous?.sequence === file.sequence &&
            previous.sha256 !== file.sha256
          )
            throw new Error(
              "Conflicting device checkpoint. Sync paused for this attempt.",
            );
          if (
            !previous ||
            file.sequence > previous.sequence ||
            (file.sequence === previous.sequence &&
              compareText(file.id, previous.id) < 0)
          )
            latest.set(file.replica, file);
        }
        for (const file of [...latest.values()].sort((a, b) =>
          compareText(a.replica, b.replica),
        )) {
          if (this.store.getMeta("seen:" + file.id) === file.sha256) continue;
          const checkpoint = validateCheckpoint(
            await this.transport.read(file),
          );
          current();
          if (
            checkpoint.replica !== file.replica ||
            checkpoint.sequence !== file.sequence
          )
            throw new Error("Sync checkpoint identity mismatch");
          await this.transport.downloadImages(checkpoint.images);
          current();
          if (this.editing) return;
          if (this.store.apply(checkpoint.records)) this.changed();
          this.store.setMeta("seen:" + file.id, file.sha256);
        }
        current();
        this.store.capture();
        let pending = this.store.getMeta("pending");
        if (!pending && this.store.getMeta("dirty") === "1") {
          const records = this.store.records();
          const ids = [
            ...new Set(
              records.flatMap((r) =>
                r.kind === "task" && r.value
                  ? [
                      ...r.value.description.matchAll(
                        /\/attachments\/([a-f0-9-]{36})/g,
                      ),
                    ].map((m) => m[1]!)
                  : [],
              ),
            ),
          ].sort();
          const images = await this.transport.localImages(ids);
          current();
          const id = await this.transport.reserveId();
          current();
          const sequence = this.settings.sequence + 1;
          if (!Number.isSafeInteger(sequence))
            throw new Error("Sync sequence overflow");
          const checkpoint = validateCheckpoint({
            format: 1,
            replica: this.settings.replica,
            sequence,
            records,
            images,
          });
          pending = canonical({ id, checkpoint });
          this.settings = { ...this.settings, sequence };
          this.save(this.settings);
          this.store.setMeta("pending", pending);
        }
        if (pending) {
          const { id, checkpoint } = JSON.parse(pending) as {
            id: string;
            checkpoint: Checkpoint;
          };
          validateCheckpoint(checkpoint);
          if (checkpoint.replica !== this.settings.replica)
            throw new Error(
              "Restored sync state needs migration before resume",
            );
          await this.transport.uploadImages(checkpoint.images);
          current();
          await this.transport.publish(id, checkpoint);
          current();
          this.store.setMeta("pending", "");
          this.store.setMeta(
            "dirty",
            canonical(this.store.records()) === canonical(checkpoint.records)
              ? "0"
              : "1",
          );
          await this.transport.prune(this.settings.replica);
          current();
        }
        this.settings = {
          ...this.settings,
          lastSync: new Date().toISOString(),
        };
        this.save(this.settings);
        this.error = null;
        this.failures = 0;
        this.retryAt = Date.now() + 30000;
      } catch (error) {
        if (generation === this.generation) {
          this.error = error instanceof Error ? error.message : "Sync failed";
          this.retryAt =
            Date.now() +
            Math.min(3600000, 5000 * 2 ** Math.min(this.failures++, 9));
        }
      } finally {
        this.active = undefined;
      }
    });
    return this.active;
  }
}
