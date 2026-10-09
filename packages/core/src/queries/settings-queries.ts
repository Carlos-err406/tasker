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
