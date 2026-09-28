import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { CREATE_SCHEMA_SQL, type TaskerDb } from "@tasker/core/db";

export interface AndroidBridge {
  execute(request: string): string;
  openExternal(url: string): void;
  sync?(id: string, request: string): void;
  syncCancel?(): void;
  updates?(id: string, action: string): void;
  backups?(id: string, request: string): void;
}
export function callNative<T>(
  bridge: AndroidBridge,
  action: string,
  data: Record<string, unknown> = {},
): T {
  const response = JSON.parse(
    bridge.execute(JSON.stringify({ action, ...data })),
  );
  if (response.error) throw new Error(response.error);
  return response.result as T;
}

/** Adapt native SQLite to Drizzle's synchronous session without importing a Node driver. */
export function createAndroidDatabase(bridge: AndroidBridge): TaskerDb {
  const call = <T>(action: string, data: Record<string, unknown> = {}) =>
    callNative<T>(bridge, action, data);
  for (const sql of CREATE_SCHEMA_SQL.split(";").filter((s) => s.trim()))
    call("run", { sql, params: [] });
  call("run", {
    sql: "INSERT OR IGNORE INTO lists (name, sort_order) VALUES ('tasks', 0)",
    params: [],
  });
  const client = {
    prepare(sql: string) {
      let raw = false;
      const query = (params: unknown[]) => {
        const { columns, rows } = call<{
          columns: string[];
          rows: unknown[][];
        }>("query", { sql, params });
        return raw
          ? rows
          : rows.map((row) =>
              Object.fromEntries(columns.map((c, i) => [c, row[i]])),
            );
      };
      return {
        raw() {
          raw = true;
          return this;
        },
        all(...params: unknown[]) {
          return query(params);
        },
        get(...params: unknown[]) {
          return query(params)[0];
        },
        run(...params: unknown[]) {
          return call("run", { sql, params });
        },
      };
    },
    transaction(fn: (...args: unknown[]) => unknown) {
      const run = (...args: unknown[]) => {
        call("begin");
        try {
          const result = fn(...args);
          call("commit");
          return result;
        } catch (error) {
          call("rollback");
          throw error;
        }
      };
      return Object.assign(run, {
        deferred: run,
        immediate: run,
        exclusive: run,
      });
    },
  };
  const dialect = new SQLiteSyncDialect();
  // The native adapter implements only the client methods the portable session uses.
  const session = new BetterSQLiteSession(client as never, dialect, undefined);
  return new BaseSQLiteDatabase(
    "sync",
    dialect,
    session,
    undefined,
  ) as TaskerDb;
}
