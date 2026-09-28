import { it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, getRawDb, addTask, getAllTasks } from "@tasker/core";
import { importLegacySnapshot } from "../src/backup/import.js";
it("imports a selected snapshot without changing its bytes and reports omitted fields", () => {
  const root = mkdtempSync(join(tmpdir(), "tasker-import-test-"));
  const live = createDb(join(root, "live.sqlite"));
  try {
    addTask(live, "Legacy task", "tasks");
    getRawDb(live).exec("CREATE TABLE legacy_extra(value TEXT)");
    const source = join(root, "snapshot.sqlite");
    getRawDb(live).prepare("VACUUM INTO ?").run(source);
    const bytes = readFileSync(source);
    const result = importLegacySnapshot(source, join(root, "imported"));
    expect(result.warnings).toContain("Not imported: legacy_extra");
    expect(readFileSync(source)).toEqual(bytes);
    const db = createDb(join(root, "imported/tasker.db"));
    try {
      expect(getAllTasks(db)[0]!.description).toBe("Legacy task");
    } finally {
      getRawDb(db).close();
    }
    expect(() => importLegacySnapshot(source, join(root, "imported"))).toThrow(
      "must not exist",
    );
  } finally {
    getRawDb(live).close();
    rmSync(root, { recursive: true, force: true });
  }
});
