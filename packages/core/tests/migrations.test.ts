import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, createTestDb, getRawDb } from '../src/db-node.js';
import { migrateTaskIds } from '../src/migrations.js';
import { migrateLegacyTaskRefs, syncMetadataToDescription } from '../src/parsers/task-description-parser.js';
import type { Priority } from '../src/types/priority.js';
import { getTaskById, searchTasks } from '../src/queries/task-queries.js';
import { getAllListsOrder } from '../src/queries/all-lists-order.js';
import { getDeliveredReminders } from '../src/queries/settings-queries.js';
import { SyncStore, canonical, validateCheckpoint, type SyncRecord } from '../src/sync/index.js';
import { generateId, isTaskId, migrateLegacyTaskId } from '../src/task-id.js';

const CREATED = '2026-01-01T00:00:00.000Z';
const id = (legacy: string) => migrateLegacyTaskId(legacy, CREATED);

/** A database as 1.3.0 left it: 3-character IDs, references and per-device config. */
function legacyDb() {
  const db = createTestDb();
  const raw = getRawDb(db);
  const insert = raw.prepare(
    'INSERT INTO tasks(id,description,created_at,list_name,parent_id,sort_order) VALUES(?,?,?,?,?,?)',
  );
  insert.run('9kf', 'Parent\n-^c01 !b02 ~r03 p1 #tasker', CREATED, 'tasks', null, 0);
  raw.prepare(`UPDATE tasks SET priority=1, tags='["tasker"]' WHERE id='9kf'`).run();
  insert.run('c01', 'Child mentions ^9kf in prose\n^9kf', CREATED, 'tasks', '9kf', 1);
  insert.run('b02', 'Blocked\n-!9kf ^zzz', CREATED, 'tasks', null, 2);
  insert.run('r03', 'Related\n~9kf', CREATED, 'tasks', null, 3);
  raw.prepare('INSERT INTO task_dependencies(task_id,blocks_task_id) VALUES(?,?)').run('9kf', 'b02');
  raw.prepare('INSERT INTO task_relations(task_id_1,task_id_2) VALUES(?,?)').run('9kf', 'r03');
  raw.prepare("INSERT INTO config(key,value) VALUES('all_lists_order',?)").run(JSON.stringify(['r03', '9kf']));
  raw
    .prepare("INSERT INTO config(key,value) VALUES('reminders:delivered',?)")
    .run(JSON.stringify([{ key: '9kf@2026-01-02T09:00', at: 1 }]));
  raw
    .prepare("INSERT INTO undo_history(stack_type,command_json,created_at) VALUES('undo','{}',?)")
    .run(CREATED);
  return db;
}

/** Sync state as 1.3.0 wrote it: its parser read 3-character references, so synced descriptions omit them. */
function syncAs130(db: ReturnType<typeof createTestDb>, replica = 'mac') {
  const store = new SyncStore(db, replica, randomUUID);
  const strip = (r: SyncRecord): SyncRecord =>
    r.kind === 'task' && r.value
      ? {
          ...r,
          value: {
            ...r.value,
            description: syncMetadataToDescription(
              migrateLegacyTaskRefs(r.value.description, () => undefined),
              r.value.priority as Priority | null,
              r.value.dueDate,
              r.value.tags,
            ),
          },
        }
      : r;
  for (const r of store.records())
    db.run(sql`UPDATE sync_records SET record_json=${canonical(strip(r))} WHERE kind=${r.kind} AND id=${r.id}`);
  store.setMeta('baseline', canonical((JSON.parse(store.getMeta('baseline')!) as SyncRecord[]).map(strip)));
  return store;
}

describe('task IDs', () => {
  it('generates prefixed IDs', () => {
    const generated = generateId();
    expect(generated).toMatch(/^tsk_[a-z0-9]{5}$/);
    expect(isTaskId(generated)).toBe(true);
    expect(isTaskId('lol')).toBe(false);
    expect(isTaskId('tsk_lol')).toBe(false);
  });

  it('migrates a legacy ID deterministically, keeping its characters', () => {
    expect(id('9kf')).toMatch(/^tsk_9kf[a-z0-9]{2}$/);
    expect(id('9kf')).toBe(migrateLegacyTaskId('9kf', CREATED));
    expect(isTaskId(id('9kf'))).toBe(true);
  });
});

describe('migrateLegacyTaskRefs', () => {
  const ids = new Map([['abc', 'tsk_abc00'], ['def', 'tsk_def00']]);
  const next = (legacy: string) => ids.get(legacy);

  it('rewrites references on the metadata lines only', () => {
    expect(migrateLegacyTaskRefs('See ^abc here\n^abc -!def p1 #x', next)).toBe('See ^abc here\n^tsk_abc00 -!tsk_def00 p1 #x');
  });

  it('drops references to missing tasks and lines they leave empty', () => {
    expect(migrateLegacyTaskRefs('Task\n~zzz\n#tag ^zzz', next)).toBe('Task\n#tag');
  });

  it('leaves descriptions without legacy references untouched', () => {
    expect(migrateLegacyTaskRefs('Task\n^tsk_abc00 p1', next)).toBe('Task\n^tsk_abc00 p1');
    expect(migrateLegacyTaskRefs('Just  text ', next)).toBe('Just  text ');
  });
});

describe('migrateTaskIds', () => {
  it('renames tasks with their relationships, references and config', () => {
    const db = legacyDb();
    expect(migrateTaskIds(db)).toBe(true);

    const parent = getTaskById(db, id('9kf'))!;
    expect(parent.description).toBe(`Parent\n-^${id('c01')} !${id('b02')} ~${id('r03')} p1 #tasker`);
    const child = getTaskById(db, id('c01'))!;
    expect(child.parentId).toBe(id('9kf'));
    expect(child.description).toBe(`Child mentions ^9kf in prose\n^${id('9kf')}`);
    expect(getTaskById(db, id('b02'))!.description).toBe(`Blocked\n-!${id('9kf')}`);

    expect(db.all(sql`SELECT id FROM tasks WHERE id NOT LIKE 'tsk%'`)).toEqual([]);
    expect(db.all(sql`SELECT * FROM task_dependencies`)).toEqual([
      { task_id: id('9kf'), blocks_task_id: id('b02') },
    ]);
    expect(db.all(sql`SELECT * FROM task_relations`)).toEqual([
      { task_id_1: id('9kf'), task_id_2: id('r03') },
    ]);
    expect(getAllListsOrder(db).slice(-2)).toEqual([id('r03'), id('9kf')]);
    expect(getDeliveredReminders(db)).toEqual(new Set([`${id('9kf')}@2026-01-02T09:00`]));
    expect(db.all(sql`SELECT * FROM undo_history`)).toEqual([]);
    expect(getRawDb(db).pragma('foreign_key_check')).toEqual([]);

    expect(migrateTaskIds(db)).toBe(false);
  });

  it('keeps sync identities, so migrating publishes no edits', () => {
    const db = legacyDb();
    const store = syncAs130(db);
    const before = store.records();
    expect(migrateTaskIds(db)).toBe(true);

    expect(store.capture()).toBe(false);
    const after = store.records();
    expect(after.map((r) => [r.kind, r.id, r.revision])).toEqual(before.map((r) => [r.kind, r.id, r.revision]));
    const parent = after.find((r) => r.kind === 'task' && r.id.startsWith('legacy:task:9kf:'));
    expect(parent?.kind === 'task' && parent.value?.preferredId).toBe(id('9kf'));
    expect(store.taskIdentity(id('9kf'))).toBe(parent?.id);
  });

  it('seeds the identities an unmigrated device would, when sync never ran', () => {
    const migrated = legacyDb();
    migrateTaskIds(migrated);
    const unmigrated = new SyncStore(legacyDb(), 'phone', randomUUID);
    const ids = (records: SyncRecord[]) => records.filter((r) => r.kind === 'task').map((r) => r.id);
    expect(ids(new SyncStore(migrated, 'mac', randomUUID).records())).toEqual(ids(unmigrated.records()));
  });

  it('accepts a 1.3.0 checkpoint and converges on the same IDs', () => {
    const phone = syncAs130(legacyDb(), 'phone');
    const records = phone.records();
    const legacy = validateCheckpoint({ format: 1, replica: 'phone', sequence: 1, records, images: [] });
    expect(legacy.format).toBe(2);

    const macDb = legacyDb();
    const mac = syncAs130(macDb);
    migrateTaskIds(macDb);
    expect(mac.apply(legacy.records)).toBe(false);
    expect(getTaskById(macDb, id('9kf'))?.description).toContain(`-^${id('c01')}`);
    expect(() =>
      validateCheckpoint({ format: 2, replica: 'phone', sequence: 1, records, images: [] }),
    ).toThrow();
  });

  it('migrates a pending upload to the new checkpoint format', () => {
    const db = legacyDb();
    const store = new SyncStore(db, 'mac', randomUUID);
    const checkpoint = { format: 1, replica: 'mac', sequence: 1, records: store.records(), images: [] };
    store.setMeta('pending', canonical({ id: 'file', checkpoint }));
    migrateTaskIds(db);
    const pending = JSON.parse(store.getMeta('pending')!);
    expect(pending.id).toBe('file');
    expect(validateCheckpoint(pending.checkpoint)).toMatchObject({ format: 2, replica: 'mac' });
    expect(pending.checkpoint.format).toBe(2);
  });

  it('runs when a database is opened', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tasker-migrate-'));
    try {
      const path = join(dir, 'tasker.db');
      const db = createDb(path);
      getRawDb(db)
        .prepare('INSERT INTO tasks(id,description,created_at,list_name) VALUES(?,?,?,?)')
        .run('abc', 'Old', CREATED, 'tasks');
      getRawDb(db).close();
      const reopened = createDb(path);
      expect(getTaskById(reopened, id('abc'))?.description).toBe('Old');
      expect(searchTasks(reopened, 'id:abc').map((t) => t.id)).toEqual([id('abc')]);
      expect(searchTasks(reopened, `id:${id('abc')}`).map((t) => t.id)).toEqual([id('abc')]);
      getRawDb(reopened).close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
