import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 10_000,
  expect: { timeout: 3_000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    actionTimeout: 3_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
