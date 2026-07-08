# Mobile App (Android) — Brainstorm

**Date:** 2026-03-17
**Task:** #8b7
**Status:** Brainstorm complete

## What We're Building

A full Android app + home screen widget for Tasker, built with Expo (React Native). The app provides complete task management (add, edit, reorder, lists, search), while a companion widget shows tasks at a glance with quick check-off.

Data syncs between Mac (CLI + desktop) and Android via Turso embedded replicas, implemented in a phased approach: local-only first, sync second.

## Why This Approach

**Expo + phased Turso sync** was chosen because:

1. **Maximum code reuse** — `@tasker/core` is 95% portable. Types, schema, parsers, queries, and undo all work with a Drizzle driver swap. Only `db.ts` and ~5 `getRawDb()` calls need adaptation.
2. **Expo is the fastest path** — `expo-sqlite` has native Drizzle support, EAS Build handles CI, and the managed workflow avoids native Android toolchain friction.
3. **Turso solves sync** — Embedded replicas give each device a local SQLite copy that syncs automatically. Free tier (9GB, 500 DBs) is more than enough. No custom sync protocol needed.
4. **Phasing derisks** — Building local-only first validates the core refactor and app/widget before adding sync complexity.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| App type | Full app + home screen widget | Widget for quick glances/check-off, app for full management |
| Framework | Expo (React Native) | Fastest path, expo-sqlite + Drizzle, EAS Build |
| Sync | Turso embedded replicas (phase 2) | Hosted SQLite sync, free tier, Drizzle-native support |
| Repo location | `apps/mobile/` in monorepo | Direct `@tasker/core` sharing, unified versioning |
| Core sharing | Refactor core to be driver-agnostic | Single codebase, driver interface pattern. Desktop passes better-sqlite3, mobile passes expo-sqlite |

## Architecture Overview

### Monorepo Structure

```
packages/core/          — shared core (refactored for driver-agnostic SQLite)
apps/cli/               — CLI (unchanged)
apps/desktop/           — Electron desktop (unchanged, uses new driver interface)
apps/mobile/            — Expo Android app (new)
```

Exact file layout for the driver abstraction is a planning-phase decision.

### Core Refactor (Phase 1 prerequisite)

The `@tasker/core` refactor involves:

1. **Driver interface** — Abstract `TaskerDb` creation behind a factory that accepts any Drizzle SQLite dialect
2. **Replace `getRawDb()` calls** (~5 locations) — Use Drizzle's `sql` template or a raw query interface that works across drivers
3. **Extract Node.js deps** — Move `node:fs`/`node:path`/`node:os` usage in `db.ts` behind platform-specific factory functions
4. **Keep backup Node-only** — `BackupManager` stays desktop/CLI only (mobile backup would be Turso's job)

### Phase 1: Local-Only App + Widget

- Expo app with `expo-sqlite` + Drizzle
- Reuses all `@tasker/core` queries, parsers, undo system
- Full task CRUD, lists, search, status management
- UI direction: similar feature set to the desktop tray app, adapted for mobile navigation patterns (stack navigator, pull-to-refresh, swipe actions)
- Home screen widget (Android Glance or expo-widget)
- No sync — phone has its own independent database

### Phase 2: Turso Sync

- Add Turso as the remote backing store
- Mobile: embedded replica via Turso's libsql client for Expo (local SQLite that syncs)
- CLI + desktop: needs a decision — either migrate to `@libsql/client` embedded mode, or add a push/pull sync layer on top of local `better-sqlite3`. This is a significant choice that affects existing users and should be designed during phase 2 planning.
- Conflict resolution: last-write-wins at row level (Turso's default)

### Widget Approach

Android home screen widget showing:
- Task list for a selected list (configurable)
- Checkbox to toggle status
- Task count badge
- Tap task to open app at that task

Implementation options (to decide during planning):
- **expo-widget** — if mature enough by implementation time
- **Custom Kotlin Glance module** — native Android widget API, most reliable, more setup

## Resolved Questions

1. **Undo on mobile** — Independent per-device undo stacks. Simpler, avoids cross-device undo confusion.
2. **Offline conflict resolution** — Last-write-wins is acceptable. Single-user personal tool, LWW is simple and predictable.

## Open Questions

1. **Widget framework** — Is `expo-widget` production-ready, or should we go straight to Kotlin Glance? Needs evaluation at implementation time.
2. **Turso auth** — How to authenticate devices with Turso? Token per device? Single shared token? Needs security design before phase 2.
3. **Desktop/CLI sync migration** — When adding Turso sync in phase 2, should desktop/CLI migrate to `@libsql/client` (embedded replica), or keep local `better-sqlite3` with a separate push/pull mechanism? This affects existing users and workflow.
