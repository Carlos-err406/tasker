# Tasker SwiftBar

Canonical checkout: `/Users/carlos/Developer/tasker`; origin: `https://github.com/Carlos-err406/tasker.git`. The old app at `https://github.com/Carlos-err406/tasker-ref.git` is reference-only.

Implement the approved plan in `docs/plans/swiftbar-mvp.md`. Apply later scope decisions in `docs/scope-decisions.md`. Track execution evidence separately in `docs/implementation-status.md`.

- This is a separate repository. Do not modify or connect to cli-tasker's live database.
- MVP: macOS SwiftBar and local/Google Drive backups. Zero hosting budget. No Supabase, mobile implementation, CalDAV or multi-device merge.
- Preserve the extracted parsers, rendering/editing behavior and stable task order.
- Keep Node/SQLite dependencies out of the browser UI. Inject host operations through `packages/ui/src/host.ts`.
- Use the existing shadcn components rather than direct Radix imports in feature components.
- Store managed images as SQLite BLOBs. Keep their portable references and avoid returning bytes in task-list queries.
- Build core before consumers: `pnpm build`. Run `pnpm test`, `pnpm typecheck`, and `pnpm test:e2e` against isolated data. E2E requires a built UI and Playwright WebKit.
- Browser tests do not prove actual SwiftBar focus/lifecycle behavior. Keep the actual host gate explicit.
- Never commit runtime.json, account credentials, local task databases or downloaded user backups.

- Source `apps/macos/src/google/public-client.ts` must remain an unconfigured placeholder. Official builds inject public Desktop OAuth fields into its ignored compiled output using `TASKER_GOOGLE_BUILD_CLIENT_JSON`. Do not commit actual client IDs/secrets, raw downloaded JSON, account grants, or runtime state; only public app fields may enter release artifacts. Service-launch tests must use a unique dummy OAuth override so they cannot access real Keychain grants or upload test snapshots to a user's Drive.
- `pnpm release:archive` creates a prebuilt runtime archive using explicit packaging inputs. It does not publish the archive or configure Google's production audience.

- `install.sh` is the public curl installer. It installs verified runtime downloads under `~/.local/share/tasker`, uses existing SwiftBar settings, and supplies the tested fork only when missing. Keep installer tests isolated with temporary paths, a dummy OAuth client, and `TASKER_SWIFTBAR_SERVICE_LABEL`; use `--no-open` to avoid host side effects. Run `shellcheck install.sh` after shell changes. Publish both the runtime archive and its `.sha256` file for each release.

- `.github/workflows/release.yml` validates PRs/main/tags and publishes stable `vX.Y.Z` tags only after checks. Keep all four package versions and the plugin version aligned, with notes in `docs/releases/<version>.md`. The publishing job uses the `TASKER_GOOGLE_DESKTOP_CLIENT_JSON` repository secret; never print its value or expose it to PR checks. `scripts/publish-release.mjs` verifies uploaded assets before making a draft public and never replaces published releases. Tag only commits already merged into main.
