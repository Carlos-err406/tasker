import { getSettings, setSetting, type SettingKey } from "../../queries/settings-queries.js";
import { applyAutoSort } from "../../queries/auto-sort.js";
import $try from "../try.js";
import type { IPCRegisterFunction } from "../registry.js";
import { SETTINGS_GET, SETTINGS_SET } from "./settings-channels.js";

export const settingsRegister: IPCRegisterFunction = (ipcMain, _widget, { db }) => {
  ipcMain.handle(SETTINGS_GET, () => $try(() => getSettings(db)));

  ipcMain.handle(SETTINGS_SET, (_, key: SettingKey, value: boolean) => {
    return $try(() => {
      setSetting(db, key, value);
      if (key === "autoSort") applyAutoSort(db);
      return getSettings(db);
    });
  });
};
