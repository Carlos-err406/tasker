import { canonical, mergeRecords } from "./merge.js";
import {
  MAX_CHECKPOINT_BYTES,
  MAX_SYNC_IMAGE_BYTES,
  type Checkpoint,
} from "./types.js";
const object = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 1000): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const int = (v: unknown): v is number => Number.isSafeInteger(v);
const time = (v: unknown) => text(v, 40) && Number.isFinite(Date.parse(v));
const nullable = (v: unknown, check: (v: unknown) => boolean) =>
  v === null || check(v);
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const keys = (v: Record<string, any>, expected: string[]) =>
  Object.keys(v).length === expected.length &&
  expected.every((k) => Object.hasOwn(v, k));
function requireValid(valid: boolean): asserts valid {
  if (!valid) throw new Error("Invalid or unsupported sync data");
}
export function validateCheckpoint(value: unknown): Checkpoint {
  requireValid(
    object(value) &&
      keys(value, ["format", "replica", "sequence", "records", "images"]),
  );
  requireValid(
    value.format === 1 &&
      text(value.replica, 200) &&
      int(value.sequence) &&
      value.sequence >= 1,
  );
  requireValid(
    Array.isArray(value.records) &&
      value.records.length <= 100000 &&
      Array.isArray(value.images) &&
      value.images.length <= 50000,
  );
  requireValid(
    new TextEncoder().encode(canonical(value)).length <= MAX_CHECKPOINT_BYTES,
  );
  const seen = new Set<string>();
  for (const r of value.records) {
    requireValid(
      object(r) && keys(r, ["kind", "id", "revision", "value"]) && text(r.id),
    );
    requireValid(["list", "task", "dependency", "relation"].includes(r.kind));
    requireValid(
      object(r.revision) &&
        keys(r.revision, ["time", "counter", "actor"]) &&
        int(r.revision.time) &&
        r.revision.time >= 0 &&
        r.revision.time <= 8640000000000000 &&
        int(r.revision.counter) &&
        r.revision.counter >= 0 &&
        text(r.revision.actor, 200),
    );
    const key = r.kind + ":" + r.id;
    requireValid(!seen.has(key));
    seen.add(key);
    if (r.value === null) continue;
    const v = r.value;
    requireValid(object(v));
    if (r.kind === "list") {
      requireValid(
        keys(v, ["name", "sortOrder"]) &&
          text(v.name, 200) &&
          v.name.trim().length > 0 &&
          int(v.sortOrder),
      );
    } else if (r.kind === "task") {
      requireValid(
        keys(v, [
          "preferredId",
          "description",
          "createdAt",
          "status",
          "listId",
          "dueDate",
          "priority",
          "tags",
          "isTrashed",
          "sortOrder",
          "completedAt",
          "parentId",
        ]),
      );
      requireValid(
        typeof v.preferredId === "string" &&
          /^[a-z0-9]{3}$/.test(v.preferredId) &&
          typeof v.description === "string" &&
          v.description.length <= 100000 &&
          time(v.createdAt) &&
          [0, 1, 2, 3].includes(v.status) &&
          text(v.listId),
      );
      requireValid(
        nullable(
          v.dueDate,
          (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
        ) &&
          [null, 1, 2, 3].includes(v.priority) &&
          [0, 1].includes(v.isTrashed) &&
          int(v.sortOrder),
      );
      requireValid(
        nullable(
          v.tags,
          (t) =>
            Array.isArray(t) &&
            t.length <= 1000 &&
            t.every((tag) => text(tag, 200)),
        ) &&
          nullable(v.completedAt, time) &&
          nullable(v.parentId, (p) => text(p)),
      );
    } else {
      requireValid(
        keys(v, ["from", "to"]) &&
          text(v.from) &&
          text(v.to) &&
          v.from !== v.to,
      );
      requireValid(
        r.id ===
          canonical(
            r.kind === "relation" ? [v.from, v.to].sort() : [v.from, v.to],
          ),
      );
      if (r.kind === "relation") requireValid(v.from < v.to);
    }
  }
  const imageIds = new Set<string>();
  for (const i of value.images) {
    requireValid(
      object(i) &&
        keys(i, ["id", "mimeType", "size", "sha256", "createdAt"]) &&
        uuid(i.id) &&
        !imageIds.has(i.id),
    );
    requireValid(
      ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        i.mimeType,
      ) &&
        int(i.size) &&
        i.size > 0 &&
        i.size <= MAX_SYNC_IMAGE_BYTES &&
        /^[a-f0-9]{64}$/.test(i.sha256) &&
        time(i.createdAt),
    );
    imageIds.add(i.id);
  }
  for (const r of value.records)
    if (r.kind === "task" && r.value) {
      for (const match of r.value.description.matchAll(
        /\/attachments\/([a-f0-9-]{36})/g,
      ))
        requireValid(imageIds.has(match[1]));
    }
  const checkpoint = value as unknown as Checkpoint;
  return { ...checkpoint, records: mergeRecords([], checkpoint.records) };
}
