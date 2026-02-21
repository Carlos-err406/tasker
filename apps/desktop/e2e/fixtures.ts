import { test as base, type Page } from '@playwright/test';
import { type ElectronApplication, _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type E2EFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<E2EFixtures>({
  electronApp: [
    async ({}, use) => {
      // 1. Stale build check — hard error (runs once per file)
      const srcDir = path.resolve(__dirname, '../electron');
      const distPath = path.resolve(__dirname, '../dist-electron/main.js');
      let distMtime = 0;
      try {
        distMtime = (await fs.stat(distPath)).mtimeMs;
      } catch {
        throw new Error(
          'dist-electron/main.js not found. Run: pnpm --filter @tasker/desktop run build',
        );
      }
      const srcFiles = await fs.readdir(srcDir, { recursive: true });
      for (const f of srcFiles) {
        if (f.toString().endsWith('.ts')) {
          const srcMtime = (await fs.stat(path.join(srcDir, f.toString()))).mtimeMs;
          if (srcMtime > distMtime) {
            throw new Error(
              `Source file electron/${f} is newer than dist-electron/main.js. ` +
                'Run: pnpm --filter @tasker/desktop run build',
            );
          }
        }
      }

      // 2. Create unique temp dir per file
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tasker-e2e-'));

      // 3. Runtime guard: verify DB path is NOT production
      const dbPath = path.join(tmpDir, 'tasker.db');
      const prodPath = path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'cli-tasker',
        'tasker.db',
      );
      if (dbPath === prodPath) {
        throw new Error('FATAL: Test DB path resolved to production path. Aborting.');
      }

      // 4. Launch Electron
      const testEnv = {
        TASKER_TEST_MODE: '1',
        TASKER_DB_PATH: dbPath,
        TASKER_USER_DATA: tmpDir,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      } satisfies Record<string, string>;

      const app = await electron.launch({
        args: [path.resolve(__dirname, '../dist-electron/main.js')],
        env: { ...process.env, ...testEnv },
      });

      app.process().stderr?.on('data', (d: Buffer) => {
        process.stderr.write(`[electron-stderr] ${d.toString()}`);
      });

      await use(app);

      // 5. Teardown: proper process exit waiting (runs once per file)
      const proc = app.process();
      await app.evaluate(({ app: a }) => a.quit()).catch(() => {});
      await new Promise<void>((resolve) => {
        if (proc.exitCode !== null) {
          resolve();
          return;
        }
        const deadline = setTimeout(() => {
          if (proc.exitCode === null) proc.kill('SIGKILL');
          resolve();
        }, 5_000);
        proc.once('exit', () => {
          clearTimeout(deadline);
          resolve();
        });
      });
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],

  page: async ({ electronApp }, use) => {
    const w = await electronApp.firstWindow({ timeout: 15_000 });
    // Reset DB to a clean slate before each test
    await w.evaluate(() => (window as any).ipc['tasker:resetForTest']());
    await w.reload();
    await w.waitForSelector('[data-testid="app-ready"]', { timeout: 10_000 });
    await use(w);
  },
});

export { expect } from '@playwright/test';
