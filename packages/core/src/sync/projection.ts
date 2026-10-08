import { syncMetadataToDescription } from "../parsers/task-description-parser.js";
import type { Priority } from "../types/priority.js";
import { compareRevision, compareText, mergeRecords } from "./merge.js";
import {
  DEFAULT_LIST_ID,
  type SyncRecord,
  type SyncList,
  type SyncTask,
  type SyncEdge,
} from "./types.js";

type Live<K extends SyncRecord["kind"]> = Extract<SyncRecord, { kind: K }> & {
  value: NonNullable<Extract<SyncRecord, { kind: K }>["value"]>;
};
export interface ProjectedList extends SyncList {
  syncId: string;
}
export interface ProjectedTask extends SyncTask {
  syncId: string;
  id: string;
  listName: string;
}
export interface Projection {
  lists: ProjectedList[];
  tasks: ProjectedTask[];
  dependencies: SyncEdge[];
  relations: SyncEdge[];
}
function hash(value: string) {
  let n = 0;
  for (const c of value) n = (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0;
  return n;
}
function closesCycle(
  edges: Map<string, Set<string>>,
  from: string,
  to: string,
) {
  const seen = new Set<string>(),
    pending = [to];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(edges.get(id) ?? []));
  }
  return false;
}
/** Resolve aliases and graph constraints without changing the underlying winning records. */
export function projectRecords(
  records: SyncRecord[],
  localIds: ReadonlyMap<string, string> = new Map(),
): Projection {
  const all = mergeRecords([], records);
  const live = <K extends SyncRecord["kind"]>(kind: K) =>
    all.filter((r) => r.kind === kind && r.value !== null) as Live<K>[];
  const listRecords = live("list");
  if (!listRecords.some((r) => r.id === DEFAULT_LIST_ID))
    listRecords.unshift({
      kind: "list",
      id: DEFAULT_LIST_ID,
      revision: { time: 0, counter: 0, actor: "legacy" },
      value: { name: "tasks", sortOrder: 0 },
    });
  listRecords.sort((a, b) =>
    a.id === DEFAULT_LIST_ID
      ? -1
      : b.id === DEFAULT_LIST_ID
        ? 1
        : compareText(a.id, b.id),
  );
  const names = new Map<string, string>(),
    usedNames = new Set<string>();
  // Reserve original names first, then resolve collisions without stealing one.
  for (const r of listRecords) {
    const name = r.value.name;
    if (!usedNames.has(name)) {
      names.set(r.id, name);
      usedNames.add(name);
    }
  }
  for (const r of listRecords)
    if (!names.has(r.id)) {
      let suffix = 2,
        name: string;
      do {
        name = `${r.value.name.slice(0, 180)} (${suffix++})`;
      } while (usedNames.has(name));
      names.set(r.id, name);
      usedNames.add(name);
    }
  const tasks = live("task");
  if (tasks.length > 36 ** 3) throw new Error("No task IDs available for sync");
  const ids = new Map<string, string>(),
    usedIds = new Set<string>();
  for (const r of tasks) {
    const local = localIds.get(r.id);
    if (local && /^[a-z0-9]{3}$/.test(local) && !usedIds.has(local)) {
      ids.set(r.id, local);
      usedIds.add(local);
    }
  }
  for (const r of tasks)
    if (!ids.has(r.id) && !usedIds.has(r.value.preferredId)) {
      ids.set(r.id, r.value.preferredId);
      usedIds.add(r.value.preferredId);
    }
  for (const r of tasks)
    if (!ids.has(r.id)) {
      let n = hash(r.id) % 36 ** 3,
        id: string;
      do {
        id = n.toString(36).padStart(3, "0");
        n = (n + 1) % 36 ** 3;
      } while (usedIds.has(id));
      ids.set(r.id, id);
      usedIds.add(id);
    }
  const taskMap = new Map(tasks.map((r) => [r.id, r]));
  const listOf = (id: string) =>
    names.has(taskMap.get(id)!.value.listId)
      ? taskMap.get(id)!.value.listId
      : DEFAULT_LIST_ID;
  const parents = new Map<string, string>(),
    parentGraph = new Map<string, Set<string>>();
  const recentFirst = (a: SyncRecord, b: SyncRecord) =>
    compareRevision(b.revision, a.revision) || compareText(a.id, b.id);
  for (const r of [...tasks].sort(recentFirst)) {
    const parent = r.value.parentId;
    if (
      !parent ||
      !taskMap.has(parent) ||
      listOf(parent) !== listOf(r.id) ||
      closesCycle(parentGraph, r.id, parent)
    )
      continue;
    parents.set(r.id, parent);
    parentGraph.set(r.id, new Set([parent]));
  }
  const dependencies: SyncEdge[] = [],
    relations: SyncEdge[] = [],
    graph = new Map<string, Set<string>>();
  for (const r of live("dependency").sort(recentFirst)) {
    const { from, to } = r.value;
    if (!taskMap.has(from) || !taskMap.has(to) || closesCycle(graph, from, to))
      continue;
    if (!graph.has(from)) graph.set(from, new Set());
    graph.get(from)!.add(to);
    dependencies.push({ from, to });
  }
  for (const r of live("relation"))
    if (taskMap.has(r.value.from) && taskMap.has(r.value.to))
      relations.push(r.value);
  const alias = (id: string) => ids.get(id)!;
  const projected = tasks.map((r) => {
    const v = r.value,
      parent = parents.get(r.id) ?? null;
    const children = [...parents]
      .filter(([, p]) => p === r.id)
      .map(([c]) => alias(c))
      .sort();
    const outgoing = dependencies
      .filter((e) => e.from === r.id)
      .map((e) => alias(e.to))
      .sort();
    const incoming = dependencies
      .filter((e) => e.to === r.id)
      .map((e) => alias(e.from))
      .sort();
    const related = relations
      .filter((e) => e.from === r.id || e.to === r.id)
      .map((e) => alias(e.from === r.id ? e.to : e.from))
      .sort();
    return {
      ...v,
      syncId: r.id,
      id: alias(r.id),
      listName: names.get(listOf(r.id))!,
      parentId: parent ? alias(parent) : null,
      description: syncMetadataToDescription(
        v.description,
        v.priority as Priority | null,
        v.dueDate,
        v.tags,
        parent ? alias(parent) : null,
        outgoing,
        children,
        incoming,
        related,
      ),
    };
  });
  // Rewrite ranks to remove ties consistently without making fresh user edits.
  for (const group of new Set(
    projected.map((t) => `${t.listName}:${t.isTrashed}`),
  )) {
    projected
      .filter((t) => `${t.listName}:${t.isTrashed}` === group)
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || compareText(a.syncId, b.syncId),
      )
      .forEach((t, i) => {
        t.sortOrder = i;
      });
  }
  return {
    lists: listRecords
      .map((r) => ({ ...r.value, name: names.get(r.id)!, syncId: r.id }))
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || compareText(a.syncId, b.syncId),
      ),
    tasks: projected,
    dependencies: dependencies.map((e) => ({
      from: alias(e.from),
      to: alias(e.to),
    })),
    relations: relations.map((e) => {
      const [from, to] = [alias(e.from), alias(e.to)].sort();
      return { from: from!, to: to! };
    }),
  };
}
