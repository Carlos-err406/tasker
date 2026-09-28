import { expect, it } from "vitest";
import { GoogleConnection } from "../src/google/oauth.js";
import { DriveBackups } from "../src/google/drive.js";
it("validates OAuth state and exchanges PKCE before persisting credentials", async () => {
  let stored: string | null = null;
  const requests: URLSearchParams[] = [];
  const connection = new GoogleConnection(
    { clientId: "test-client" },
    {
      read: () => stored,
      write: (v) => {
        stored = v;
      },
      remove: () => {
        stored = null;
      },
    },
    async (_url, options) => {
      requests.push(new URLSearchParams(String(options?.body)));
      return Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
      });
    },
  );
  try {
    const url = new URL(await connection.connect());
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    const invalid = new URL(callback);
    invalid.searchParams.set("state", "wrong");
    invalid.searchParams.set("code", "code");
    expect((await fetch(invalid)).status).toBe(400);
    expect(stored).toBeNull();
    const valid = new URL(callback);
    valid.searchParams.set("state", url.searchParams.get("state")!);
    valid.searchParams.set("code", "code");
    expect((await fetch(valid)).status).toBe(200);
    expect(stored).toBe("refresh");
    expect(requests[0]!.get("code_verifier")!.length).toBeGreaterThan(40);
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(await connection.accessToken()).toBe("access");
    connection.disconnect();
    expect(stored).toBeNull();
  } finally {
    connection.close();
  }
});
it("reuses a found Drive upload after an ambiguous response instead of duplicating it", async () => {
  let creates = 0;
  const drive = new DriveBackups(
    async () => "access",
    async (url, options) => {
      const u = String(url);
      if (options?.method === "POST") {
        creates++;
        throw new Error("Unexpected duplicate upload");
      }
      if (u.includes("backupId"))
        return Response.json({
          files: [
            {
              id: "already-uploaded",
              size: "4",
              md5Checksum: "098f6bcd4621d373cade4e832627b4f6",
            },
          ],
        });
      return Response.json({ files: [{ id: "folder" }] });
    },
  );
  const manifest = {
    id: "a1234567-1234-1234-1234-123456789abc",
    formatVersion: 1 as const,
    schemaVersion: 1 as const,
    appVersion: "0.1.0",
    createdAt: new Date().toISOString(),
    kind: "manual" as const,
    sha256: "a".repeat(64),
    size: 4,
  };
  expect(await drive.upload(manifest, Buffer.from("test"))).toBe(
    "already-uploaded",
  );
  expect(creates).toBe(0);
});

it("reports revoked credentials without deleting the saved grant", async () => {
  let stored: string | null = "revoked";
  const connection = new GoogleConnection(
    { clientId: "test" },
    {
      read: () => stored,
      write: (v) => {
        stored = v;
      },
      remove: () => {
        stored = null;
      },
    },
    async () => new Response("", { status: 400 }),
  );
  await expect(connection.accessToken()).rejects.toThrow("Reconnect");
  expect(stored).toBe("revoked");
  connection.disconnect();
  expect(stored).toBeNull();
});
it("reports denied consent without creating credentials", async () => {
  let stored: string | null = null;
  const connection = new GoogleConnection(
    { clientId: "test" },
    {
      read: () => stored,
      write: (v) => {
        stored = v;
      },
      remove: () => {
        stored = null;
      },
    },
  );
  try {
    const url = new URL(await connection.connect());
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", url.searchParams.get("state")!);
    callback.searchParams.set("error", "access_denied");
    expect((await fetch(callback)).status).toBe(400);
    expect(stored).toBeNull();
    expect(connection.error).toContain("not granted");
  } finally {
    connection.close();
  }
});
it("reports quota errors without deleting Drive files", async () => {
  const methods: string[] = [];
  const drive = new DriveBackups(
    async () => "token",
    async (_url, options) => {
      methods.push(options?.method ?? "GET");
      return new Response("", { status: 403 });
    },
  );
  await expect(drive.list()).rejects.toThrow("quota");
  expect(methods).toEqual(["GET"]);
});

it("repairs an incomplete Drive upload instead of treating metadata as success", async () => {
  const methods: string[] = [];
  const drive = new DriveBackups(
    async () => "token",
    async (_url, options) => {
      const method = options?.method ?? "GET";
      methods.push(method);
      if (method === "GET")
        return Response.json({ files: [{ id: "partial", size: "0" }] });
      if (method === "PATCH")
        return new Response("", {
          headers: { location: "https://www.googleapis.com/upload-session" },
        });
      if (method === "PUT") return Response.json({ id: "partial" });
      throw new Error("Unexpected request");
    },
  );
  const manifest = {
    id: "a1234567-1234-1234-1234-123456789abc",
    formatVersion: 1 as const,
    schemaVersion: 1 as const,
    appVersion: "0.1.0",
    createdAt: new Date().toISOString(),
    kind: "manual" as const,
    sha256: "a".repeat(64),
    size: 4,
  };
  expect(await drive.upload(manifest, Buffer.from("test"))).toBe("partial");
  expect(methods).toEqual(["GET", "PATCH", "PUT"]);
});

it("does not let a cancelled callback change a newer connection", async () => {
  let release!: (response: Response) => void;
  let entered!: () => void;
  const exchanging = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let stored: string | null = null;
  const connection = new GoogleConnection(
    { clientId: "test" },
    {
      read: () => stored,
      write: (value) => {
        stored = value;
      },
      remove: () => {
        stored = null;
      },
    },
    async () => {
      entered();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    },
  );
  try {
    const old = new URL(await connection.connect());
    const callback = new URL(old.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", old.searchParams.get("state")!);
    callback.searchParams.set("code", "old");
    const response = fetch(callback);
    await exchanging;
    connection.disconnect();
    await connection.connect();
    release(
      Response.json({
        access_token: "stale",
        refresh_token: "stale",
        expires_in: 3600,
      }),
    );
    expect((await response).status).toBe(400);
    expect(stored).toBeNull();
    expect(connection.pending).toBe(true);
    expect(connection.error).toBeNull();
  } finally {
    connection.close();
  }
});

it("keeps Android snapshots out of Mac automatic retention", async () => {
  const deleted: string[] = [];
  const files = Array.from({ length: 10 }, (_, index) => {
    const id = `aaaaaaaa-aaaa-aaaa-aaaa-${String(index).padStart(12, "0")}`;
    return {
      id: `file-${index}`,
      appProperties: {
        backupId: id,
        ...(index === 0 ? { sourceDevice: "phone" } : {}),
      },
      description: JSON.stringify({
        id,
        formatVersion: 1,
        schemaVersion: 1,
        appVersion: "0.1.1",
        createdAt: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
        kind: "automatic",
        size: 4,
        sha256: "a".repeat(64),
      }),
    };
  });
  const drive = new DriveBackups(
    async () => "test",
    async (url, options) => {
      if (options?.method === "DELETE") {
        deleted.push(String(url));
        return new Response(null, { status: 204 });
      }
      return Response.json({ files });
    },
  );
  await drive.prune();
  expect(deleted.map((url) => url.split("/").pop())).toEqual([
    "file-2",
    "file-1",
  ]);
});
