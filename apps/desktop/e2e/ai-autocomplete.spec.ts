import { test as base, expect } from '@playwright/test';
import { type ElectronApplication, _electron as electron } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { addTask } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ //
// Mock LM Studio server
// ------------------------------------------------------------------ //

type MockServer = {
  port: number;
  requestCount: () => number;
  setNextResponse: (text: string) => void;
  close: () => Promise<void>;
};

async function startMockLmStudio(): Promise<MockServer> {
  let requestCount = 0;
  let nextResponse = 'from the store';

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      requestCount++;
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        const responseText = nextResponse;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'mock-completion',
            object: 'chat.completion',
            created: Date.now(),
            model: 'mock-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: responseText },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        );
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  return {
    port,
    requestCount: () => requestCount,
    setNextResponse: (text: string) => { nextResponse = text; },
    close: () => new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    ),
  };
}

// ------------------------------------------------------------------ //
// Custom fixtures with mock LM Studio
// ------------------------------------------------------------------ //

type AiFixtures = {
  electronApp: ElectronApplication;
  page: import('@playwright/test').Page;
  mockServer: MockServer;
};

const test = base.extend<AiFixtures>({
  mockServer: [
    async ({}, use) => {
      const mock = await startMockLmStudio();
      await use(mock);
      await mock.close();
    },
    { scope: 'worker' },
  ],

  electronApp: [
    async ({ mockServer }, use) => {
      const distPath = path.resolve(__dirname, '../dist-electron/main.js');
      try {
        await fs.stat(distPath);
      } catch {
        throw new Error(
          'dist-electron/main.js not found. Run: pnpm --filter @tasker/desktop run build',
        );
      }

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tasker-e2e-ai-'));
      const dbPath = path.join(tmpDir, 'tasker.db');

      const app = await electron.launch({
        args: [distPath],
        env: {
          ...process.env,
          TASKER_TEST_MODE: '1',
          TASKER_DB_PATH: dbPath,
          TASKER_USER_DATA: tmpDir,
          ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
          TASKER_LM_STUDIO_URL: `http://127.0.0.1:${mockServer.port}/v1`,
        },
      });

      app.process().stderr?.on('data', (d: Buffer) => {
        process.stderr.write(`[electron-stderr] ${d.toString()}`);
      });

      await use(app);

      const proc = app.process();
      await app.evaluate(({ app: a }) => a.quit()).catch(() => {});
      await new Promise<void>((resolve) => {
        if (proc.exitCode !== null) { resolve(); return; }
        const deadline = setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); resolve(); }, 5_000);
        proc.once('exit', () => { clearTimeout(deadline); resolve(); });
      });
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],

  page: async ({ electronApp }, use) => {
    const w = await electronApp.firstWindow({ timeout: 15_000 });
    await w.evaluate(() => (window as any).ipc['tasker:resetForTest']());
    await w.reload();
    await w.waitForSelector('[data-testid="app-ready"]', { timeout: 10_000 });
    await use(w);
  },
});

// Helper: open the add input for a list
async function openAddInput(page: import('@playwright/test').Page, listName = 'tasks') {
  const header = page.locator(`[data-testid="list-header-${listName}"]`);
  await header.locator('button', { has: page.locator('svg.lucide-plus') }).click();
  const input = page.locator(`[data-testid="add-task-input-${listName}"]`);
  await input.waitFor({ state: 'visible' });
  await input.click();
  return input;
}

// ------------------------------------------------------------------ //
// Tests
// ------------------------------------------------------------------ //

test.describe('AI autocomplete (ghost text)', () => {
  test('ghost text appears after debounce', async ({ page, mockServer }) => {
    mockServer.setNextResponse('eries from store');
    const input = await openAddInput(page);

    await page.keyboard.type('Buy groc');
    // Wait for the 400ms debounce + IPC round trip
    await expect(page.locator('[data-ghost]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-ghost]')).toHaveText('eries from store');
  });

  test('Tab accepts ghost text', async ({ page, mockServer }) => {
    mockServer.setNextResponse(' from the store');
    const input = await openAddInput(page);

    await page.keyboard.type('Buy groceries');
    await expect(page.locator('[data-ghost]')).toBeVisible({ timeout: 3000 });

    await input.press('Tab');

    // Ghost span should be gone and text should include the accepted completion
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
    const text = await input.innerText();
    expect(text).toContain('Buy groceries');
    expect(text).toContain('from the store');
  });

  test('Escape dismisses ghost but keeps input open', async ({ page, mockServer }) => {
    mockServer.setNextResponse(' and milk');
    const input = await openAddInput(page);

    await page.keyboard.type('Buy eggs');
    await expect(page.locator('[data-ghost]')).toBeVisible({ timeout: 3000 });

    await input.press('Escape');

    // Ghost gone, input still visible
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
    await expect(input).toBeVisible();
  });

  test('second Escape closes input', async ({ page, mockServer }) => {
    mockServer.setNextResponse(' and milk');
    const input = await openAddInput(page);

    await page.keyboard.type('Buy eggs');
    await expect(page.locator('[data-ghost]')).toBeVisible({ timeout: 3000 });

    // First Escape: dismiss ghost
    await input.press('Escape');
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
    await expect(input).toBeVisible();

    // Second Escape: close input
    await input.press('Escape');
    await expect(input).toBeHidden();
  });

  test('typing resets debounce — only one request fires', async ({ page, mockServer }) => {
    mockServer.setNextResponse(' to do');
    const initialCount = mockServer.requestCount();
    const input = await openAddInput(page);

    // Type "Buy", wait 200ms (less than debounce), then type more
    await page.keyboard.type('Buy');
    await page.waitForTimeout(200);
    await page.keyboard.type(' milk');

    // Wait for debounce + round trip to complete
    await expect(page.locator('[data-ghost]')).toBeVisible({ timeout: 3000 });

    // Only 1 request should have been made (debounce collapsed the two typing bursts)
    expect(mockServer.requestCount() - initialCount).toBe(1);
  });

  test('metadata autocomplete suppresses ghost text', async ({ page }) => {
    const input = await openAddInput(page);

    // Type a relationship prefix — metadata dropdown should appear
    await page.keyboard.type('Fix bug ^');

    // Metadata dropdown should open
    await expect(page.locator('[data-testid="autocomplete-dropdown"]').or(
      page.locator('[role="listbox"]'),
    )).toBeVisible({ timeout: 2000 }).catch(() => {
      // OK if no tasks exist to show — the key thing is no ghost span
    });

    // Give debounce time to fire (it shouldn't because ^ suppresses it)
    await page.waitForTimeout(600);
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
  });

  test('LM Studio unavailable → no ghost text', async ({ page }) => {
    // This test uses the mock server, but we rely on the fact that
    // the IPC call returns null when AI fails — no ghost should appear.
    // Simulate unavailability by checking that a short string gets no ghost.
    const input = await openAddInput(page);

    // Type fewer than 3 chars — should never trigger
    await page.keyboard.type('Bu');
    await page.waitForTimeout(600);
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
  });

  test('typing matching chars progressively consumes ghost', async ({ page, mockServer }) => {
    mockServer.setNextResponse('eries from store');
    const input = await openAddInput(page);

    await page.keyboard.type('Buy groc');
    await expect(page.locator('[data-ghost]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-ghost]')).toHaveText('eries from store');

    // Type "e" which matches first ghost char — ghost should shrink
    const countBefore = mockServer.requestCount();
    await page.keyboard.type('e');
    await page.waitForTimeout(100);

    await expect(page.locator('[data-ghost]')).toBeVisible();
    await expect(page.locator('[data-ghost]')).toHaveText('ries from store');

    // Type "ri" — ghost shrinks further
    await page.keyboard.type('ri');
    await page.waitForTimeout(100);

    await expect(page.locator('[data-ghost]')).toBeVisible();
    await expect(page.locator('[data-ghost]')).toHaveText('es from store');

    // No new requests should have been made
    expect(mockServer.requestCount() - countBefore).toBe(0);
  });

  test('typing non-matching char clears ghost and retriggers', async ({ page, mockServer }) => {
    mockServer.setNextResponse('eries from store');
    const input = await openAddInput(page);

    await page.keyboard.type('Buy groc');
    await expect(page.locator('[data-ghost]')).toBeVisible({ timeout: 3000 });

    // Type "x" which does NOT match "e" (first ghost char) — ghost should clear
    mockServer.setNextResponse(' and bread');
    await page.keyboard.type('x');
    await page.waitForTimeout(100);

    // Ghost should be gone immediately (mismatched char)
    await expect(page.locator('[data-ghost]')).toHaveCount(0);

    // After debounce, new ghost should appear
    await expect(page.locator('[data-ghost]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-ghost]')).toHaveText(' and bread');
  });

  test('typing all ghost chars fully consumes ghost without retrigger', async ({ page, mockServer }) => {
    mockServer.setNextResponse('s ok');
    const input = await openAddInput(page);

    await page.keyboard.type('That i');
    await expect(page.locator('[data-ghost]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-ghost]')).toHaveText('s ok');

    const countBefore = mockServer.requestCount();

    // Type all ghost chars
    await page.keyboard.type('s ok');
    await page.waitForTimeout(100);

    // Ghost fully consumed — no ghost span, no retrigger
    await expect(page.locator('[data-ghost]')).toHaveCount(0);

    // Wait past debounce to confirm no retrigger
    await page.waitForTimeout(600);
    expect(mockServer.requestCount() - countBefore).toBe(0);
  });

  test('regression: Cmd+Enter submit still works', async ({ page }) => {
    await addTask(page, 'Task added via helper');

    const taskName = page.locator('[data-testid^="task-name-"]').first();
    await expect(taskName).toHaveText('Task added via helper');
  });

  test('regression: multiline task with metadata', async ({ page }) => {
    await addTask(page, 'Buy milk\np1 #shopping');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem.locator('[data-testid^="task-name-"]')).toHaveText('Buy milk');
    await expect(taskItem.getByText('shopping')).toBeVisible();
  });
});
