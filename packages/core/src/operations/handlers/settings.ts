import { getSettings, setSetting, type SettingKey } from "../../queries/settings-queries.js";
import { applySystemSort } from "../../queries/index.js";
import { applySystemSortAllLists } from "../../queries/all-lists-order.js";
import $try from "../try.js";
import type { IPCRegisterFunction } from "../registry.js";
import { SETTINGS_GET, SETTINGS_SET } from "./settings-channels.js";

/** Apply system order everywhere when this device keeps lists auto-sorted. */
export function autoSort(db: Parameters<typeof getSettings>[0]) {
  if (!getSettings(db).autoSort) return;
  applySystemSort(db);
  applySystemSortAllLists(db);
}

export const settingsRegister: IPCRegisterFunction = (ipcMain, _widget, { db }) => {
  ipcMain.handle(SETTINGS_GET, () => $try(() => getSettings(db)));

  ipcMain.handle(SETTINGS_SET, (_, key: SettingKey, value: boolean) => {
    return $try(() => {
      setSetting(db, key, value);
      if (key === "autoSort") autoSort(db);
      return getSettings(db);
    });
  });
};
