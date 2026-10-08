import { createHash } from "node:crypto";
import type { BackupManifest } from "../backup/manager.js";
interface DriveFile {
  id: string;
  size?: string;
  md5Checksum?: string;
  description?: string;
  appProperties?: Record<string, string>;
}
const API = "https://www.googleapis.com/drive/v3/files";
const MAX_CLOUD_BYTES = 512 * 1024 * 1024;
export class DriveBackups {
  constructor(
    private token: () => Promise<string>,
    private request: typeof fetch = fetch,
  ) {}
  private async call(url: string, options: RequestInit = {}) {
    const response = await this.request(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${await this.token()}`,
      },
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Reconnect Google Drive"
          : response.status === 403
            ? "Drive quota or permission denied. Check available storage and access."
            : `Google Drive request failed (${response.status}). Retry later.`,
      );
    return response;
  }
  private async find(query: string): Promise<DriveFile[]> {
    let pageToken = "";
    const files: DriveFile[] = [];
    do {
      const params = new URLSearchParams({
        q: `trashed = false and (${query})`,
        fields:
          "nextPageToken,files(id,description,appProperties,size,md5Checksum)",
        pageSize: "100",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const result = (await (await this.call(API + "?" + params)).json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      files.push(...(result.files ?? []));
      pageToken = result.nextPageToken ?? "";
    } while (pageToken);
    return files;
  }
  private async folder() {
    const files = await this.find(
      "mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='app' and value='tasker-swiftbar' }",
    );
    if (files[0]) return files[0].id;
    const result = (await (
      await this.call(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Tasker backups",
          mimeType: "application/vnd.google-apps.folder",
          appProperties: { app: "tasker-swiftbar" },
        }),
      })
    ).json()) as DriveFile;
    return result.id;
  }
  async upload(manifest: BackupManifest, bytes: Buffer) {
    if (bytes.length > MAX_CLOUD_BYTES)
      throw new Error("Cloud backup exceeds the 512 MB MVP limit");
    const found = await this.find(
      `appProperties has { key='app' and value='tasker-swiftbar' } and appProperties has { key='backupId' and value='${manifest.id}' }`,
    );
    const existing = found[0];
    if (
      existing?.size === String(bytes.length) &&
      existing.md5Checksum === createHash("md5").update(bytes).digest("hex")
    )
      return existing.id;
    const folder = existing ? undefined : await this.folder();
    const metadata = {
      name: `Tasker-${manifest.createdAt.slice(0, 10)}-${manifest.id}.sqlite`,
      ...(folder ? { parents: [folder] } : {}),
      description: JSON.stringify(manifest),
      appProperties: {
        app: "tasker-swiftbar",
        kind: "snapshot",
        backupId: manifest.id,
      },
    };
    const start = await this.call(
      "https://www.googleapis.com/upload/drive/v3/files" +
        (existing ? "/" + encodeURIComponent(existing.id) : "") +
        "?uploadType=resumable",
      {
        method: existing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "application/vnd.sqlite3",
          "X-Upload-Content-Length": String(bytes.length),
        },
        body: JSON.stringify(metadata),
      },
    );
    const location = start.headers.get("location");
    if (!location || new URL(location).origin !== "https://www.googleapis.com")
      throw new Error("Invalid Drive upload session");
    const response = await this.call(location, {
      method: "PUT",
      headers: { "Content-Type": "application/vnd.sqlite3" },
      body: new Uint8Array(bytes),
    });
    const result = (await response.json()) as DriveFile;
    if (!result.id) throw new Error("Drive did not confirm the upload");
    return result.id;
  }
  async list() {
    const files = await this.find(
      "appProperties has { key='app' and value='tasker-swiftbar' } and appProperties has { key='kind' and value='snapshot' }",
    );
    return files
      .flatMap((file) => {
        try {
          const manifest = JSON.parse(file.description ?? "") as BackupManifest;
          if (
            !/^[a-f0-9-]{36}$/.test(manifest.id) ||
            manifest.id !== file.appProperties?.backupId ||
            manifest.formatVersion !== 1 ||
            manifest.schemaVersion !== 1 ||
            !["manual", "automatic", "safety"].includes(manifest.kind) ||
            !Number.isSafeInteger(manifest.size) ||
            manifest.size < 0 ||
            manifest.size > MAX_CLOUD_BYTES ||
            !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
            !Number.isFinite(Date.parse(manifest.createdAt))
          )
            return [];
          return [
            {
              ...manifest,
              fileId: file.id,
              sourceDevice: file.appProperties?.sourceDevice,
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  async download(fileId: string) {
    const manifest = (await this.list()).find((b) => b.fileId === fileId);
    if (!manifest) throw new Error("App backup not found in Drive");
    const response = await this.call(
      API + "/" + encodeURIComponent(fileId) + "?alt=media",
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Drive download");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > manifest.size || size > MAX_CLOUD_BYTES)
          throw new Error("Unexpected backup download size");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    }
    return { manifest, bytes: Buffer.concat(chunks) };
  }
  async prune() {
    // Android manages retention for snapshots marked with its own device ID.
    const automatic = (await this.list()).filter(
      (b) => b.kind === "automatic" && !b.sourceDevice,
    );
    for (const old of automatic.slice(7))
      await this.call(API + "/" + encodeURIComponent(old.fileId), {
        method: "DELETE",
      });
  }
}
