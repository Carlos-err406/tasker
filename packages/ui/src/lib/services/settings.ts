import type { Settings, SettingKey } from '@tasker/core/queries';
import { IPC } from './ipc.js';

async function unwrap<T>(promise: Promise<[{ message: string } | null, T | null]>): Promise<T> {
  const [err, data] = await promise;
  if (err) throw new Error(err.message);
  return data as T;
}

export async function getSettings(): Promise<Settings> {
  return unwrap(IPC['settings:get']());
}

export async function setSetting(key: SettingKey, value: boolean): Promise<Settings> {
  return unwrap(IPC['settings:set'](key, value));
}
