/**
 * Upload pasted images to Supabase Storage so they render on every device.
 *
 * Uses its own lightweight anon-authenticated client (no realtime), independent of
 * the sync module. Returns a public https URL the markdown embeds; callers fall back
 * to a local file path when this returns null (sync disabled / offline).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, syncEnabled } from './config.js';

const BUCKET = 'task-images';

let client: SupabaseClient | null = null;
let authPromise: Promise<void> | null = null;

async function getClient(): Promise<SupabaseClient> {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: true } });
  }
  if (!authPromise) {
    authPromise = client.auth.signInAnonymously().then(({ error }) => {
      if (error) throw new Error(`anon sign-in: ${error.message}`);
    });
  }
  await authPromise;
  return client;
}

/** Upload a PNG buffer; returns the public https URL, or null on failure/disabled. */
export async function uploadImage(buffer: Buffer, filename: string): Promise<string | null> {
  if (!syncEnabled()) return null;
  try {
    const c = await getClient();
    const path = `pasted/${filename}`;
    const { error } = await c.storage.from(BUCKET).upload(path, buffer, {
      contentType: 'image/png',
      upsert: false,
    });
    if (error) { console.error('[storage] upload failed:', error.message); return null; }
    return c.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.error('[storage] upload error:', err);
    return null;
  }
}
