---
title: "@powersync/node Rust SQLite extension crashes Electron app on startup with SIGABRT"
category: integration-issues
tags:
  - powersync
  - electron
  - sqlite
  - native-modules
  - rust-extension
  - sigabrt
  - pnpm-monorepo
  - electron-builder
module: apps/desktop
symptom: "Electron desktop app crashes immediately on startup with SIGABRT (Abort trap: 6) when @powersync/node is present in node_modules"
root_cause: "electron-builder packages ALL node_modules into the asar — @powersync/node's Rust SQLite extension (.dylib) panics when loaded in Electron's runtime, even if no code imports it"
date_solved: 2026-03-20
severity: high
---

# @powersync/node Crashes Electron App on Startup

## Problem

In a pnpm monorepo with `apps/desktop` (Electron) and `apps/mobile` (React Native), adding `@powersync/node` as a mobile dependency causes the desktop Electron app to crash immediately on startup with `SIGABRT`.

### Symptoms

- App tray icon briefly appears then disappears
- macOS crash report shows `SIGABRT` / `Abort trap: 6`
- Logs show: `thread '<unnamed>' panicked at src/database.rs:442:27: not yet implemented`
- The crash happens before any user code runs — it's triggered by the native module loading

### Error Details

```
thread '<unnamed>' panicked at src/database.rs:442:27:
not yet implemented
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

## Root Cause

`electron-builder` packages **all** of `node_modules` into the `.asar` archive. In a pnpm monorepo with `node-linker=hoisted`, dependencies from any workspace package end up in the shared `node_modules`. So if `apps/mobile` depends on `@powersync/node`, it gets hoisted and packaged into the desktop app.

`@powersync/node` includes a Rust-compiled SQLite extension (`.dylib` on macOS). This extension is loaded eagerly by Node's native module resolver when the package exists in `node_modules`, even if no JavaScript code imports it. The Rust extension panics because Electron's modified Node.js runtime and its bundled SQLite are incompatible with PowerSync's assumptions.

### Why Intermediate Fixes Failed

| Attempt | Result |
|---------|--------|
| Default worker mode | Electron lacks `node:sqlite` — immediate error |
| `implementation: { type: 'better-sqlite3' }` | `DefaultWorker.js` statically imports both paths — `node:sqlite` still blows up |
| Custom worker (only better-sqlite3) | ESM/CJS mismatch in asar context |
| Externalize `@powersync/node` in Vite | Rust extension still ships in asar, still panics |
| Remove from `apps/desktop/package.json` | pnpm lockfile still references it from mobile deps — still packaged |

## Working Solution

**Ensure `@powersync/node` is completely absent from the dependency tree when building the desktop app.**

### Primary Fix: Exclude mobile workspace during desktop builds

```bash
# 1. Move mobile out (or comment it from pnpm-workspace.yaml)
mv apps/mobile /tmp/tasker-mobile-backup

# 2. Reset lockfile to a known-good state
git checkout main -- pnpm-lock.yaml

# 3. Clean install without mobile deps
rm -rf node_modules apps/desktop/node_modules packages/core/node_modules
pnpm install

# 4. Verify no PowerSync in node_modules
find node_modules -path '*@powersync/node*' -name '*.dylib' 2>/dev/null
# Should return nothing

# 5. Build desktop
pnpm --filter @tasker/core run build
pnpm --filter @tasker/desktop run build
pnpm --filter @tasker/desktop exec electron-builder --config electron-builder.json5 --publish=never --dir

# 6. Restore mobile
mv /tmp/tasker-mobile-backup apps/mobile
```

### Defense in Depth: electron-builder file filters

In `electron-builder.json5`, explicitly exclude native extensions:

```json
{
  "files": [
    "dist",
    "dist-electron",
    "!**/node_modules/@powersync/**",
    "!**/node_modules/**/*.dylib",
    "!**/node_modules/**/*.so"
  ]
}
```

## Prevention

### 1. Set `hoist=false` in `.npmrc`

```ini
hoist=false
shamefully-hoist=false
```

Each workspace gets only its own dependencies — `@powersync/node` would never appear in desktop's `node_modules`.

### 2. Pre-package validation script

```bash
#!/bin/bash
# pre-package-check.sh
FORBIDDEN=("@powersync/node" "@powersync/react-native" "react-native")
for pkg in "${FORBIDDEN[@]}"; do
  if [ -d "node_modules/$pkg" ] || [ -d "apps/desktop/node_modules/$pkg" ]; then
    echo "ERROR: $pkg found in desktop node_modules. Build aborted."
    exit 1
  fi
done
```

### 3. Separate CI build jobs per platform

```yaml
# Desktop build (no mobile deps)
- run: pnpm --filter @tasker/desktop --filter @tasker/core install
- run: pnpm --filter @tasker/desktop run build

# Mobile build (separate runner)
- run: pnpm --filter @tasker/mobile --filter @tasker/core install
- run: pnpm --filter @tasker/mobile run build
```

### 4. Keep `@tasker/core` free of platform-specific deps

Core should depend only on pure JS/TS packages. Platform-specific sync belongs in the app workspace, never in shared packages.

## Key Takeaway

In a monorepo with `electron-builder`, native extensions from **any** workspace package end up in the desktop asar. Code-level exclusion (Vite externals, conditional imports) is insufficient because `electron-builder` operates on the filesystem, not the import graph. The only reliable fix is ensuring problematic native packages are not in the lockfile during desktop builds.
