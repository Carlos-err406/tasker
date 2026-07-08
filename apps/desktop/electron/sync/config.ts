/**
 * Supabase sync configuration.
 *
 * `TASKER_SUPABASE_URL` / `TASKER_SUPABASE_KEY` are baked in at build time by Vite
 * `define` (read from `apps/desktop/.env`). Both are non-secret: the URL is public
 * and the publishable key is designed to ship in clients (same key mobile embeds).
 * `TASKER_TEST_MODE` stays a runtime lookup (set by the E2E fixture), so it is NOT
 * baked — it must remain dynamic to disable sync during tests.
 */

// Dot-notation so Vite `define` can statically replace these at build time.
export const SUPABASE_URL: string = process.env.TASKER_SUPABASE_URL ?? '';
export const SUPABASE_KEY: string = process.env.TASKER_SUPABASE_KEY ?? '';

/** Sync is off in E2E test mode and when credentials are absent. */
export function syncEnabled(): boolean {
  if (process.env['TASKER_TEST_MODE'] === '1') return false;
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}
