import type { Revision, SyncRecord } from "./types.js";

/** Locale-independent ordering is part of the wire protocol. */
export const compareText = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => compareText(a, b))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}
export function compareRevision(a: Revision, b: Revision) {
  return (
    a.time - b.time || a.counter - b.counter || compareText(a.actor, b.actor)
  );
}
export function nextRevision(
  observed: Revision,
  actor: string,
  now = Date.now(),
): Revision {
  const time = Math.max(now, observed.time);
  const counter = time === observed.time ? observed.counter + 1 : 0;
  if (!Number.isSafeInteger(time) || !Number.isSafeInteger(counter))
    throw new Error("Sync clock overflow");
  return { time, counter, actor };
}
export const recordKey = (r: Pick<SyncRecord, "kind" | "id">) =>
  `${r.kind}:${r.id}`;
export function mergeRecords(
  local: SyncRecord[],
  incoming: SyncRecord[],
): SyncRecord[] {
  const merged = new Map<string, SyncRecord>();
  for (const item of [...local, ...incoming]) {
    const key = recordKey(item),
      previous = merged.get(key);
    if (!previous) {
      merged.set(key, item);
      continue;
    }
    const order = compareRevision(item.revision, previous.revision);
    if (order > 0) merged.set(key, item);
    else if (
      order === 0 &&
      canonical(item.value) !== canonical(previous.value)
    ) {
      // Legacy databases did not record edit revisions. Use a content tie-break
      // only for those baselines; never silently accept a forged live revision.
      if (item.revision.actor !== "legacy")
        throw new Error("Conflicting sync revision");
      if (compareText(canonical(item.value), canonical(previous.value)) > 0)
        merged.set(key, item);
    }
  }
  return [...merged.values()].sort((a, b) =>
    compareText(recordKey(a), recordKey(b)),
  );
}
