# Playwright E2E Tests for Desktop App

**Date:** 2026-02-19
**Status:** Brainstorm
**Task:** ivy

## What We're Building

End-to-end tests for the desktop (Electron) app using Playwright, primarily so AI agents (Claude Code) can verify UI changes without manual user intervention. Tests will use an isolated in-memory database — never touching the production database.

The test suite will cover full feature flows: task CRUD, drag-and-drop reordering, context menus, markdown rendering, undo/redo, and list switching. All test data will be created through the UI (no DB seeding), so every test exercises the full creation path.

## Why This Approach

The desktop app currently has zero E2E tests. All existing desktop tests are unit tests that exercise the data layer or pure display logic — none actually launch Electron or interact with the UI. This means UI regressions (broken context menus, drag-and-drop issues, rendering bugs) can only be caught manually.

For AI agents working on the codebase, this is a blocker: they can write code but can't verify it works in the actual app. Playwright with Electron support lets agents run real user flows and confirm behavior.

## Key Decisions

### 1. Playwright with Electron (not Spectron, not WebDriverIO)

Playwright has first-class Electron support via `electron.launch()`. It's actively maintained, fast, and the same tool used for web testing. Spectron is deprecated. WebDriverIO works but has more overhead.

### 2. In-memory test database per test

Each test run gets a fresh in-memory SQLite database (same pattern as `createTestDb()`). This requires a small change to `main.ts`: when an env var like `TASKER_TEST_MODE=1` is set, use `:memory:` instead of `getDefaultDbPath()`.

This is the cleanest isolation — no temp files to clean up, no risk of leftover state, no chance of touching production data.

### 3. Separate app identity for test instances

Tests will launch Electron with a different `app.name` / `userData` path so the single-instance lock (`app.requestSingleInstanceLock()`) doesn't conflict with a running real app. This lets agents run tests without requiring the user to close their app.

### 4. UI-driven test data setup

Tests create all data through the UI rather than pre-seeding the database. This is slower but:
- Tests the full creation flow every time
- No coupling between tests and the DB schema
- More realistic — tests what users actually do
- If creation is broken, all tests fail loudly rather than silently passing on seeded data

### 5. Test organization

Tests will live in `apps/desktop/e2e/` alongside the existing `tests/` (unit tests). Each test file covers a feature area:
- `task-crud.spec.ts` — add, edit, complete, delete tasks
- `drag-and-drop.spec.ts` — reordering tasks
- `context-menus.spec.ts` — right-click menus on tasks and markdown elements
- `markdown.spec.ts` — markdown rendering, checkboxes, links
- `undo-redo.spec.ts` — undo/redo flows
- `lists.spec.ts` — list switching, creating lists

### 6. App launch helper

A shared test fixture will handle:
- Launching Electron with `TASKER_TEST_MODE=1` and a separate app identity
- Waiting for the app window to be ready
- Providing a `page` object for Playwright interactions
- Cleanup on test teardown

## Open Questions

None — all key decisions resolved through discussion.

## Scope Boundaries (YAGNI)

- **No CI/CD integration** — this is for local AI agent use, not pipelines
- **No visual regression testing** — screenshot comparison adds complexity; not needed now
- **No parallel test execution** — sequential is fine for the expected test count
- **No test reporting dashboards** — console output is sufficient
