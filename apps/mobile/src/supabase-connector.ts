/**
 * PowerSync ↔ Supabase connector.
 *
 * - fetchCredentials: gets a PowerSync token
 * - uploadData: pushes local CRUD operations to Supabase Postgres
 *
 * Table mapping notes:
 * - `lists`: PowerSync `id` = Postgres `name` (PK)
 * - `task_dependencies`: PowerSync `id` = `task_id.blocks_task_id` (composite)
 * - `task_relations`: PowerSync `id` = `task_id_1.task_id_2` (composite)
 * - `tasks`: PowerSync `id` = Postgres `id` (no mapping needed)
 */

import {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  UpdateType,
} from '@powersync/react-native';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const POWERSYNC_URL = process.env.EXPO_PUBLIC_POWERSYNC_URL!;

const FATAL_RESPONSE_CODES = [
  /^22...$/, // data exception
  /^23...$/, // integrity constraint violation
  /^42...$/, // syntax error or access rule violation
];

/**
 * Transform a PowerSync CRUD entry into Supabase-compatible data.
 * Handles the id→name mapping for lists and composite keys for junction tables.
 */
function toSupabaseRow(op: CrudEntry): { table: string; data: Record<string, any>; pk: Record<string, any> } {
  const data = { ...op.opData };

  if (op.table === 'lists') {
    // PowerSync id = list name (the Postgres PK)
    return {
      table: 'lists',
      data: { name: op.id, ...data },
      pk: { name: op.id },
    };
  }

  if (op.table === 'task_dependencies') {
    // PowerSync id = "task_id.blocks_task_id"
    const [taskId, blocksTaskId] = op.id.split('.');
    return {
      table: 'task_dependencies',
      data: { task_id: taskId, blocks_task_id: blocksTaskId, ...data },
      pk: { task_id: taskId, blocks_task_id: blocksTaskId },
    };
  }

  if (op.table === 'task_relations') {
    // PowerSync id = "task_id_1.task_id_2"
    const [taskId1, taskId2] = op.id.split('.');
    return {
      table: 'task_relations',
      data: { task_id_1: taskId1, task_id_2: taskId2, ...data },
      pk: { task_id_1: taskId1, task_id_2: taskId2 },
    };
  }

  // tasks — id maps directly
  return {
    table: op.table,
    data: { id: op.id, ...data },
    pk: { id: op.id },
  };
}

export class SupabaseConnector implements PowerSyncBackendConnector {
  client: SupabaseClient;

  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  async fetchCredentials() {
    // Try existing session first
    let { data: { session } } = await this.client.auth.getSession();

    // If no session, sign in anonymously
    if (!session) {
      const { data, error } = await this.client.auth.signInAnonymously();
      if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
      session = data.session;
    }

    if (!session?.access_token) {
      throw new Error('No session available for PowerSync');
    }

    return {
      endpoint: POWERSYNC_URL,
      token: session.access_token,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    try {
      for (const op of transaction.crud) {
        const { table, data, pk } = toSupabaseRow(op);

        switch (op.op) {
          case UpdateType.PUT: {
            const result = await this.client.from(table).upsert(data);
            if (result.error) throw new Error(`PUT ${table}: ${JSON.stringify(result.error)}`);
            break;
          }
          case UpdateType.PATCH: {
            let query = this.client.from(table).update(op.opData);
            for (const [col, val] of Object.entries(pk)) {
              query = query.eq(col, val);
            }
            const result = await query;
            if (result.error) throw new Error(`PATCH ${table}: ${JSON.stringify(result.error)}`);
            break;
          }
          case UpdateType.DELETE: {
            let query = this.client.from(table).delete();
            for (const [col, val] of Object.entries(pk)) {
              query = query.eq(col, val);
            }
            const result = await query;
            if (result.error) throw new Error(`DELETE ${table}: ${JSON.stringify(result.error)}`);
            break;
          }
        }
      }

      await transaction.complete();
    } catch (ex: any) {
      console.error('Upload error:', ex);
      if (typeof ex.code === 'string' && FATAL_RESPONSE_CODES.some((re) => re.test(ex.code))) {
        console.error('Fatal upload error — discarding transaction:', ex);
        await transaction.complete();
      } else {
        throw ex;
      }
    }
  }
}
