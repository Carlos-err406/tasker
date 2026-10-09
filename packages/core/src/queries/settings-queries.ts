/**
 * Per-device settings, kept in the device-local config table (it never syncs).
 */

import type { TaskerDb } from '../db.js';
import { getConfig, setConfig } from './config-queries.js';

export interface Settings {
  /** Show completed and won't-do tasks in every list. */
  showCompleted: boolean;
  /** Render image and video previews inside tasks. */
  mediaPreviews: boolean;
  /** Remind at due times (9:00 for date-only tasks). */
  notifications: boolean;
  /** Keep every list in system order after each change; drag reordering is off. */
  autoSort: boolean;
}
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  showCompleted: true,
  mediaPreviews: true,
  notifications: true,
  autoSort: false,
};

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && Object.hasOwn(DEFAULT_SETTINGS, key);
}

export function getSettings(db: TaskerDb): Settings {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(settings) as SettingKey[]) {
    const value = getConfig(db, `setting:${key}`);
    if (value !== null) settings[key] = value === 'true';
  }
  return settings;
}

export function setSetting(db: TaskerDb, key: SettingKey, value: boolean): void {
  setConfig(db, `setting:${key}`, String(value));
}

const DELIVERED_KEY = 'reminders:delivered';
/** Delivery records are kept long enough to outlast the 12-hour lateness window. */
const DELIVERED_TTL_MS = 2 * 24 * 60 * 60 * 1000;

/** Reminder occurrences already shown on this device. */
export function getDeliveredReminders(db: TaskerDb): Set<string> {
  try {
    const records = JSON.parse(getConfig(db, DELIVERED_KEY) ?? '[]') as { key: string }[];
    return new Set(records.map((r) => r.key));
  } catch {
    return new Set();
  }
}

/** Record reminders as shown, dropping records old enough to no longer matter. */
export function markRemindersDelivered(db: TaskerDb, keys: readonly string[], now: Date): void {
  let records: { key: string; at: number }[] = [];
  try {
    records = JSON.parse(getConfig(db, DELIVERED_KEY) ?? '[]');
  } catch {
    /* Start over from a corrupt record. */
  }
  const cutoff = now.getTime() - DELIVERED_TTL_MS;
  const kept = records.filter((r) => r.at >= cutoff && !keys.includes(r.key));
  setConfig(db, DELIVERED_KEY, JSON.stringify([...kept, ...keys.map((key) => ({ key, at: now.getTime() }))]));
}
