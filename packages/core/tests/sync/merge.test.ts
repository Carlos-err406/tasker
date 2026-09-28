import { describe, expect, it } from "vitest";
import {
  mergeRecords,
  nextRevision,
  compareRevision,
  validateCheckpoint,
  type SyncRecord,
} from "../../src/sync/index.js";
const record = (
  id: string,
  time: number,
  actor = "a",
  deleted = false,
): SyncRecord => ({
  kind: "list",
  id,
  revision: { time, counter: 0, actor },
  value: deleted ? null : { name: id, sortOrder: time },
});
describe("sync convergence", () => {
  it("merges independent edits and chooses latest edits regardless of delivery order", () => {
    const a = [record("one", 10), record("two", 20)];
    const b = [record("one", 30, "b"), record("three", 25, "b")];
    expect(mergeRecords(a, b)).toEqual(mergeRecords(b, a));
    expect(mergeRecords(a, b).find((r) => r.id === "one")?.revision.time).toBe(
      30,
    );
    expect(mergeRecords(a, b)).toHaveLength(3);
  });
  it("is associative and idempotent through shuffled, duplicated deliveries", () => {
    const batches = Array.from({ length: 20 }, (_, i) => [
      record(`task${i % 4}`, i, `actor${i % 3}`, i % 5 === 0),
    ]);
    const expected = batches.reduce(mergeRecords, []);
    for (let offset = 0; offset < batches.length; offset++) {
      const shuffled = [
        ...batches.slice(offset),
        ...batches.slice(0, offset),
      ].reverse();
      expect(shuffled.concat(shuffled).reduce(mergeRecords, [])).toEqual(
        expected,
      );
    }
  });
  it("retains deletion tombstones against stale devices and permits newer explicit restoration", () => {
    const deleted = record("one", 30, "a", true);
    expect(mergeRecords([deleted], [record("one", 20)])[0]?.value).toBeNull();
    expect(
      mergeRecords([deleted], [record("one", 40)])[0]?.value,
    ).not.toBeNull();
  });
  it("breaks equal-time conflicts deterministically", () => {
    const a = record("one", 5, "a"),
      b = record("one", 5, "b");
    expect(mergeRecords([a], [b])).toEqual([b]);
    expect(mergeRecords([b], [a])).toEqual([b]);
  });
  it("rejects conflicting payloads claiming the same nonlegacy revision", () => {
    const a = record("one", 10),
      b = { ...a, value: { name: "different", sortOrder: 0 } };
    expect(() => mergeRecords([a], [b])).toThrow(/revision/i);
  });
  it("orders local writes after observed clocks even after clock rollback", () => {
    const observed = { time: 1000, counter: 8, actor: "other" };
    const next = nextRevision(observed, "local", 900);
    expect(compareRevision(next, observed)).toBeGreaterThan(0);
    expect(next).toEqual({ time: 1000, counter: 9, actor: "local" });
  });
  it("rejects malformed and future checkpoint formats before merge", () => {
    const checkpoint = {
      format: 1,
      replica: "a",
      sequence: 1,
      records: [record("one", 1)],
      images: [],
    };
    expect(validateCheckpoint(checkpoint)).toEqual(checkpoint);
    for (const invalid of [
      { ...checkpoint, format: 2 },
      { ...checkpoint, sequence: -1 },
      { ...checkpoint, records: [record("one", Infinity)] },
      { ...checkpoint, records: [{ ...record("one", 1), kind: "config" }] },
    ]) {
      expect(() => validateCheckpoint(invalid)).toThrow();
    }
  });
});
