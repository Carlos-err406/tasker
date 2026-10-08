import { describe, expect, it, vi } from 'vitest';
import { syncAndRefresh } from '../src/lib/sync-refresh.js';

function setup(status: Record<string, unknown>, result: unknown = { enabled: true, error: null }) {
  const manage = vi.fn(async (payload: Record<string, unknown>) =>
    payload.action === 'sync-status' ? status : result,
  ) as never as <T>(payload: Record<string, unknown>) => Promise<T>;
  const showStatus = vi.fn();
  const refresh = vi.fn(async () => {});
  return { manage, showStatus, refresh };
}

describe('syncAndRefresh', () => {
  it('syncs before refreshing when sync is enabled', async () => {
    const { manage, showStatus, refresh } = setup({ enabled: true, error: null });
    await syncAndRefresh(manage, showStatus, refresh);
    expect(vi.mocked(manage).mock.calls.map(([p]) => (p as { action: string }).action)).toEqual(['sync-status', 'sync-now']);
    expect(showStatus.mock.calls.map(([m]) => m)).toEqual(['Syncing…', 'Synced']);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('only refreshes when sync is paused', async () => {
    const { manage, showStatus, refresh } = setup({ enabled: false, error: null });
    await syncAndRefresh(manage, showStatus, refresh);
    expect(manage).toHaveBeenCalledOnce();
    expect(showStatus).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('reports sync errors and still refreshes', async () => {
    const { manage, showStatus, refresh } = setup({ enabled: true, error: null }, { enabled: true, error: 'Offline' });
    await syncAndRefresh(manage, showStatus, refresh);
    expect(showStatus).toHaveBeenLastCalledWith('Sync failed: Offline');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('reports a failed request and still refreshes', async () => {
    const showStatus = vi.fn();
    const refresh = vi.fn(async () => {});
    const manage = (async () => {
      throw new Error('Service unavailable');
    }) as <T>(payload: Record<string, unknown>) => Promise<T>;
    await syncAndRefresh(manage, showStatus, refresh);
    expect(showStatus).toHaveBeenCalledWith('Sync failed: Service unavailable');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
