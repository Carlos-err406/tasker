import { describe, it, expect, vi } from "vitest";
import { MacUpdates, macRelease, newer } from "../src/service/updates.js";
function release(version = "0.1.2") {
  return {
    tag_name: "v" + version,
    assets: [
      `tasker-swiftbar-${version}-macos.tar.gz`,
      `tasker-swiftbar-${version}-macos.tar.gz.sha256`,
    ].map((name) => ({ name, state: "uploaded", size: 12 })),
  };
}
describe("Mac About updates", () => {
  it("compares stable versions numerically and never offers downgrades", () => {
    expect(newer("0.10.0", "0.9.9")).toBe(true);
    expect(newer("1.0.0", "1.0.0")).toBe(false);
    expect(macRelease(release("0.1.0"), "0.1.1")).toBeNull();
    expect(() => newer("0.1.2-beta", "0.1.1")).toThrow();
  });
  it("requires both Mac assets and a published stable release", () => {
    expect(macRelease(release(), "0.1.1")).toBe("0.1.2");
    for (const bad of [
      { ...release(), draft: true },
      { ...release(), prerelease: true },
      { ...release(), assets: [] },
      { ...release(), assets: release().assets.slice(0, 1) },
    ])
      expect(() => macRelease(bad, "0.1.1")).toThrow();
  });
  it("coalesces checks, clears busy on failure and retries", async () => {
    let fail = true;
    const request = vi.fn(async () => {
      if (fail) throw Error("offline");
      return new Response(JSON.stringify(release()));
    });
    const updates = new MacUpdates(request as typeof fetch, "0.1.1");
    await Promise.all([updates.check(), updates.check()]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(updates.status()).toMatchObject({ busy: false, error: "offline" });
    fail = false;
    expect(await updates.check()).toMatchObject({
      busy: false,
      version: "0.1.2",
      phase: "available",
      error: null,
    });
    expect(updates.releaseUrl()).toBe(
      "https://github.com/Carlos-err406/tasker/releases/tag/v0.1.2",
    );
  });
  it("handles missing releases and refuses to open a nonexistent update", async () => {
    const updates = new MacUpdates(
      (async () => new Response("", { status: 404 })) as typeof fetch,
    );
    expect(await updates.check()).toMatchObject({
      phase: "unpublished",
      busy: false,
    });
    expect(() => updates.releaseUrl()).toThrow();
  });
  it("rejects oversized provider responses and recovers controls", async () => {
    const updates = new MacUpdates(
      (async () =>
        new Response("x".repeat(2 * 1024 * 1024 + 1))) as typeof fetch,
    );
    expect(await updates.check()).toMatchObject({
      phase: "error",
      busy: false,
      error: "Update response is too large",
    });
  });
});
