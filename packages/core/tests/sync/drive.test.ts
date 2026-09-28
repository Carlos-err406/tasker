import { describe, expect, it } from "vitest";
import {
  SyncDrive,
  canonical,
  sha256,
  type SyncHttp,
  type SyncHttpResponse,
  type Checkpoint,
} from "../../src/sync/index.js";
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const answer = (value: unknown, status = 200): SyncHttpResponse => ({
  status,
  headers: {},
  bytes: encoder.encode(JSON.stringify(value)),
});
function fake() {
  const files = new Map<
    string,
    { bytes: Uint8Array; appProperties: Record<string, string> }
  >();
  let serial = 0;
  const http: SyncHttp = {
    cancel() {},
    async request(url, method, _headers, bytes) {
      const u = new URL(url);
      if (u.pathname.endsWith("/about"))
        return answer({ user: { permissionId: "account" } });
      if (u.pathname.endsWith("/generateIds"))
        return answer({ ids: ["file" + ++serial] });
      if (u.pathname === "/upload/drive/v3/files") {
        const body = decoder.decode(bytes!);
        const metadata = JSON.parse(
          body.split("\r\n\r\n")[1]!.split("\r\n--")[0]!,
        );
        if (files.has(metadata.id)) return answer({}, 409);
        const content = body.split("\r\n\r\n")[2]!.split("\r\n--")[0]!;
        files.set(metadata.id, {
          bytes: encoder.encode(content),
          appProperties: metadata.appProperties,
        });
        return answer({ id: metadata.id });
      }
      if (u.pathname === "/drive/v3/files") {
        const kind = u.searchParams.get("q")?.includes("value='checkpoint'")
          ? "checkpoint"
          : "image";
        return answer({
          files: [...files]
            .filter(([, f]) => f.appProperties.kind === kind)
            .map(([id, f]) => ({
              id,
              appProperties: f.appProperties,
              size: String(f.bytes.length),
            })),
        });
      }
      const id = u.pathname.split("/").at(-1)!;
      if (method === "DELETE") {
        files.delete(id);
        return { status: 204, headers: {}, bytes: new Uint8Array() };
      }
      const f = files.get(id);
      return f ? { status: 200, headers: {}, bytes: f.bytes } : answer({}, 404);
    },
  };
  const drive = new SyncDrive(http, {
    async read() {
      return null;
    },
    async write() {},
  });
  return { files, http, drive };
}
const checkpoint = (replica: string, sequence: number): Checkpoint => ({
  format: 1,
  replica,
  sequence,
  records: [],
  images: [],
});
describe("shared Drive sync protocol", () => {
  it("publishes, verifies, lists and reads a checkpoint using its reserved ID", async () => {
    const { drive } = fake();
    expect(await drive.account()).toBe("account");
    const id = await drive.reserveId(),
      c = checkpoint("a", 1);
    await drive.publish(id, c);
    await drive.publish(id, c);
    const listed = await drive.list();
    expect(listed).toHaveLength(1);
    expect(await drive.read(listed[0]!)).toEqual(c);
  });
  it("rejects a 409 when the existing file contains different bytes", async () => {
    const { drive } = fake();
    await drive.publish("file", checkpoint("a", 1));
    await expect(drive.publish("file", checkpoint("a", 2))).rejects.toThrow(
      "complete sync upload",
    );
  });
  it("detects corrupt downloaded checkpoint bytes", async () => {
    const { drive, files } = fake();
    await drive.publish("file", checkpoint("a", 1));
    const file = (await drive.list())[0]!;
    files.get("file")!.bytes = encoder.encode("changed");
    await expect(drive.read(file)).rejects.toThrow("checksum");
  });
  it("prunes only this replica while retaining its latest two checkpoints", async () => {
    const { drive, files } = fake();
    for (let n = 1; n <= 4; n++)
      await drive.publish("a" + n, checkpoint("a", n));
    await drive.publish("b1", checkpoint("b", 1));
    await drive.prune("a");
    expect([...files.keys()].sort()).toEqual(["a3", "a4", "b1"]);
  });
  it("rejects repeated pagination tokens and authentication failures", async () => {
    const { drive, http } = fake();
    http.request = async () => answer({ files: [], nextPageToken: "repeat" });
    await expect(drive.list()).rejects.toThrow("pagination");
    http.request = async () => answer({}, 401);
    await expect(drive.account()).rejects.toThrow("Reconnect Google");
  });
  it("rejects missing images before an incoming checkpoint can be applied", async () => {
    const { drive } = fake();
    await expect(
      drive.downloadImages([
        {
          id: "00000000-0000-0000-0000-000000000000",
          mimeType: "image/png",
          size: 3,
          sha256: await sha256(encoder.encode("png")),
          createdAt: "2026-09-28T00:00:00Z",
        },
      ]),
    ).rejects.toThrow("not available");
  });
  it("does not accept a listing that claims an unsupported oversized checkpoint", async () => {
    const { drive, http } = fake();
    http.request = async () =>
      answer({
        files: [
          {
            id: "file",
            size: String(17 * 1024 * 1024),
            appProperties: {
              replica: "a",
              sequence: "1",
              sha256: await sha256(
                encoder.encode(canonical(checkpoint("a", 1))),
              ),
            },
          },
        ],
      });
    await expect(drive.list()).rejects.toThrow("metadata");
  });
});
