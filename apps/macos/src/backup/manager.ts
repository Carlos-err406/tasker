import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { getRawDb, CREATE_SCHEMA_SQL, type TaskerDb } from "@tasker/core";
export type BackupKind = "automatic" | "manual" | "safety";
export interface BackupManifest {
  id: string;
  formatVersion: 1;
  schemaVersion: 1;
  appVersion: string;
  createdAt: string;
  kind: BackupKind;
  sha256: string;
  size: number;
}
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
const tables = [
  "tasks",
  "lists",
  "task_dependencies",
  "task_relations",
  "config",
  "undo_history",
  "attachments",
];
function flush(path: string) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
const checksum = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function removeSidecars(path: string) {
  for (const suffix of ["-wal", "-shm"]) rmSync(path + suffix, { force: true });
}
/** On an interrupted swap, prefer the intact pre-restore database. */
export function recoverRestore(directory: string) {
  const marker = join(directory, "restore.json");
  if (!existsSync(marker)) return;
  const live = join(directory, "tasker.db");
  const old = join(directory, "restore-old.sqlite");
  if (existsSync(old)) {
    rmSync(live, { force: true });
    removeSidecars(live);
    renameSync(old, live);
  }
  rmSync(join(directory, "restore-next.sqlite"), { force: true });
  rmSync(marker, { force: true });
}
export class BackupManager {
  private root: string;
  constructor(
    private directory: string,
    private database: () => TaskerDb,
    private close: () => void,
    private reopen: () => void,
    private restoreStage: (stage: string) => void = () => {},
  ) {
    this.root = join(directory, "backups");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  file(id: string) {
    if (!validId(id)) throw new Error("Invalid backup ID");
    return join(this.root, id, "snapshot.sqlite");
  }
  list(): BackupManifest[] {
    return readdirSync(this.root)
      .filter(validId)
      .flatMap((id) => {
        try {
          const manifest = JSON.parse(
            readFileSync(join(this.root, id, "manifest.json"), "utf8"),
          ) as BackupManifest;
          return manifest.id === id && existsSync(this.file(id))
            ? [manifest]
            : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  create(kind: BackupKind): BackupManifest {
    const id = randomUUID();
    const folder = join(this.root, id);
    mkdirSync(folder, { mode: 0o700 });
    try {
      getRawDb(this.database()).prepare("VACUUM INTO ?").run(this.file(id));
      const bytes = readFileSync(this.file(id));
      const manifest: BackupManifest = {
        id,
        formatVersion: 1,
        schemaVersion: 1,
        appVersion: "0.1.0",
        createdAt: new Date().toISOString(),
        kind,
        sha256: checksum(bytes),
        size: bytes.length,
      };
      this.validateBytes(manifest, bytes);
      writeFileSync(join(folder, "manifest.json"), JSON.stringify(manifest), {
        mode: 0o600,
      });
      this.validate(id);
      if (kind === "automatic")
        for (const old of this.list()
          .filter((b) => b.kind === "automatic")
          .slice(7))
          rmSync(join(this.root, old.id), { recursive: true });
      return manifest;
    } catch (error) {
      rmSync(folder, { recursive: true, force: true });
      throw error;
    }
  }
  due() {
    const latest = this.list().find((b) => b.kind === "automatic");
    return (
      !latest ||
      Date.now() - Date.parse(latest.createdAt) >= 24 * 60 * 60 * 1000
    );
  }
  private validateBytes(manifest: BackupManifest, bytes: Buffer) {
    if (manifest.formatVersion !== 1 || manifest.schemaVersion !== 1)
      throw new Error("Unsupported backup version");
    if (bytes.length !== manifest.size || checksum(bytes) !== manifest.sha256)
      throw new Error("Backup checksum mismatch");
  }
  validate(id: string) {
    const manifest = this.list().find((b) => b.id === id);
    if (!manifest) throw new Error("Backup not found");
    this.validateBytes(manifest, readFileSync(this.file(id)));
    const snapshot = new Database(this.file(id), { readonly: true });
    try {
      const checks = snapshot.prepare("PRAGMA integrity_check").all() as {
        integrity_check: string;
      }[];
      if (
        checks.length !== 1 ||
        checks[0]?.integrity_check !== "ok" ||
        snapshot.prepare("PRAGMA foreign_key_check").all().length
      )
        throw new Error("Invalid database");
      for (const table of tables) {
        if (
          !snapshot
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
        )
          throw new Error("Missing backup table");
      }
      const expected = new Database(":memory:");
      try {
        expected.exec(CREATE_SCHEMA_SQL);
        for (const table of tables)
          for (const pragma of ["table_info", "foreign_key_list"]) {
            if (
              JSON.stringify(
                snapshot.prepare(`PRAGMA ${pragma}("${table}")`).all(),
              ) !==
              JSON.stringify(
                expected.prepare(`PRAGMA ${pragma}("${table}")`).all(),
              )
            )
              throw new Error("Unsupported backup table schema");
          }
      } finally {
        expected.close();
      }
      if (
        snapshot
          .prepare(
            "SELECT 1 FROM attachments WHERE mime_type NOT IN ('image/png','image/jpeg','image/webp','image/gif') OR typeof(data) != 'blob' OR byte_length != length(data) OR byte_length < 1 OR byte_length > 10485760",
          )
          .get()
      )
        throw new Error("Invalid attachment data");
      // Backups produced by this app contain no triggers; reject foreign executable schema.
      if (
        snapshot
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view')",
          )
          .get()
      )
        throw new Error("Unsupported database schema");
      const descriptions = snapshot
        .prepare(
          "SELECT description AS text FROM tasks UNION ALL SELECT command_json AS text FROM undo_history",
        )
        .all() as { text: string }[];
      for (const { text } of descriptions)
        for (const match of text.matchAll(/\/attachments\/([a-f0-9-]{36})/g)) {
          if (
            !snapshot
              .prepare("SELECT 1 FROM attachments WHERE id=?")
              .get(match[1])
          )
            throw new Error("Missing image in backup");
        }
      return manifest;
    } finally {
      snapshot.close();
    }
  }
  restore(id: string) {
    this.validate(id);
    const safety = this.create("safety");
    const live = join(this.directory, "tasker.db");
    const old = join(this.directory, "restore-old.sqlite");
    const next = join(this.directory, "restore-next.sqlite");
    const marker = join(this.directory, "restore.json");
    rmSync(old, { force: true });
    copyFileSync(this.file(id), next);
    flush(next);
    this.restoreStage("prepared");
    // The rollback file must be self-contained before it changes names.
    getRawDb(this.database()).pragma("wal_checkpoint(TRUNCATE)");
    getRawDb(this.database()).pragma("journal_mode = DELETE");
    writeFileSync(marker, JSON.stringify({ backup: id, safety: safety.id }), {
      mode: 0o600,
    });
    flush(marker);
    flush(this.directory);
    this.close();
    this.restoreStage("quiesced");
    try {
      renameSync(live, old);
      flush(this.directory);
      this.restoreStage("deactivated");
      removeSidecars(live);
      renameSync(next, live);
      flush(this.directory);
      this.restoreStage("activated");
      this.reopen();
      this.restoreStage("reopened");
    } catch (error) {
      recoverRestore(this.directory);
      this.reopen();
      throw error;
    }
    // Commit the swap before removing the rollback copy. A crash before this marker
    // removal rolls back on startup; a crash after it leaves the restored database.
    rmSync(marker, { force: true });
    flush(this.directory);
    this.restoreStage("committed");
    rmSync(old, { force: true });
    return { safetyBackupId: safety.id };
  }
  importSnapshot(manifest: BackupManifest, bytes: Buffer) {
    if (!validId(manifest.id)) throw new Error("Invalid backup ID");
    this.validateBytes(manifest, bytes);
    if (this.list().some((b) => b.id === manifest.id)) {
      this.validate(manifest.id);
      return;
    }
    const folder = join(this.root, manifest.id);
    mkdirSync(folder, { mode: 0o700 });
    try {
      writeFileSync(this.file(manifest.id), bytes, { mode: 0o600 });
      writeFileSync(join(folder, "manifest.json"), JSON.stringify(manifest), {
        mode: 0o600,
      });
      this.validate(manifest.id);
    } catch (error) {
      rmSync(folder, { recursive: true, force: true });
      throw error;
    }
  }
}
