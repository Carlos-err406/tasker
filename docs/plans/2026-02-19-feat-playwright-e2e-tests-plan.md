---
title: "feat: Playwright E2E Tests for Desktop App"
type: feat
status: completed
date: 2026-02-19
brainstorm: docs/brainstorms/2026-02-19-playwright-e2e-tests-brainstorm.md
task: ivy
deepened: 2026-02-19
---

# feat: Playwright E2E Tests for Desktop App

## Enhancement Summary

**Deepened on:** 2026-02-19
**Review agents used:** TypeScript reviewer, Performance oracle, Security sentinel, Simplicity reviewer, Architecture strategist, Race condition reviewer, Agent-native reviewer, Pattern recognition specialist, Data integrity guardian, Learnings researcher, Best practices researcher

### Critical Fixes from Review (must address)
1. **Disable chokidar watcher in test mode** — eliminates phantom refresh races that would make every test flaky
2. **Refactor `watcher.ts` to accept `dbPath` parameter** — closes the production-data-safety gap where the watcher calls `getDefaultDbPath()` independently
3. **Blur-hide listener is in `tray.ts`, not `main.ts`** — the pseudocode was wrong about where to apply the fix
4. **`ensurePopup` is not exported from `tray.ts`** — need a new exported function for test-mode popup creation
5. **Replace 1s teardown sleep with process exit listener** — the magic sleep is fragile and wastes 35s across the suite
6. **Guard `migrateJsonSettings` with `!isTestMode`** — it reads/deletes files from `userData`
7. **Add runtime guard: throw if `TASKER_TEST_MODE=1` but `TASKER_DB_PATH` is missing** — prevents silent production writes

### Key Improvements Discovered
1. dnd-kit drag requires manual `mouse.down` → `mouse.move({ steps: 20 })` → `mouse.up` (Playwright's `dragTo` won't work)
2. Radix context menus: use `hover()` for submenus, not `click()`; content renders in a portal outside app root
3. Add undo-reorder test (critical gap from C# learnings where wrong index type caused silent bugs)
4. Drop `electron-playwright-helpers` dependency — not needed; inline the 3-line teardown
5. Drop `video: 'retain-on-failure'` — AI agents can't watch videos; traces are sufficient
6. Make stale-build check a hard error, not a warning

---

## Overview

Add end-to-end tests for the Electron desktop app using Playwright's `_electron` API. Tests will launch the real Electron app with an isolated test database, interact with the UI through Playwright, and verify behavior. The primary consumer is Claude Code (AI agents) — enabling automated verification of UI changes without manual intervention.

## Problem Statement

The desktop app has zero E2E tests. All 3 existing test files in `apps/desktop/tests/` are unit tests that exercise either the data layer or pure display logic — none launch Electron or interact with the UI. This means:

- UI regressions (broken context menus, drag-and-drop issues, rendering bugs) can only be caught manually
- AI agents can write code but cannot verify it works in the actual app
- The `reminder-sync.test.ts` comment explicitly states: _"We can't import the sync engine directly (it imports electron)"_ — confirming that full IPC flow tests require a real Electron process

## Proposed Solution

Use Playwright's experimental `_electron.launch()` to spawn the Electron app with test-mode environment variables. Each test gets a fresh app instance with an isolated temp database. A shared Playwright fixture handles launch, popup reveal, ready-state detection, and teardown.

## Technical Approach

### Phase 1: App Test Mode Infrastructure

Changes to the core and desktop app to support test-mode launches.

#### 1.1 Add `TASKER_DB_PATH` env var override

**File:** `packages/core/src/db.ts` — `getDefaultDbPath()`

When `process.env.TASKER_DB_PATH` is set, return that value instead of the platform-specific default. Add a safety guard: if `TASKER_TEST_MODE=1` but `TASKER_DB_PATH` is missing, throw immediately rather than silently falling back to production.

```typescript
// packages/core/src/db.ts
export function getDefaultDbPath(): string {
  if (process.env['TASKER_DB_PATH']) {
    return process.env['TASKER_DB_PATH'];
  }
  if (process.env['TASKER_TEST_MODE'] === '1') {
    throw new Error('TASKER_DB_PATH must be set when TASKER_TEST_MODE=1');
  }
  // ... existing platform logic
}
```

**Important:** Use a temp file path (not `:memory:`) because the chokidar watcher in `watcher.ts` needs a real file to watch. The Playwright fixture will create a unique temp directory per test and pass `<tmpdir>/tasker-test.db` as `TASKER_DB_PATH`.

**Rebuild required:** `pnpm --filter @tasker/core run build` after this change.

#### 1.1b Refactor `watcher.ts` to accept `dbPath` as a parameter

**File:** `apps/desktop/electron/lib/watcher.ts`

Currently `watcher.ts` calls `getDefaultDbPath()` independently (line 9). This is a production-data-safety risk — if the env var fix is applied to `getDefaultDbPath()` but the watcher's call diverges due to timing or a stale build, the watcher will watch the production DB file and fire `db:changed` events into the test popup.

Refactor to accept the path as a parameter:

```typescript
// BEFORE (unsafe — redundant path resolution):
export function startDbWatcher(getWindow: () => BrowserWindow | null): void {
  const dbPath = getDefaultDbPath();
  watcher = watch(dbPath, { ... });
}

// AFTER (safe — single source of truth):
export function startDbWatcher(dbPath: string, getWindow: () => BrowserWindow | null): void {
  watcher = watch(dbPath, { ... });
}
```

Then in `main.ts`, pass the already-resolved `dbPath`:
```typescript
startDbWatcher(dbPath, getPopupWindow);
```

#### 1.2 Add `TASKER_TEST_MODE` env var to main.ts and tray.ts

**Files:** `apps/desktop/electron/main.ts`, `apps/desktop/electron/lib/tray.ts`

When `TASKER_TEST_MODE=1`, the following changes apply:

**1. `app.setPath('userData')` must be the FIRST statement** (before `requestSingleInstanceLock`, before `app.whenReady()`):

```typescript
// apps/desktop/electron/main.ts — TOP OF FILE, after imports
const isTestMode = process.env['TASKER_TEST_MODE'] === '1';

// MUST come before requestSingleInstanceLock() and app.whenReady()
if (isTestMode && process.env['TASKER_USER_DATA']) {
  app.setPath('userData', process.env['TASKER_USER_DATA']);
} else if (process.env['VITE_DEV_SERVER_URL']) {
  app.setName('Tasker (Dev)');
  app.setPath('userData', path.join(app.getPath('appData'), 'Tasker (Dev)'));
}
```

**2. Skip single-instance lock:**

```typescript
if (!isTestMode) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); /* ... */ }
}
```

**CRITICAL structural note:** The current `main.ts` has `app.whenReady()` inside the `else` block of the single-instance lock check. When `isTestMode` skips the lock entirely, the `else` block (containing `app.whenReady()`) is also skipped. The refactor must move `app.whenReady()` outside the `else` block so it runs regardless of test mode.

**3. Skip migrateJsonSettings** (reads/deletes files from `userData`):

```typescript
if (!isTestMode) {
  migrateJsonSettings(db);
}
```

**4. Runtime guard for missing env vars:**

```typescript
if (isTestMode) {
  if (!process.env['TASKER_DB_PATH'] || !process.env['TASKER_USER_DATA']) {
    console.error('[test-mode] TASKER_DB_PATH and TASKER_USER_DATA must both be set');
    app.exit(1);
  }
}
```

**5. Skip chokidar watcher and background services** — the watcher fires `db:changed` on every DB write, triggering `refresh()` which races against optimistic UI updates. In tests, all changes go through the app itself, so external-change detection is unnecessary:

```typescript
if (!isTestMode) {
  startDbWatcher(dbPath, getPopupWindow);
  startReminderSync(db);
  startDueDateNotifier(db, ...);
}
```

**6. Eagerly create and show popup** — export a new function from `tray.ts`:

```typescript
// apps/desktop/electron/lib/tray.ts — NEW export
export function openPopupForTest(): void {
  ensurePopup(() => showPopup());
}
```

`ensurePopup` is currently module-private in `tray.ts`. Rather than exporting it directly (widening the API surface), wrap it in a purpose-named function.

In `main.ts`:
```typescript
if (isTestMode) {
  openPopupForTest();
}
```

**7. Skip blur-hide listener** — this lives in `tray.ts`'s `ensurePopup()` function (not in `main.ts`):

```typescript
// apps/desktop/electron/lib/tray.ts — inside ensurePopup()
if (process.env['TASKER_TEST_MODE'] !== '1') {
  popup.on('blur', () => {
    if (popup && !popup.isDestroyed() && popup.isVisible()) {
      hidePopup();
    }
  });
}
```

**Why blur-hide disabled is load-bearing for test stability:** `popup:hidden` triggers `refresh()` which re-fetches all data from DB. Without the blur-hide guard, every Playwright focus shift would fire a refresh, racing against optimistic UI state and causing phantom re-renders mid-test. This is the single most important guard against test flakiness.

#### 1.3 Add `data-testid` attributes to key interactive elements

Add `data-testid` to the following elements so tests use stable selectors (not CSS classes). Convention: kebab-case, dynamic IDs use the task's 3-char short ID or list name.

| Component | Element | `data-testid` |
|---|---|---|
| `TaskItem` | Task row container | `task-item-{id}` |
| `TaskItem` | Checkbox | `task-checkbox-{id}` |
| `TaskItem` | Task name display | `task-name-{id}` |
| `TaskItem` | Edit textarea | `task-edit-input` (static — only one active at a time) |
| `ListSection` | Section container | `list-section-{listName}` |
| `ListSection` | Add task input | `add-task-input-{listName}` |
| `ListSection` | Collapse toggle | `list-collapse-{listName}` |
| `ListSection` | List header (for right-click) | `list-header-{listName}` |
| `ListSection` | New list button | `new-list-button` |
| `App` | Search input | `search-input` |
| `App` | Main content area | `app-content` |
| `App` | Loading-complete sentinel | `app-ready` (only rendered after initial `refresh()` completes) |
| `StatusBar` | Status message | `status-bar` |

**Selector strategy notes:**
- Use `data-testid` for **identifying** a specific task or element
- Use DOM position selectors (`:nth-child()`, `page.locator('.task').nth(0)`) for **asserting order** (drag-and-drop)
- Use `page.getByRole('menu')` for Radix context menu portals (they render outside the app root)
- Use `page.getByRole('menuitem', { name: '...' })` for context menu items

### Phase 2: Playwright Setup

#### 2.1 Install dependencies

```bash
pnpm --filter @tasker/desktop add -D @playwright/test
```

No `npx playwright install` needed — Electron provides its own Chromium.

No `electron-playwright-helpers` — the teardown and IPC patterns can be implemented in ~10 lines without an extra dependency.

#### 2.2 Create Playwright config

**File:** `apps/desktop/playwright.config.ts`

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,          // 30s is enough: 5s launch + 5s ready + 10s test + 10s buffer
  expect: { timeout: 10_000 },
  workers: 1,               // Sequential — each test launches its own Electron. Do NOT increase
                             // without verifying fixture isolation (unique userData per worker).
  retries: 0,               // INTENTIONAL: retries hide flakiness. A flaky test must be fixed.
  reporter: [['list'], ['html', { open: 'never' }]],  // Console + HTML report for debugging
  use: {
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // video: OFF — AI agents can't watch videos; traces are sufficient for debugging
  },
});
```

**Why Vitest won't pick up E2E files:** The existing `apps/desktop/vitest.config.ts` uses `include: ['tests/**/*.test.ts']` — an allowlist that excludes `e2e/*.spec.ts`. No conflict.

#### 2.3 Create shared Electron fixture

**File:** `apps/desktop/e2e/fixtures.ts`

```typescript
import { test as base, type Page } from '@playwright/test';
import { type ElectronApplication, _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

type E2EFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<E2EFixtures>({
  electronApp: async ({}, use) => {
    // 1. Stale build check — hard error, not a warning
    const srcDir = path.resolve(__dirname, '../electron');
    const distPath = path.resolve(__dirname, '../dist-electron/main.js');
    let distMtime = 0;
    try {
      distMtime = (await fs.stat(distPath)).mtimeMs;
    } catch {
      throw new Error(
        'dist-electron/main.js not found. Run: pnpm --filter @tasker/desktop run build'
      );
    }
    // Check all electron/ source files, not just main.ts
    const srcFiles = await fs.readdir(srcDir, { recursive: true });
    for (const f of srcFiles) {
      if (f.toString().endsWith('.ts')) {
        const srcMtime = (await fs.stat(path.join(srcDir, f.toString()))).mtimeMs;
        if (srcMtime > distMtime) {
          throw new Error(
            `Source file electron/${f} is newer than dist-electron/main.js. ` +
            'Run: pnpm --filter @tasker/desktop run build'
          );
        }
      }
    }

    // 2. Create unique temp dir per test
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tasker-e2e-'));

    // 3. Runtime guard: verify DB path is NOT production
    const dbPath = path.join(tmpDir, 'tasker.db');
    const prodPath = path.join(
      os.homedir(), 'Library', 'Application Support', 'cli-tasker', 'tasker.db'
    );
    if (dbPath === prodPath) {
      throw new Error('FATAL: Test DB path resolved to production path. Aborting.');
    }

    // 4. Capture stderr for diagnostic output on failure
    const stderrLines: string[] = [];

    // 5. Launch Electron
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

    app.process().stderr?.on('data', (d: Buffer) => stderrLines.push(d.toString()));

    await use(app);

    // 6. Teardown: proper process exit waiting (not a magic sleep)
    const proc = app.process();
    await app.evaluate(({ app: a }) => a.quit()).catch(() => {});
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) { resolve(); return; }
      const deadline = setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL');
        resolve();
      }, 5_000);
      proc.once('exit', () => { clearTimeout(deadline); resolve(); });
    });
    await fs.rm(tmpDir, { recursive: true, force: true });
  },

  page: async ({ electronApp }, use) => {
    // Always use firstWindow() — do NOT check existing pages (race condition)
    const page = await electronApp.firstWindow({ timeout: 15_000 });
    await page.waitForLoadState('domcontentloaded');
    // Wait for React to mount AND initial refresh() to complete
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10_000 });
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

#### 2.3b Create test helpers

**File:** `apps/desktop/e2e/helpers.ts`

```typescript
import type { Page, Locator } from '@playwright/test';

/**
 * Wait for the 200ms search debounce + IPC round trip to complete.
 * Call after filling the search input.
 */
export async function waitForSearchDebounce(page: Page): Promise<void> {
  await page.waitForTimeout(350);
  await page.waitForSelector('[data-testid="app-ready"]');
}

/**
 * Drag a task vertically using manual pointer events.
 * Playwright's dragTo() does NOT work with dnd-kit because dnd-kit
 * uses pointermove events (not the HTML5 drag API).
 *
 * The VerticalPointerSensor cancels drag if dx > dy, so movement
 * must be strictly vertical (keep endX === startX).
 */
export async function dragTaskVertical(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<void> {
  const srcBox = await source.boundingBox();
  const tgtBox = await target.boundingBox();
  if (!srcBox || !tgtBox) throw new Error('Cannot get bounding box for drag');

  const startX = srcBox.x + srcBox.width / 2;
  const startY = srcBox.y + srcBox.height / 2;
  const endY = tgtBox.y + tgtBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Initial nudge to set vertical direction (activate the 5px threshold)
  await page.mouse.move(startX, startY + 6);
  // Move to target with 20 intermediate pointermove events
  await page.mouse.move(startX, endY, { steps: 20 });
  await page.mouse.up();
}
```

#### 2.4 Add npm scripts

**File:** `apps/desktop/package.json`

```json
"test:e2e": "pnpm build && playwright test --config playwright.config.ts",
"test:e2e:debug": "pnpm build && playwright test --config playwright.config.ts --headed --timeout 0"
```

The `pnpm build` prefix ensures tests always run against current code. The `debug` variant runs headed with no timeout for human investigation.

Root `package.json`:
```json
"test:e2e": "pnpm --filter @tasker/desktop run test:e2e"
```

### Phase 3: Test Specs

All tests live in `apps/desktop/e2e/`. Each test file covers a feature area. All test data is created through the UI — no DB seeding.

**Important timing notes for all tests:**
- Status bar assertions must happen immediately after the triggering action (the 3s `statusTimeoutRef` clears the message)
- After search input changes, call `waitForSearchDebounce()` before asserting results
- Drag-and-drop order assertions use DOM position (`:nth-child`), not `data-testid`
- `popup:hidden` never fires in test mode, so position-based assertions see the optimistic (pre-re-sort) state

#### 3.1 `task-crud.spec.ts`

- [x] Add a task: click add-task input, type description, press Enter, verify task appears
- [x] Add a task with inline metadata: type `Buy milk\np1 @2026-03-01 #shopping`, verify due date badge, tag pill
- [x] Edit/rename a task: right-click task → wait for `[role="menu"]` → click Edit menuitem → modify text → Cmd+Enter → verify updated
- [x] Cancel edit: right-click task → Edit → modify text → Escape → verify original text
- [x] Complete a task: click checkbox → verify status changes to Done (checkmark appears)
- [x] Uncomplete a task: click Done checkbox → verify status reverts to Pending
- [x] Delete a task: right-click → Delete menuitem → verify task removed from list
- [ ] Delete a task with subtasks: right-click → hover "Delete..." submenu trigger → click "Task and subtasks" → verify all removed

#### 3.2 `drag-and-drop.spec.ts`

- [x] Reorder tasks via pointer drag: create 3 tasks, use `dragTaskVertical()` helper to drag task 3 above task 1, verify new DOM order
- [ ] Reorder tasks via keyboard: create 3 tasks, focus task, Space → ArrowUp → Space, verify reorder
- [x] Undo a reorder: drag task → Cmd+Z → verify original order restored (critical: catches wrong-index-type bugs from C# learnings)

**Removed:** "verify sort order survives app restart" — persistence is covered by unit tests; the fixture doesn't naturally support relaunch without significant complexity.

#### 3.3 `context-menus.spec.ts`

Context menus are Radix `ContextMenu` rendered in-DOM portals — fully testable with Playwright. Portal content renders on `document.body` outside the app root, so use `page.getByRole('menu')` directly (not scoped to app root).

- [x] Task context menu opens on right-click: `locator.click({ button: 'right' })` → `page.waitForSelector('[role="menu"]')`
- [x] Edit option opens inline editor: `page.getByRole('menuitem', { name: 'Edit' }).click()`
- [x] "Set Status" submenu: `page.getByRole('menuitem', { name: /Status/ }).hover()` → wait for second `[role="menu"]` → verify 3 states
- [x] "Move to..." submenu shows available lists (needs 2+ lists): hover trigger → verify list names in submenu
- [x] Move task to another list: select target list from submenu → verify task disappears from source, appears in target
- [ ] Delete option removes task
- [ ] Markdown image context menu: right-click image → "Copy image path" visible
- [ ] Markdown link context menu: right-click link → "Open link" and "Copy link" visible

Note: Tray right-click native menu (Reminder Sync, Quit) is **out of scope** — cannot be tested via Playwright.

#### 3.4 `markdown.spec.ts`

- [x] Markdown renders in task description: bold, italic, code, links
- [x] Clickable checkbox: click checkbox icon → description updated with `[x]` → verify toggle
- [x] Code block renders as `<pre><code>`
- [x] Links render as `<a>` with correct `href` and text

**Removed:** "verify `shell:openExternal` IPC is called" — intercepting IPC from the renderer requires complex main-process monkey-patching. Link rendering correctness is sufficient for E2E; handler wiring is covered by code review.

#### 3.5 `undo-redo.spec.ts`

- [x] Undo task creation: add task → Cmd+Z → task disappears → status bar shows "Undone: ..." (assert immediately — 3s timeout clears message)
- [x] Redo after undo: add task → Cmd+Z → Cmd+Shift+Z → task reappears
- [x] Undo status change: complete task → Cmd+Z → task reverts to pending
- [x] **Undo reorder: drag task to new position → Cmd+Z → verify original order restored** (critical gap: the C# solution documented a bug where wrong index type caused silent incorrect behavior)
- [x] Empty undo stack: Cmd+Z with nothing to undo → status bar shows "Nothing to undo"
- [x] New action clears redo stack: add task → Cmd+Z → add another task → Cmd+Shift+Z → nothing happens

#### 3.6 `lists.spec.ts`

- [x] Create a new list: click `[data-testid="new-list-button"]` → type name → Enter → list section appears
- [x] Switch between lists: create 2 lists, add tasks to each, verify correct tasks shown per list
- [ ] Delete a non-default list: right-click `[data-testid="list-header-{name}"]` → Delete → verify list and its tasks removed
- [ ] Default list protection: verify default "tasks" list cannot be deleted (delete option hidden or disabled)
- [x] Collapse/expand list: click collapse toggle → tasks hidden → click again → tasks visible
- [x] Hide completed: toggle "hide completed" → Done tasks disappear → toggle again → Done tasks reappear

#### 3.7 `search.spec.ts`

- [x] Search by text: fill search input → `waitForSearchDebounce()` → matching tasks shown, non-matching hidden
- [x] Search by tag: type `tag:shopping` → `waitForSearchDebounce()` → only tagged tasks shown
- [x] Clear search: clear input → `waitForSearchDebounce()` → all tasks shown again
- [x] No results: search for non-existent text → `waitForSearchDebounce()` → empty state shown

## Acceptance Criteria

- [x] `pnpm test:e2e` runs all E2E tests from the monorepo root (includes a build step)
- [x] Tests use a temp database — never touch production data at `~/Library/Application Support/cli-tasker/`
- [x] Tests can run while the real desktop app is open (separate app identity via `TASKER_USER_DATA`)
- [x] Each test starts with a fresh, empty database (no state leakage between tests)
- [x] All test specs pass on a clean build
- [x] Fixture teardown reliably kills the Electron process (no zombie processes)
- [x] Fixture throws a clear error if build is stale or env vars are missing
- [x] `playwright-report/` contains HTML traces on failure for agent debugging

## Scope Exclusions (YAGNI)

- No CI/CD integration — local AI agent use only
- No visual regression / screenshot comparison
- No parallel test execution (workers: 1)
- No test reporting dashboards
- No testing of tray native context menu or system notifications
- No testing of reminder sync or due date notifier
- No testing of clipboard/paste-image IPC
- No testing of IPC failure/error paths (covered by unit tests)
- No DB seeding utilities (UI-driven setup only; reconsider if setup flakiness becomes a problem)
- No `electronApp.close()` — it hangs for tray apps ([issue #20016](https://github.com/microsoft/playwright/issues/20016))

## Dependencies & Risks

**Dependencies:**
- Playwright `_electron` API is marked **experimental** — API may change between major versions
- No `electron-playwright-helpers` needed — teardown is ~10 lines inline

**Risks:**
- **Drag-and-drop flakiness** — dnd-kit `VerticalPointerSensor` cancels if `dx > dy`. Mitigation: `dragTaskVertical()` helper keeps movement strictly vertical with `steps: 20` for intermediate pointermove events.
- **Popup focus/blur** — blur-hide is disabled in test mode (load-bearing guard). If accidentally re-enabled, the entire test suite will break from phantom refresh storms.
- **Build step required** — tests run against `dist-electron/main.js`, not source. Mitigation: `test:e2e` script includes `pnpm build`; fixture throws if any `electron/*.ts` file is newer than `dist-electron/main.js`.
- **Optimistic UI vs DB state** — status changes and reorders use optimistic local dispatch. Since `popup:hidden` never fires in test mode, re-sorting never occurs during tests. Tests that need to verify DB-persisted order must check via a fresh app launch or accept the optimistic state.
- **Search debounce** — 200ms `useDebounce` creates an invisible async gap. All search tests must use `waitForSearchDebounce()` helper.
- **Status bar timeout** — `showStatus` clears after 3s. Status bar assertions must happen immediately after the triggering action.

## References

- Brainstorm: `docs/brainstorms/2026-02-19-playwright-e2e-tests-brainstorm.md`
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)
- [ElectronApplication API](https://playwright.dev/docs/api/class-electronapplication)
- [electronApp.close() hangs for tray apps — issue #20016](https://github.com/microsoft/playwright/issues/20016)
- [firstWindow() race condition — issue #27658](https://github.com/microsoft/playwright/issues/27658)
- [env option replaces process.env — issue #11705](https://github.com/microsoft/playwright/issues/11705)
- Electron main process: `apps/desktop/electron/main.ts`
- Tray/popup logic: `apps/desktop/electron/lib/tray.ts`
- DB path logic: `packages/core/src/db.ts:getDefaultDbPath()`
- Watcher: `apps/desktop/electron/lib/watcher.ts`
- Store (refresh/optimistic updates): `apps/desktop/src/hooks/use-tasker-store.ts`
- IPC channels: `apps/desktop/electron/ipc/*/channels.ts`
- Existing unit tests: `apps/desktop/tests/`
- Learnings: `docs/solutions/testing/test-isolation-prevention-strategies.md` (critical incident: tests wiped production data)
- Learnings: `docs/solutions/ui-bugs/task-teleportation-on-status-change.md` (optimistic updates, refresh timing)
- Learnings: `docs/solutions/undo-system/undo-support-for-reorder-operations.md` (wrong index type bug)
