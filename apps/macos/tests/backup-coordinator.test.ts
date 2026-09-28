import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BackupCoordinator } from "../src/backup/coordinator.js";
import type { BackupManager } from "../src/backup/manager.js";

// No Keychain or network. Inject these stand-ins through mocked constructors.
const fake = vi.hoisted(() => ({ upload: vi.fn(), prune: vi.fn() }));
vi.mock("../src/google/credentials.js", () => ({
  keychainCredentials: () => ({}),
}));
vi.mock("../src/google/oauth.js", () => ({
  GoogleConnection: class {
    connected() {
      return true;
    }
    close() {}
    disconnect() {}
  },
}));
vi.mock("../src/google/drive.js", () => ({
  DriveBackups: class {
    upload = fake.upload;
    prune = fake.prune;
  },
}));
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.resetAllMocks();
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "tasker-upload-state-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "snapshot"), "fixture");
  const local = {
    list: vi.fn(() => [{ id: "newest" }, { id: "older" }]),
    validate: vi.fn(),
    file: () => join(dir, "snapshot"),
  };
  const coordinator = new BackupCoordinator(
    local as unknown as BackupManager,
    dir,
    { clientId: "isolated-upload-test" },
  );
  return { coordinator, local };
}
it("clears uploading after synchronous validation failure and allows a retry", async () => {
  const { coordinator, local } = fixture();
  local.validate.mockImplementationOnce(() => {
    throw Error("Invalid snapshot");
  });
  await coordinator.upload();
  expect(coordinator.status()).toMatchObject({
    uploading: false,
    cloudError: "Invalid snapshot",
    lastCloud: null,
  });
  await coordinator.upload();
  expect(fake.upload).toHaveBeenCalledTimes(2);
  expect(coordinator.status()).toMatchObject({
    uploading: false,
    cloudError: null,
  });
});
it("reports completion after the entire job, uploads newest first, and coalesces clicks", async () => {
  const { coordinator } = fixture();
  let finish!: () => void;
  fake.prune.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = coordinator.upload();
  const second = coordinator.upload();
  await vi.waitFor(() => expect(fake.prune).toHaveBeenCalledOnce());
  expect(fake.upload.mock.calls.map(([m]) => m.id)).toEqual([
    "newest",
    "older",
  ]);
  expect(coordinator.status()).toMatchObject({
    uploading: true,
    lastCloud: null,
  });
  finish();
  await Promise.all([first, second]);
  expect(coordinator.status()).toMatchObject({
    uploading: false,
    cloudError: null,
  });
  expect(coordinator.status().lastCloud).not.toBeNull();
});
it("clears uploading after asynchronous failure", async () => {
  const { coordinator } = fixture();
  fake.upload.mockRejectedValueOnce(Error("Offline"));
  await coordinator.upload();
  expect(coordinator.status()).toMatchObject({
    uploading: false,
    cloudError: "Offline",
    lastCloud: null,
  });
});
