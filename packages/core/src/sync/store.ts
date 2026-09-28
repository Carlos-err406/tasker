import { withTransaction } from "../db.js";
import { sql } from "drizzle-orm";
import type { TaskerDb } from "../db.js";
import { syncMetadataToDescription } from "../parsers/task-description-parser.js";
import type { Priority } from "../types/priority.js";
import {
  canonical,
  compareRevision,
  compareText,
  mergeRecords,
  nextRevision,
  recordKey,
} from "./merge.js";
import { projectRecords } from "./projection.js";
import {
  DEFAULT_LIST_ID,
  type Revision,
  type SyncRecord,
  type SyncKind,
  type SyncTask,
} from "./types.js";

export const SYNC_SCHEMA_SQL = [
  "CREATE TABLE IF NOT EXISTS sync_records (kind TEXT NOT NULL, id TEXT NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY(kind,id))",
  "CREATE TABLE IF NOT EXISTS sync_aliases (kind TEXT NOT NULL, local_key TEXT NOT NULL, id TEXT NOT NULL, hint TEXT, PRIMARY KEY(kind,local_key))",
  "CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];
type Alias = {
  kind: SyncKind;
  local_key: string;
  id: string;
  hint: string | null;
};
interface RawList {
  name: string;
  sort_order: number;
  is_collapsed: number;
  hide_completed: number;
}
interface RawTask {
  id: string;
  description: string;
  created_at: string;
  status: number;
  list_name: string;
  due_date: string | null;
  priority: number | null;
  tags: string | null;
  is_trashed: number;
  sort_order: number;
  completed_at: string | null;
  parent_id: string | null;
}

/** All methods are synchronous; callers never keep a SQLite transaction across an await. */
export class SyncStore {
  constructor(
    readonly db: TaskerDb,
    readonly replica: string,
    private uuid: () => string,
    private now = Date.now,
  ) {
    for (const statement of SYNC_SCHEMA_SQL) db.run(sql.raw(statement));
    if (!this.getMeta("baseline"))
      withTransaction(db, () => this.capture(true));
  }
  getMeta(key: string): string | null {
    return (
      this.db.get<{ value: string }>(
        sql`SELECT value FROM sync_meta WHERE key=${key}`,
      )?.value ?? null
    );
  }
  setMeta(key: string, value: string) {
    this.db.run(
      sql`INSERT INTO sync_meta(key,value) VALUES(${key},${value}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    );
  }
  records(): SyncRecord[] {
    return this.db
      .all<{
        record_json: string;
      }>(sql`SELECT record_json FROM sync_records ORDER BY kind,id`)
      .map((r) => JSON.parse(r.record_json));
  }
  private put(record: SyncRecord) {
    this.db.run(
      sql`INSERT INTO sync_records(kind,id,record_json) VALUES(${record.kind},${record.id},${canonical(record)}) ON CONFLICT(kind,id) DO UPDATE SET record_json=excluded.record_json`,
    );
  }
  private aliases() {
    return this.db.all<Alias>(
      sql`SELECT kind,local_key,id,hint FROM sync_aliases`,
    );
  }
  private alias(
    kind: SyncKind,
    key: string,
    id: string,
    hint: string | null = null,
  ) {
    this.db.run(
      sql`INSERT INTO sync_aliases(kind,local_key,id,hint) VALUES(${kind},${key},${id},${hint}) ON CONFLICT(kind,local_key) DO UPDATE SET id=excluded.id,hint=excluded.hint`,
    );
  }
  taskIdentity(id: string) {
    return (
      this.db.get<{ id: string }>(
        sql`SELECT id FROM sync_aliases WHERE kind='task' AND local_key=${id}`,
      )?.id ?? null
    );
  }
  taskAlias(id: string) {
    return (
      this.db.get<{ local_key: string }>(
        sql`SELECT a.local_key FROM sync_aliases a JOIN tasks t ON t.id=a.local_key WHERE a.kind='task' AND a.id=${id}`,
      )?.local_key ?? null
    );
  }
  renameList(oldName: string, newName: string) {
    const row = this.aliases().find(
      (a) => a.kind === "list" && a.local_key === oldName,
    );
    if (row) {
      this.db.run(
        sql`DELETE FROM sync_aliases WHERE kind='list' AND local_key=${oldName}`,
      );
      this.alias("list", newName, row.id);
    }
  }
  private snapshot(seed: boolean, revive: boolean): SyncRecord[] {
    const aliases = new Map(
      this.aliases().map((a) => [`${a.kind}:${a.local_key}`, a]),
    );
    const existing = new Map(this.records().map((r) => [recordKey(r), r]));
    const lists = this.db.all<RawList>(sql`SELECT * FROM lists`);
    const tasks = this.db.all<RawTask>(sql`SELECT * FROM tasks`);
    const listIds = new Map<string, string>(),
      taskIds = new Map<string, string>();
    const identity = (
      kind: "list" | "task",
      key: string,
      hint: string | null,
    ) => {
      const a = aliases.get(`${kind}:${key}`),
        record = a && existing.get(`${kind}:${a.id}`);
      if (a && a.hint === hint && (record?.value !== null || revive))
        return a.id;
      const id =
        kind === "list" && key === "tasks"
          ? DEFAULT_LIST_ID
          : seed
            ? `legacy:${kind}:${kind === "task" ? key + ":" + hint : key}`
            : this.uuid();
      this.alias(kind, key, id, hint);
      return id;
    };
    for (const l of lists) listIds.set(l.name, identity("list", l.name, null));
    for (const t of tasks)
      taskIds.set(t.id, identity("task", t.id, t.created_at));
    const revision = { time: 0, counter: 0, actor: "legacy" };
    const result: SyncRecord[] = lists.map((l) => ({
      kind: "list",
      id: listIds.get(l.name)!,
      revision,
      value: { name: l.name, sortOrder: l.sort_order ?? 0 },
    }));
    for (const t of tasks) {
      const id = taskIds.get(t.id)!,
        prior = existing.get(`task:${id}`);
      const tags = t.tags ? (JSON.parse(t.tags) as string[]) : null;
      const value: SyncTask = {
        preferredId:
          prior?.kind === "task" && prior.value
            ? prior.value.preferredId
            : t.id,
        description: syncMetadataToDescription(
          t.description,
          t.priority as Priority | null,
          t.due_date,
          tags,
          null,
          [],
          [],
          [],
          [],
        ),
        createdAt: t.created_at,
        status: t.status ?? 0,
        listId: listIds.get(t.list_name)!,
        dueDate: t.due_date,
        priority: t.priority,
        tags,
        isTrashed: t.is_trashed ?? 0,
        sortOrder: t.sort_order ?? 0,
        completedAt: t.completed_at,
        parentId: t.parent_id ? (taskIds.get(t.parent_id) ?? null) : null,
      };
      result.push({ kind: "task", id, revision, value });
    }
    for (const edge of this.db.all<{ task_id: string; blocks_task_id: string }>(
      sql`SELECT * FROM task_dependencies`,
    )) {
      const from = taskIds.get(edge.task_id)!,
        to = taskIds.get(edge.blocks_task_id)!;
      result.push({
        kind: "dependency",
        id: canonical([from, to]),
        revision,
        value: { from, to },
      });
    }
    for (const edge of this.db.all<{ task_id_1: string; task_id_2: string }>(
      sql`SELECT * FROM task_relations`,
    )) {
      const [from, to] = [
        taskIds.get(edge.task_id_1)!,
        taskIds.get(edge.task_id_2)!,
      ].sort();
      result.push({
        kind: "relation",
        id: canonical([from, to]),
        revision,
        value: { from: from!, to: to! },
      });
    }
    return result.sort((a, b) => compareText(recordKey(a), recordKey(b)));
  }
  capture(seed = false, revive = false) {
    const snapshot = this.snapshot(seed, revive),
      baseline = JSON.parse(this.getMeta("baseline") ?? "[]") as SyncRecord[];
    const before = new Map(baseline.map((r) => [recordKey(r), r]));
    const after = new Map(snapshot.map((r) => [recordKey(r), r]));
    let revision: Revision = JSON.parse(
      this.getMeta("clock") ?? '{"time":0,"counter":0,"actor":"legacy"}',
    );
    let changed = false;
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const prev = before.get(key),
        current = after.get(key);
      if (canonical(prev?.value ?? null) === canonical(current?.value ?? null))
        continue;
      if (!changed && !seed)
        revision = nextRevision(revision, this.replica, this.now());
      changed = true;
      const record = current ?? ({ ...prev!, value: null } as SyncRecord);
      const stamp = seed
        ? {
            time:
              record.kind === "task" && record.value
                ? Date.parse(record.value.createdAt) || 0
                : 0,
            counter: 0,
            actor: "legacy",
          }
        : revision;
      this.put({ ...record, revision: stamp });
      if (compareRevision(stamp, revision) > 0) revision = stamp;
    }
    this.setMeta("baseline", canonical(snapshot));
    this.setMeta("clock", canonical(revision));
    if (changed) this.setMeta("dirty", "1");
    return changed;
  }
  exportRestoreBaseline() {
    return {
      records: this.records(),
      aliases: this.aliases(),
      baseline: this.getMeta("baseline") ?? "[]",
    };
  }
  rebaseAfterRestore(previous: ReturnType<SyncStore["exportRestoreBaseline"]>) {
    withTransaction(this.db, () => {
      const restoredAliases = this.aliases();
      this.db.run(sql`DELETE FROM sync_records`);
      for (const record of previous.records) this.put(record);
      this.db.run(sql`DELETE FROM sync_aliases`);
      for (const a of previous.aliases)
        this.alias(a.kind, a.local_key, a.id, a.hint);
      for (const a of restoredAliases) {
        const old = previous.aliases.find(
          (p) =>
            p.kind === a.kind &&
            p.local_key === a.local_key &&
            p.hint === a.hint,
        );
        if (!a.id.startsWith("legacy:") || !old)
          this.alias(a.kind, a.local_key, a.id, a.hint);
      }
      this.setMeta("baseline", previous.baseline);
      this.setMeta("pending", "");
      let clock: Revision = { time: 0, counter: 0, actor: "legacy" };
      for (const r of previous.records)
        if (compareRevision(r.revision, clock) > 0) clock = r.revision;
      this.setMeta("clock", canonical(clock));
      this.capture(false, true);
    });
  }
  /** Hosts must have validated all incoming records and installed referenced images first. */
  apply(incoming: SyncRecord[]) {
    return withTransaction(this.db, () => {
      this.capture();
      const local = this.records(),
        merged = mergeRecords(local, incoming);
      if (canonical(local) === canonical(merged)) return false;
      const localIds = new Map(
        this.aliases()
          .filter((a) => a.kind === "task")
          .map((a) => [a.id, a.local_key]),
      );
      const projection = projectRecords(merged, localIds);
      const previousProjection = canonical(
        this.snapshot(false, true).map(({ revision: _, ...r }) => r),
      );
      const localLists = new Map(
        this.db.all<RawList>(sql`SELECT * FROM lists`).map((l) => [l.name, l]),
      );
      const settings = new Map(
        this.aliases()
          .filter((a) => a.kind === "list")
          .map((a) => [a.id, localLists.get(a.local_key)]),
      );
      // Remove parent links before deleting rows: cascading deletes must not make
      // incoming insertion order observable, and all work remains in one transaction.
      this.db.run(sql`UPDATE tasks SET parent_id=NULL`);
      this.db.run(sql`DELETE FROM tasks`);
      this.db.run(sql`DELETE FROM lists`);
      this.db.run(sql`DELETE FROM sync_aliases`);
      for (const l of projection.lists) {
        const own = settings.get(l.syncId);
        this.db.run(
          sql`INSERT INTO lists(name,sort_order,is_collapsed,hide_completed) VALUES(${l.name},${l.sortOrder},${own?.is_collapsed ?? 0},${own?.hide_completed ?? 0})`,
        );
        this.alias("list", l.name, l.syncId);
      }
      for (const t of projection.tasks) {
        this.db.run(
          sql`INSERT INTO tasks(id,description,status,created_at,list_name,due_date,priority,tags,is_trashed,sort_order,completed_at,updated_at) VALUES(${t.id},${t.description},${t.status},${t.createdAt},${t.listName},${t.dueDate},${t.priority},${t.tags ? JSON.stringify(t.tags) : null},${t.isTrashed},${t.sortOrder},${t.completedAt},${new Date(merged.find((r) => r.kind === "task" && r.id === t.syncId)!.revision.time).toISOString()})`,
        );
        this.alias("task", t.id, t.syncId, t.createdAt);
      }
      for (const t of projection.tasks)
        if (t.parentId)
          this.db.run(
            sql`UPDATE tasks SET parent_id=${t.parentId} WHERE id=${t.id}`,
          );
      for (const e of projection.dependencies)
        this.db.run(
          sql`INSERT INTO task_dependencies(task_id,blocks_task_id) VALUES(${e.from},${e.to})`,
        );
      for (const e of projection.relations)
        this.db.run(
          sql`INSERT INTO task_relations(task_id_1,task_id_2) VALUES(${e.from},${e.to})`,
        );
      let clock: Revision = JSON.parse(this.getMeta("clock")!);
      for (const r of merged) {
        this.put(r);
        if (compareRevision(r.revision, clock) > 0) clock = r.revision;
      }
      this.setMeta("clock", canonical(clock));
      const baseline = this.snapshot(false, true);
      this.setMeta("baseline", canonical(baseline));
      this.setMeta("dirty", "1");
      const changed =
        previousProjection !==
        canonical(baseline.map(({ revision: _, ...r }) => r));
      if (changed) this.db.run(sql`DELETE FROM undo_history`);
      return changed;
    });
  }
}
