import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, getRawDb, addTask, getAllTasks } from "@tasker/core";
import { saveImage, getImage } from "@tasker/core/attachments";
import { BackupManager, recoverRestore } from "../src/backup/manager.js";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0).reverse()) f();
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "tasker-backup-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "tasker.db");
  let db = createDb(path);
  cleanups.push(() => getRawDb(db).close());
  const backups = new BackupManager(
    directory,
    () => db,
    () => {
      getRawDb(db).close();
    },
    () => {
      db = createDb(path);
    },
  );
  return {
    directory,
    path,
    backups,
    reopen() {
      db = createDb(path);
    },
    get db() {
      return db;
    },
  };
}
it("restores tasks and BLOBs from a snapshot and keeps a safety backup", () => {
  const f = fixture();
  const bytes = Buffer.from("89504e470d0a1a0a00000000", "hex");
  const image = saveImage(f.db, bytes, "image/png");
  addTask(f.db, "Saved\n![image](" + image.reference + ")", "tasks");
  const snapshot = f.backups.create("manual");
  addTask(f.db, "Later", "tasks");
  f.backups.restore(snapshot.id);
  expect(getAllTasks(f.db).map((t) => t.description)).toHaveLength(1);
  expect(Buffer.from(getImage(f.db, image.id)!.data)).toEqual(bytes);
  const safety = f.backups.list().find((b) => b.kind === "safety")!;
  expect(safety).toBeDefined();
  f.backups.restore(safety.id);
  expect(getAllTasks(f.db)).toHaveLength(2);
});
it("rejects corrupt snapshots before replacing the live database", () => {
  const f = fixture();
  addTask(f.db, "Keep me", "tasks");
  const snapshot = f.backups.create("manual");
  writeFileSync(f.backups.file(snapshot.id), "corrupt");
  expect(() => f.backups.restore(snapshot.id)).toThrow();
  expect(getAllTasks(f.db)[0]!.description).toBe("Keep me");
});
it("retains manual backups while pruning only completed automatic snapshots", () => {
  const f = fixture();
  f.backups.create("manual");
  for (let i = 0; i < 9; i++) f.backups.create("automatic");
  expect(f.backups.list().filter((b) => b.kind === "automatic")).toHaveLength(
    7,
  );
  expect(f.backups.list().filter((b) => b.kind === "manual")).toHaveLength(1);
});
it("rolls back an interrupted activation on restart", () => {
  const f = fixture();
  addTask(f.db, "Old", "tasks");
  const b = f.backups.create("manual");
  getRawDb(f.db).pragma("wal_checkpoint(TRUNCATE)");
  getRawDb(f.db).pragma("journal_mode = DELETE");
  getRawDb(f.db).close();
  renameSync(f.path, join(f.directory, "restore-old.sqlite"));
  writeFileSync(join(f.directory, "restore.json"), "{}");
  writeFileSync(f.path, readFileSync(f.backups.file(b.id)));
  recoverRestore(f.directory);
  const reopened = createDb(f.path);
  expect(getAllTasks(reopened)[0]!.description).toBe("Old");
  getRawDb(reopened).close();
  // Reopen the fixture owner so its normal cleanup remains valid.
  f.reopen();
});

it.each([
  "prepared",
  "quiesced",
  "deactivated",
  "activated",
  "reopened",
  "committed",
])("recovers after process exit at %s", (stage) => {
  const directory = mkdtempSync(join(tmpdir(), "tasker-crash-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const child = `import {createDb,getRawDb,addTask} from '@tasker/core';import {BackupManager} from './dist-service/backup/manager.js';let db=createDb(process.argv[1]+'/tasker.db');const m=new BackupManager(process.argv[1],()=>db,()=>getRawDb(db).close(),()=>{db=createDb(process.argv[1]+'/tasker.db');},stage=>{if(stage===process.argv[2])process.exit(86);});addTask(db,'Snapshot','tasks');const b=m.create('manual');addTask(db,'Current','tasks');m.restore(b.id);`;
  let status = 0,
    stderr = "";
  try {
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", child, directory, stage],
      { cwd: resolve("."), stdio: "pipe" },
    );
  } catch (e) {
    status = (e as { status: number }).status;
    stderr = String((e as { stderr?: Buffer }).stderr ?? "");
  }
  expect(status, stderr).toBe(86);
  recoverRestore(directory);
  const reopened = createDb(join(directory, "tasker.db"));
  try {
    expect(getAllTasks(reopened)).toHaveLength(stage === "committed" ? 1 : 2);
  } finally {
    getRawDb(reopened).close();
  }
});
it("rejects newer versions and executable schema even with matching checksums", () => {
  const f = fixture();
  addTask(f.db, "Current", "tasks");
  const b = f.backups.create("manual");
  const manifestPath = join(f.directory, "backups", b.id, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ ...b, schemaVersion: 2 }));
  expect(() => f.backups.restore(b.id)).toThrow("Unsupported");
  writeFileSync(manifestPath, JSON.stringify(b));
  const raw = createDb(f.backups.file(b.id));
  getRawDb(raw).exec("CREATE VIEW malicious AS SELECT 1");
  getRawDb(raw).pragma("wal_checkpoint(TRUNCATE)");
  getRawDb(raw).close();
  const bytes = readFileSync(f.backups.file(b.id));
  writeFileSync(
    manifestPath,
    JSON.stringify({
      ...b,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  expect(() => f.backups.restore(b.id)).toThrow("Unsupported database schema");
  expect(getAllTasks(f.db)).toHaveLength(1);
});
