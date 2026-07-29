import { app } from 'electron';

export interface LaunchAtLoginState {
  supported: boolean;
  openAtLogin: boolean;
  status?: string;
  requiresApproval: boolean;
}

interface LoginItemApp {
  getLoginItemSettings: () => Electron.LoginItemSettings;
  setLoginItemSettings: (settings: Electron.Settings) => void;
}

function isSupportedPlatform(platform = process.platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

export function getLaunchAtLoginState(
  appApi: LoginItemApp = app,
  platform = process.platform,
): LaunchAtLoginState {
  if (!isSupportedPlatform(platform)) {
    return {
      supported: false,
      openAtLogin: false,
      requiresApproval: false,
    };
  }

  const settings = appApi.getLoginItemSettings();
  return {
    supported: true,
    openAtLogin: settings.openAtLogin,
    status: settings.status,
    requiresApproval: settings.status === 'requires-approval',
  };
}

export function setLaunchAtLogin(
  enabled: boolean,
  appApi: LoginItemApp = app,
  platform = process.platform,
): LaunchAtLoginState {
  if (!isSupportedPlatform(platform)) {
    return {
      supported: false,
      openAtLogin: false,
      requiresApproval: false,
    };
  }

  appApi.setLoginItemSettings({ openAtLogin: enabled });
  return getLaunchAtLoginState(appApi, platform);
}
