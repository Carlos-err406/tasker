import type { Settings, SettingKey } from '@tasker/core/queries';
import type { TryResult } from '../try.js';
import { SETTINGS_GET, SETTINGS_SET } from './channels.js';

export const settingsInvokerFactory = (ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }) => ({
  [SETTINGS_GET]: (() =>
    ipcRenderer.invoke(SETTINGS_GET)) as () => TryResult<Settings>,

  [SETTINGS_SET]: ((key: SettingKey, value: boolean) =>
    ipcRenderer.invoke(SETTINGS_SET, key, value)) as (
    key: SettingKey,
    value: boolean,
  ) => TryResult<Settings>,
});
