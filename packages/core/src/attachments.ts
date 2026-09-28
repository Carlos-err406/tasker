import { randomUUID } from "node:crypto";
import type { TaskerDb } from "./db.js";
import { getRawDb } from "./db-node.js";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const formats = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export function saveImage(db: TaskerDb, bytes: Uint8Array, mimeType: string) {
  if (!formats.has(mimeType))
    throw new Error("Use a PNG, JPEG, WebP or GIF image");
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES)
    throw new Error("Images must be between 1 byte and 10 MB");
  const id = randomUUID();
  getRawDb(db)
    .prepare("INSERT INTO attachments VALUES (?,?,?,?,?)")
    .run(
      id,
      mimeType,
      bytes.byteLength,
      new Date().toISOString(),
      Buffer.from(bytes),
    );
  return { id, reference: `/attachments/${id}` };
}
export function getImage(db: TaskerDb, id: string) {
  const row = getRawDb(db)
    .prepare("SELECT mime_type, data FROM attachments WHERE id=?")
    .get(id) as { mime_type: string; data: Buffer } | undefined;
  return row ? { mimeType: row.mime_type, data: row.data } : null;
}
