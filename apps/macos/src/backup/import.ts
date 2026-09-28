import Database from "better-sqlite3";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDb, getRawDb } from "@tasker/core";
import { BackupManager } from "./manager.js";
/** Convert an explicitly selected standalone snapshot; never open the original for writes. */
export function importLegacySnapshot(input: string, output: string) {
  if (!input || !output || resolve(input) === resolve(output))
    throw new Error("Provide a source snapshot and a new output directory");
  if (existsSync(output)) throw new Error("Output directory must not exist");
  if (existsSync(input + "-wal"))
    throw new Error(
      "Select a completed standalone backup, not a live WAL database",
    );
  const temp = mkdtempSync(join(tmpdir(), "tasker-import-"));
  let source: InstanceType<typeof Database> | undefined;
  let target: ReturnType<typeof createDb> | undefined;
  const warnings: string[] = [];
  try {
    const copy = join(temp, "source.sqlite");
    copyFileSync(input, copy);
    source = new Database(copy, { readonly: true });
    if (
      (
        source.prepare("PRAGMA integrity_check").get() as {
          integrity_check: string;
        }
      ).integrity_check !== "ok"
    )
      throw new Error("Invalid source database");
    if (
      source
        .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view')")
        .get()
    )
      throw new Error("Export a plain backup without sync triggers or views");
    mkdirSync(output, { mode: 0o700 });
    target = createDb(join(output, "tasker.db"));
    const raw = getRawDb(target);
    raw.pragma("foreign_keys = OFF");
    const supported = [
      "lists",
      "tasks",
      "task_dependencies",
      "task_relations",
      "attachments",
    ];
    const names = (
      source
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as { name: string }[]
    ).map((t) => t.name);
    for (const table of [
      "lists",
      "tasks",
      "task_dependencies",
      "task_relations",
    ])
      if (!names.includes(table)) throw new Error("Missing source task tables");
    raw.transaction(() => {
      raw.exec("DELETE FROM lists");
      for (const table of supported) {
        if (!names.includes(table)) continue;
        const sourceColumns = (
          source!.prepare(`PRAGMA table_info("${table}")`).all() as {
            name: string;
          }[]
        ).map((c) => c.name);
        const columns = (
          raw.prepare(`PRAGMA table_info("${table}")`).all() as {
            name: string;
          }[]
        )
          .map((c) => c.name)
          .filter((n) => sourceColumns.includes(n));
        for (const column of sourceColumns.filter((n) => !columns.includes(n)))
          warnings.push(`Unsupported field: ${table}.${column}`);
        const quoted = columns.map((n) => '"' + n + '"').join(",");
        const insert = raw.prepare(
          `INSERT INTO "${table}" (${quoted}) VALUES (${columns.map(() => "?").join(",")})`,
        );
        for (const row of source!
          .prepare(`SELECT ${quoted} FROM "${table}"`)
          .all() as Record<string, unknown>[])
          insert.run(...columns.map((n) => row[n]));
      }
      raw.exec(
        "INSERT OR IGNORE INTO lists(name,sort_order) VALUES ('tasks',0)",
      );
      if (names.includes("config")) {
        const row = source!
          .prepare("SELECT value FROM config WHERE key='default_list'")
          .get() as { value: string } | undefined;
        if (
          row &&
          raw.prepare("SELECT 1 FROM lists WHERE name=?").get(row.value)
        )
          raw
            .prepare("INSERT INTO config(key,value) VALUES ('default_list',?)")
            .run(row.value);
      }
    })();
    raw.pragma("foreign_keys = ON");
    for (const table of names.filter((n) => !supported.includes(n)))
      warnings.push(
        `Not imported: ${table}${table === "config" ? " (only default_list is retained)" : ""}`,
      );
    const external = (
      raw.prepare("SELECT description FROM tasks").all() as {
        description: string;
      }[]
    ).filter((t) =>
      /!\[[^\]]*\]\((?!\/attachments\/)[^)]+\)/.test(t.description),
    ).length;
    if (external)
      warnings.push(
        `${external} tasks reference external images; their bytes were not imported. Paste local images again to include them in future backups.`,
      );
    const manager = new BackupManager(
      output,
      () => target!,
      () => {},
      () => {},
    );
    const snapshot = manager.create("manual");
    return { snapshot, warnings, output };
  } catch (error) {
    if (target) {
      getRawDb(target).close();
      target = undefined;
      rmSync(output, { recursive: true, force: true });
    }
    throw error;
  } finally {
    source?.close();
    if (target) getRawDb(target).close();
    rmSync(temp, { recursive: true, force: true });
  }
}
