import { canonical } from "./merge.js";
import { validateCheckpoint } from "./validation.js";
import {
  MAX_CHECKPOINT_BYTES,
  MAX_SYNC_IMAGE_BYTES,
  type Checkpoint,
  type SyncImage,
} from "./types.js";
import type { CheckpointFile, SyncTransport } from "./coordinator.js";
export interface SyncHttpResponse {
  status: number;
  headers: Record<string, string>;
  bytes: Uint8Array;
}
export interface SyncHttp {
  request(
    url: string,
    method: string,
    headers: Record<string, string>,
    bytes: Uint8Array | null,
    maxBytes: number,
  ): Promise<SyncHttpResponse>;
  cancel(): void;
}
export interface SyncImageStorage {
  read(
    id: string,
  ): Promise<{ bytes: Uint8Array; mimeType: string; createdAt: string } | null>;
  write(image: SyncImage, bytes: Uint8Array): Promise<void>;
}
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
export async function sha256(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await globalThis.crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(bytes).buffer,
      ),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
interface File {
  id: string;
  size?: string;
  appProperties?: Record<string, string>;
}
/** One Drive protocol for both hosts; OAuth tokens remain inside the HTTP adapter. */
export class SyncDrive implements SyncTransport {
  constructor(
    private http: SyncHttp,
    private images: SyncImageStorage,
    private namespace = "tasker-sync-v1",
  ) {
    if (!/^[a-z0-9-]{1,80}$/.test(namespace))
      throw new Error("Invalid sync namespace");
  }
  cancel() {
    this.http.cancel();
  }
  private async call(
    url: string,
    method = "GET",
    headers: Record<string, string> = {},
    bytes: Uint8Array | null = null,
    max = 2 * 1024 * 1024,
    allowConflict = false,
  ) {
    const r = await this.http.request(url, method, headers, bytes, max);
    if (r.bytes.length > max)
      throw new Error("Google Drive response exceeds the sync limit");
    if (r.status < 200 || r.status >= 300) {
      if (allowConflict && r.status === 409) return r;
      throw new Error(
        r.status === 401
          ? "Reconnect Google Drive to sync"
          : r.status === 403
            ? "Google Drive storage or permission denied"
            : `Google Drive sync failed (${r.status}). Retry later.`,
      );
    }
    return r;
  }
  private json(r: SyncHttpResponse): any {
    return JSON.parse(decoder.decode(r.bytes));
  }
  private async files(kind: string) {
    const found: File[] = [],
      seen = new Set<string>();
    let token = "";
    do {
      const p = new URLSearchParams({
        q: `trashed=false and appProperties has { key='syncApp' and value='${this.namespace}' } and appProperties has { key='kind' and value='${kind}' }`,
        pageSize: "100",
        fields: "nextPageToken,files(id,size,appProperties)",
      });
      if (token) p.set("pageToken", token);
      const result = this.json(await this.call(API + "/files?" + p));
      if (!Array.isArray(result.files))
        throw new Error("Invalid Drive file listing");
      found.push(...result.files);
      if (found.length > 100000) throw new Error("Too many sync files");
      token = result.nextPageToken ?? "";
      if (typeof token !== "string" || (seen.has(token) && token))
        throw new Error("Invalid Drive pagination");
      seen.add(token);
    } while (token);
    return found;
  }
  async account() {
    const data = this.json(
      await this.call(API + "/about?fields=user(permissionId)"),
    );
    if (typeof data.user?.permissionId !== "string" || !data.user.permissionId)
      throw new Error("Cannot identify the Google account");
    return data.user.permissionId as string;
  }
  async reserveId() {
    const data = this.json(
      await this.call(
        API + "/files/generateIds?count=1&space=drive&type=files",
      ),
    );
    const id = data.ids?.[0];
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id))
      throw new Error("Invalid Drive file ID");
    return id as string;
  }
  async list(): Promise<CheckpointFile[]> {
    return (await this.files("checkpoint")).map((f) => {
      const p = f.appProperties ?? {},
        sequence = Number(p.sequence);
      if (
        !/^[a-zA-Z0-9_-]{1,200}$/.test(f.id) ||
        !p.replica ||
        p.replica.length > 200 ||
        !Number.isSafeInteger(sequence) ||
        sequence < 1 ||
        !/^[a-f0-9]{64}$/.test(p.sha256 ?? "") ||
        !Number.isSafeInteger(Number(f.size)) ||
        Number(f.size) < 1 ||
        Number(f.size) > MAX_CHECKPOINT_BYTES
      )
        throw new Error("Invalid Drive sync checkpoint metadata");
      return { id: f.id, replica: p.replica, sequence, sha256: p.sha256! };
    });
  }
  async read(file: CheckpointFile) {
    const r = await this.call(
      API + "/files/" + encodeURIComponent(file.id) + "?alt=media",
      "GET",
      {},
      null,
      MAX_CHECKPOINT_BYTES,
    );
    if ((await sha256(r.bytes)) !== file.sha256)
      throw new Error("Sync checkpoint checksum mismatch");
    return validateCheckpoint(this.json(r));
  }
  private async upload(
    id: string,
    name: string,
    mime: string,
    bytes: Uint8Array,
    properties: Record<string, string>,
  ) {
    const hash = await sha256(bytes),
      metadata = {
        id,
        name,
        mimeType: mime,
        appProperties: { syncApp: this.namespace, ...properties, sha256: hash },
      };
    const boundary = "tasker_" + id;
    const begin = encoder.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      end = encoder.encode(`\r\n--${boundary}--\r\n`);
    const payload = new Uint8Array(begin.length + bytes.length + end.length);
    payload.set(begin);
    payload.set(bytes, begin.length);
    payload.set(end, begin.length + bytes.length);
    await this.call(
      UPLOAD + "?uploadType=multipart&fields=id",
      "POST",
      { "Content-Type": `multipart/related; boundary=${boundary}` },
      payload,
      2 * 1024 * 1024,
      true,
    );
    // A 409 may be a successful retry, but is not success until bytes match.
    const stored = await this.call(
      API + "/files/" + encodeURIComponent(id) + "?alt=media",
      "GET",
      {},
      null,
      bytes.length,
    );
    if (
      stored.bytes.length !== bytes.length ||
      (await sha256(stored.bytes)) !== hash
    )
      throw new Error("Google Drive did not confirm the complete sync upload");
  }
  async publish(id: string, checkpoint: Checkpoint) {
    validateCheckpoint(checkpoint);
    await this.upload(
      id,
      `Tasker sync ${checkpoint.replica} ${checkpoint.sequence}.json`,
      "application/json",
      encoder.encode(canonical(checkpoint)),
      {
        kind: "checkpoint",
        replica: checkpoint.replica,
        sequence: String(checkpoint.sequence),
      },
    );
  }
  async localImages(ids: string[]): Promise<SyncImage[]> {
    const result: SyncImage[] = [];
    for (const id of ids) {
      const image = await this.images.read(id);
      if (!image) throw new Error("A task image is missing on this device");
      result.push({
        id,
        mimeType: image.mimeType,
        createdAt: image.createdAt,
        size: image.bytes.length,
        sha256: await sha256(image.bytes),
      });
    }
    return result;
  }
  async uploadImages(images: SyncImage[]) {
    if (!images.length) return;
    const files = await this.files("image");
    for (const image of images) {
      const matches = files.filter(
        (f) => f.appProperties?.imageId === image.id,
      );
      if (matches.some((f) => f.appProperties?.sha256 !== image.sha256))
        throw new Error("Conflicting sync image identity");
      if (matches.some((f) => Number(f.size) === image.size)) continue;
      const local = await this.images.read(image.id);
      if (
        !local ||
        local.bytes.length !== image.size ||
        (await sha256(local.bytes)) !== image.sha256
      )
        throw new Error("Local sync image checksum mismatch");
      await this.upload(
        await this.reserveId(),
        `Tasker image ${image.id}`,
        image.mimeType,
        local.bytes,
        { kind: "image", imageId: image.id },
      );
    }
  }
  async downloadImages(images: SyncImage[]) {
    let files: File[] | undefined;
    for (const image of images) {
      const local = await this.images.read(image.id);
      if (local) {
        if (
          local.bytes.length !== image.size ||
          local.mimeType !== image.mimeType ||
          (await sha256(local.bytes)) !== image.sha256
        )
          throw new Error("Conflicting local image identity");
        continue;
      }
      files ??= await this.files("image");
      const file = files.find(
        (f) =>
          f.appProperties?.imageId === image.id &&
          f.appProperties.sha256 === image.sha256 &&
          Number(f.size) === image.size,
      );
      if (!file)
        throw new Error(
          "A synced image is not available yet. Tasker will retry.",
        );
      const r = await this.call(
        API + "/files/" + encodeURIComponent(file.id) + "?alt=media",
        "GET",
        {},
        null,
        MAX_SYNC_IMAGE_BYTES,
      );
      if (
        r.bytes.length !== image.size ||
        (await sha256(r.bytes)) !== image.sha256
      )
        throw new Error("Downloaded image checksum mismatch");
      await this.images.write(image, r.bytes);
    }
  }
  async prune(replica: string) {
    const own = (await this.list())
      .filter((f) => f.replica === replica)
      .sort((a, b) => b.sequence - a.sequence);
    const keep = new Set(own.slice(0, 2).map((f) => f.id));
    for (const file of own)
      if (!keep.has(file.id))
        await this.call(
          API + "/files/" + encodeURIComponent(file.id),
          "DELETE",
        );
  }
}
