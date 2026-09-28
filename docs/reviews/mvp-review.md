# MVP review — 2026-09-27

Scope: newly created tasker-swiftbar repository, approved `docs/plans/swiftbar-mvp.md`. The source checkout and its pre-existing changes are excluded.

## Review execution

Simplification skill: all three prompt assets (reuse, quality, efficiency) were read and applied sequentially in the main context, following the source repository's no-delegation mapping. Removed unused AI-era props; formatted new service/backup code; reused the extracted editor, parser, state and drag components. No speculative abstractions added. No separate lint command was configured; typecheck and formatter checks are used.

Code review: skipped (ce-code-review unavailable). The skill was loaded and its mode/scope stages attempted, but the newborn repository has no HEAD, base branch or remote (`git rev-parse --verify HEAD` fails). The skill explicitly stops when no base can be resolved and excludes unstaged new files. No completed independent review receipt is claimed. The work skill's fallback manual scan was performed on the complete new file set.

## Actionable findings from the manual scan

- Fixed: a metadata-only Drive file could be mistaken for a successful upload. Dedup now checks size and MD5 of completed bytes; a partial upload is repaired using the same Drive file ID. Regression test added.
- Fixed: an old OAuth callback finishing after disconnect/reconnect could clear the new connection's pending flag and timeout. Callback side effects are now generation-guarded.
- Fixed: synchronous Keychain reads were repeated on every status poll. Saved grant state is cached for the connection lifetime; subprocess calls have bounded timeouts.
- Fixed: imported snapshot attachment MIME/size and table structure were not sufficiently constrained. Restore now validates columns/foreign keys, accepted image types and BLOB lengths before activation.
- Fixed: failed task creation/editing closed drafts, and blur could duplicate an in-flight creation. Editors now wait for success and guard duplicate submissions.
- Fixed: startup could run two writers/services for the same app directory. An exclusive SQLite service lock rejects the second instance; its process lifecycle releases the lock.
- Fixed: database rename rollback needed a self-contained old database. Checkpoint/journal handling and six real child-process interruption tests cover the restore boundaries. Recovery marker/file-directory flushes precede destructive renames.

- Fixed: launchd can finish bootout asynchronously and reject an immediate bootstrap. Installation now retries the registration for at most five seconds; two consecutive real reinstalls pass.

## Coverage and remaining limits

Automated checks use temporary data and fake OAuth/Drive. Actual Google consent, Keychain refresh, upload/download and revocation are not verified because no desktop client was supplied; the user explicitly requested setup documentation instead. Actual SwiftBar opening, task save/reopen and smart-punctuation Markdown rendering were confirmed by the user. Final image/backup host check remains separately recorded in `docs/swiftbar-compatibility.md`.

Source installation and runtime paths are independent from cli-tasker. There is no remote or public publication. The inherited SQLite alias produces a Drizzle peer-version warning; functional storage tests pass. Vite reports an 828 KB uncompressed renderer chunk; it is served locally, and splitting this inherited renderer is outside this MVP.

## Operational validation

Check the installed service's loopback `/health`, the visible local/Drive backup timestamps and actionable errors, and the service-error log. Stop the integration with `pnpm uninstall:macos` if edits or restores fail; data is retained. Recover through a validated safety snapshot. Google status is not evidence of a successful upload until the cloud timestamp advances. No accounts, payment methods or hosted infrastructure were provisioned.
