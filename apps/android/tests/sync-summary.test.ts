import { describe, expect, it } from "vitest";
import { syncSummary } from "../src/sync-summary";

const now = new Date(2026, 9, 10, 15, 0);
const base = {
  enabled: true,
  syncing: false,
  pending: false,
  lastSync: new Date(2026, 9, 10, 14, 5).toISOString(),
  error: null,
};

describe("syncSummary", () => {
  it("hides while sync is off or unknown", () => {
    expect(syncSummary(null, now)).toBeNull();
    expect(syncSummary({ ...base, enabled: false }, now)).toBeNull();
  });

  it("puts syncing first, then failures, then waiting changes", () => {
    const all = { ...base, syncing: true, pending: true, error: "Offline" };
    expect(syncSummary(all, now)).toEqual({
      state: "syncing",
      label: "Syncing…",
    });
    expect(syncSummary({ ...all, syncing: false }, now)).toEqual({
      state: "failed",
      label: "Sync failed",
    });
    expect(syncSummary({ ...all, syncing: false, error: null }, now)).toEqual({
      state: "waiting",
      label: "Waiting to sync",
    });
    expect(syncSummary({ ...base, lastSync: null }, now)).toEqual({
      state: "waiting",
      label: "Not synced yet",
    });
  });

  it("shows the time of today's last sync and the date of an older one", () => {
    expect(syncSummary(base, now)).toEqual({
      state: "synced",
      label: `Synced ${new Date(base.lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    });
    const older = new Date(2026, 9, 8, 9, 0).toISOString();
    expect(syncSummary({ ...base, lastSync: older }, now)?.label).toBe(
      `Synced ${new Date(older).toLocaleDateString([], { month: "short", day: "numeric" })}`,
    );
  });
});
