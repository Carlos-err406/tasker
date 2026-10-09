import { createMacSync } from "../sync/coordinator.js";
import { MacUpdates } from "./updates.js";
import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { saveImage, getImage, MAX_IMAGE_BYTES } from "@tasker/core/attachments";
import { BackupManager, recoverRestore } from "../backup/manager.js";
import { BackupCoordinator } from "../backup/coordinator.js";
import type { GoogleClient } from "../google/oauth.js";
import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname, sep } from "node:path";
import { createDb, getRawDb, UndoManager } from "@tasker/core";
import { createRegistry } from "./registry.js";
import { startReminders, type Notify } from "./reminders.js";
export interface ServiceOptions {
  directory: string;
  port?: number;
  assets?: string;
  google?: GoogleClient;
  automaticBackups?: boolean;
  /** Override the native opener for isolated tests. */
  openTarget?: (target: string) => Promise<void>;
  /** Posts due-time reminders; reminders are off without it (tests never post real ones). */
  notify?: Notify;
  /** Override the clock for reminder tests. */
  now?: () => Date;
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function body(
  req: IncomingMessage,
  limit = 1024 * 1024,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function equal(a: unknown, b: string) {
  return (
    typeof a === "string" &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export async function startService(options: ServiceOptions) {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const lock = new Database(join(options.directory, "service-lock.sqlite"));
  try {
    lock.pragma("busy_timeout = 0");
    lock.exec("BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    throw new Error("Tasker is already running for this data directory");
  }
  try {
    recoverRestore(options.directory);
  } catch (error) {
    lock.close();
    throw error;
  }
  let db = createDb(join(options.directory, "tasker.db"));
  let registry = createRegistry(db, new UndoManager(db));
  const backups = new BackupManager(
    options.directory,
    () => db,
    () => getRawDb(db).close(),
    () => {
      db = createDb(join(options.directory, "tasker.db"));
      registry = createRegistry(db, new UndoManager(db));
    },
  );
  const coordinator = new BackupCoordinator(
    backups,
    options.directory,
    options.google,
  );
  let syncRevision = 0;
  const updates = new MacUpdates();
  let sync = createMacSync(db, options.directory, coordinator, () => {
    syncRevision++;
  });
  registry = createRegistry(db, new UndoManager(db), sync.store);
  const openTarget =
    options.openTarget ??
    (async (target: string) => {
      await promisify(execFile)("/usr/bin/open", [target]);
    });
  let imageDirectory: Promise<string> | undefined;
  const openExternal = async (value: unknown) => {
    if (typeof value !== "string") throw new HttpError(400, "Invalid link");
    const attachment =
      /^\/attachments\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(
        value,
      );
    if (attachment) {
      const image = getImage(db, attachment[1]!);
      if (!image) throw new HttpError(404, "Image not found");
      const extension = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
      }[image.mimeType];
      if (!extension) throw new HttpError(400, "Unsupported image type");
      // A private disposable copy lets the native viewer read a database BLOB.
      imageDirectory ??= mkdtemp(join(tmpdir(), "tasker-images-"));
      const path = join(await imageDirectory, `${attachment[1]}.${extension}`);
      await writeFile(path, image.data, { mode: 0o600 });
      await openTarget(path);
      return;
    }
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol))
      throw new HttpError(400, "Only web links can be opened");
    await openTarget(url.toString());
  };
  let restoring = false;
  const token = randomBytes(32).toString("base64url");
  const session = randomBytes(32).toString("base64url");
  let origin = "";
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host)
        throw new HttpError(403, "Unexpected host");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      const url = new URL(req.url ?? "/", origin);
      const authorized = (req.headers.cookie ?? "")
        .split(";")
        .some((c) => equal(c.trim(), `tasker_session=${session}`));
      if (req.method === "POST") {
        if (req.headers.origin !== origin)
          throw new HttpError(403, "Unexpected origin");
        if (url.pathname === "/session") {
          if (!equal(req.headers["x-tasker-bootstrap"], token))
            throw new HttpError(403, "Authentication required");
          res.setHeader(
            "Set-Cookie",
            `tasker_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
          );
          res.writeHead(204).end();
          return;
        }
        if (!authorized || req.headers["x-tasker-request"] !== "1")
          throw new HttpError(403, "Authentication required");
        if (restoring) throw new HttpError(503, "Restore in progress");
        if (url.pathname === "/rpc") {
          if (req.headers["content-type"] !== "application/json")
            throw new HttpError(415, "JSON required");
          let result;
          try {
            const input = JSON.parse((await body(req)).toString());
            result = await registry.invoke(input.channel, input.args);
            if (
              !/^(tasks:(get|search)|lists:(get|is|setCollapsed|setHideCompleted)|undo:(can|reload)|settings:)/.test(
                input.channel,
              )
            ) {
              sync.engine.localChanged();
              // Agent edits reach an open popover through the change revision.
              if (req.headers["x-tasker-client"] === "agent") syncRevision++;
            }
          } catch (error) {
            if (error instanceof HttpError) throw error;
            throw new HttpError(
              400,
              error instanceof Error ? error.message : "Invalid request",
            );
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
          return;
        }
        if (url.pathname === "/attachments") {
          const mime = req.headers["content-type"] ?? "";
          const data = await body(req, MAX_IMAGE_BYTES);
          const result = saveImage(db, data, mime);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
          return;
        }
        if (url.pathname === "/manage") {
          const input = JSON.parse((await body(req)).toString());
          let result: unknown;
          switch (input.action) {
            case "updates-status":
              result = updates.status();
              break;
            case "updates-check":
              result = await updates.check();
              break;
            case "updates-install":
              await openExternal(updates.releaseUrl());
              result = updates.status();
              break;
            case "sync-status":
              result = { ...sync.engine.status(), revision: syncRevision };
              break;
            case "sync-enable":
              await sync.engine.enable();
              result = sync.engine.status();
              break;
            case "sync-now":
              result = await sync.engine.syncNow();
              break;
            case "sync-pause":
              sync.engine.pause();
              result = sync.engine.status();
              break;
            case "sync-editing":
              sync.engine.setEditing(input.editing === true);
              result = true;
              break;
            case "status":
              result = coordinator.status();
              break;
            case "backup":
              result = coordinator.create();
              break;
            case "upload":
              await coordinator.upload();
              result = coordinator.status();
              break;
            case "cloud-list":
              result = await coordinator.listCloud();
              break;
            case "connect":
              await openExternal(await coordinator.connect());
              result = {};
              break;
            case "disconnect":
              sync.engine.pause();
              coordinator.disconnect();
              result = {};
              break;
            case "open":
              await openExternal(input.url);
              result = {};
              break;
            case "restore":
              if (input.confirm !== true || typeof input.id !== "string")
                throw new HttpError(
                  400,
                  "Explicit restore confirmation required",
                );
              sync.beforeRestore();
              restoring = true;
              try {
                result = input.cloud
                  ? await coordinator.restoreCloud(input.id)
                  : backups.restore(input.id);
              } finally {
                sync = createMacSync(db, options.directory, coordinator, () => {
                  syncRevision++;
                });
                registry = createRegistry(db, new UndoManager(db), sync.store);
                sync.engine.start();
                syncRevision++;
                restoring = false;
              }
              break;
            default:
              throw new HttpError(400, "Unknown action");
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
          return;
        }
        throw new HttpError(404, "Not found");
      }
      if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
      if (url.pathname === "/health") {
        res.writeHead(204).end();
        return;
      }
      if (url.pathname.startsWith("/attachments/")) {
        if (!authorized) throw new HttpError(403, "Authentication required");
        const id = url.pathname.slice("/attachments/".length);
        if (restoring) throw new HttpError(503, "Restore in progress");
        const image = getImage(db, id);
        if (!image) throw new HttpError(404, "Image not found");
        res.setHeader("Content-Type", image.mimeType);
        res.end(image.data);
        return;
      }
      if (!options.assets) throw new HttpError(404, "UI not built");
      const path = resolve(
        options.assets,
        "." +
          (url.pathname === "/"
            ? "/index.html"
            : decodeURIComponent(url.pathname)),
      );
      if (!path.startsWith(resolve(options.assets) + sep))
        throw new HttpError(403, "Invalid path");
      const content = await readFile(path).catch(() => {
        throw new HttpError(404, "Not found");
      });
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
      res.setHeader(
        "Content-Type",
        mime[extname(path)] ?? "application/octet-stream",
      );
      res.end(content);
    } catch (error) {
      res
        .writeHead(error instanceof HttpError ? error.status : 400, {
          "Content-Type": "text/plain",
        })
        .end(error instanceof Error ? error.message : "Service error");
    }
  });
  try {
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(options.port ?? 0, "127.0.0.1", ok);
    });
  } catch (error) {
    getRawDb(db).close();
    lock.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listener");
  origin = `http://127.0.0.1:${address.port}`;
  await writeFile(
    join(options.directory, "runtime.json"),
    JSON.stringify({ origin, token, pid: process.pid }),
    { mode: 0o600 },
  );
  if (options.automaticBackups !== false) {
    coordinator.start();
    sync.engine.start();
  }
  const reminders = options.notify
    ? startReminders({ db: () => db, notify: options.notify, paused: () => restoring, now: options.now })
    : undefined;
  return {
    origin,
    token,
    reminders,
    async close() {
      reminders?.close();
      await new Promise<void>((ok, fail) => {
        server.close((error) => (error ? fail(error) : ok()));
        server.closeAllConnections();
      });
      sync.engine.close();
      coordinator.close();
      getRawDb(db).close();
      lock.close();
      if (imageDirectory)
        await rm(await imageDirectory, { recursive: true, force: true });
    },
  };
}
