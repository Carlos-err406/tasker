import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getLoginItemSettings: vi.fn(() => ({
      openAtLogin: false,
      openAsHidden: false,
      wasOpenedAtLogin: false,
      wasOpenedAsHidden: false,
      restoreState: false,
      status: 'not-registered',
      executableWillLaunchAtLogin: false,
      launchItems: [],
    })),
    setLoginItemSettings: vi.fn(),
  },
}));

import { getLaunchAtLoginState, setLaunchAtLogin } from '../electron/lib/login-item.js';

function fakeApp(settings: Partial<Electron.LoginItemSettings> = {}) {
  const loginSettings: Electron.LoginItemSettings = {
    openAtLogin: false,
    openAsHidden: false,
    wasOpenedAtLogin: false,
    wasOpenedAsHidden: false,
    restoreState: false,
    status: 'not-registered',
    executableWillLaunchAtLogin: false,
    launchItems: [],
    ...settings,
  };

  return {
    getLoginItemSettings: vi.fn(() => loginSettings),
    setLoginItemSettings: vi.fn(),
  };
}

describe('launch at login settings', () => {
  it('reports macOS approval requirements', () => {
    const app = fakeApp({ openAtLogin: true, status: 'requires-approval' });

    expect(getLaunchAtLoginState(app, 'darwin')).toEqual({
      supported: true,
      openAtLogin: true,
      status: 'requires-approval',
      requiresApproval: true,
    });
  });

  it('sets openAtLogin and returns the updated state', () => {
    const app = fakeApp({ openAtLogin: true, status: 'enabled' });

    expect(setLaunchAtLogin(true, app, 'darwin')).toMatchObject({
      supported: true,
      openAtLogin: true,
      status: 'enabled',
      requiresApproval: false,
    });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it('does nothing on unsupported platforms', () => {
    const app = fakeApp({ openAtLogin: true, status: 'enabled' });

    expect(setLaunchAtLogin(true, app, 'linux')).toEqual({
      supported: false,
      openAtLogin: false,
      requiresApproval: false,
    });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
});
