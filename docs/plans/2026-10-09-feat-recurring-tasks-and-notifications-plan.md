# Recurring tasks and notifications

Approved 2026-10-09. Covers Tasker tasks `dku` (repetitive tasks, e.g. airing anime) and `tbb` (task notifications).

## Decisions so far (user, 2026-10-09)

- **Repeat:** completing a repeating task rolls it forward in place. It returns to pending with the next due date, keeping its ID, links and tags. No history copy is kept.
- **Repeat syntax:** `*interval` on the metadata line.
- **Time syntax:** 12-hour, as a separate token after the due date: `@sat 6:30pm`, `@nov1 9am`.
- **Date-only tasks:** notify at 9:00 on their due date.
- **Devices:** both Mac and phone notify, each from its own copy of the tasks. Duplicate reminders across devices are accepted.

## Syntax

The metadata line gains two token kinds:

| Token | Meaning | Examples |
|---|---|---|
| time | Time of day for the due date. Only valid directly after an `@date` token. | `6:30pm`, `9am`, `12pm`, `12:15am` |
| `*interval` | Repeat, counted from the due date | `*daily`, `*weekly`, `*monthly`, `*yearly`, `*2d`, `*3w`, `*2m` |

```
Watch Frieren
@sat 6:30pm *weekly #anime

Pay rent
@nov1 9am *monthly p1
```

- Times are case-insensitive (`6:30PM`). Minutes are optional. Hours run 1–12.
- A time or `*interval` without an `@date` is not metadata. As today, a line containing a non-metadata token is part of the description. So `6pm` alone, or `*weekly` with no due date, does nothing; adding it through the app or MCP returns a warning.
- `*` is unused by metadata today. A Markdown bullet (`* item`) has a space after the `*`, so it can't be mistaken for a repeat.
- Nothing new is stored in the database. The time and repeat rule live in the task text and are parsed when needed, like tags and relationships, and the due date column stays as it is. **The sync format doesn't change.** Older app versions keep the tokens as text and don't repeat or notify.

## Rolling forward

When a repeating task with a due date is marked **Done** or **Won't Do**:

1. Compute the next due date: the first `due + k × interval` (k ≥ 1) that is after today. A show due Saturday and marked done three weeks late moves to the coming Saturday, not to a past one. Monthly and yearly repeats on the 29th–31st clamp to the month's last day (Jan 31 → Feb 28), unlike the existing `+Nm` date math, which overflows (Jan 31 + 1m = Mar 3). Because the task is rewritten in place, the clamped day sticks: the next month after Feb 28 is Mar 28. Remembering the original day would need it stored in the token; this plan doesn't.
2. Rewrite the `@date` token in the text to the new date (`@sat` becomes `@2026-10-17`). The time and `*interval` tokens stay.
3. Set the task back to **pending**. Subtasks completed along with it reset to pending too, so a checklist-style subtask set repeats with its parent.
4. Record a single undo step that restores the previous text, status and subtasks.

To stop a series, remove the `*interval` token or delete the task. The status bar or MCP result says "Repeats on <date>" instead of "Done".

## Notifications

A task notifies once per occurrence, at its due time or at 9:00 for a date-only task, while it is pending or in progress and not trashed. The notification shows the title, list and time; tapping it opens Tasker.

- **Late delivery:** when the device was asleep, off or closed at the due time, the reminder is delivered on the next check if it's at most 12 hours late. Older ones are skipped, so returning from a trip doesn't produce a flood.
- **Delivery record:** delivered occurrences (task ID + due date + time) are recorded in the device-local `config` table, which doesn't sync, so restarts don't repeat them. Editing the date or time creates a new occurrence, which notifies again.
- **Before posting,** each device rechecks the task in its local database, so a task completed elsewhere and already synced doesn't notify.

### Mac

- The service checks every minute for occurrences that are due. A one-minute timer survives sleep and clock changes better than one long timer.
- It posts through the SwiftBar fork's existing `swiftbar://notify?plugin=…&title=…&body=…` handler, so notifications appear as SwiftBar's. No new native code is needed.
- A **Notifications** switch on the Mac, on by default, sits beside the other app options.
- Tests use a fake notifier and never open `swiftbar://` links.

### Android

- After every change and every sync, the web UI computes the upcoming occurrences and hands them to native code. Native code saves the schedule and sets one inexact `AlarmManager.setAndAllowWhileIdle` alarm for the earliest occurrence. The receiver rechecks the task in SQLite, posts the notification and arms the next alarm.
- Inexact alarms need no special permission. In battery saving they can arrive a few minutes late. Exact alarms need `SCHEDULE_EXACT_ALARM`, which Android 14 denies by default, so this plan doesn't use them.
- New permissions: `POST_NOTIFICATIONS` (asked at runtime on Android 13+ the first time a task with a due date is saved, or when the switch is turned on) and `RECEIVE_BOOT_COMPLETED` (re-arms after a reboot).
- A **Notifications** switch sits under App options.
- **Known limit:** the phone syncs only while Tasker is open, so a task added on the Mac notifies on the phone only after the phone has synced once. The recheck stops reminders for tasks completed on the Mac and already synced.

## Display, help and agents

- The due date chip shows the time (`Sat 6:30pm`), and repeating tasks get a small repeat icon. Sorting stays by date; tasks due on the same day keep their current order.
- The editor's autocomplete gains `*daily`, `*weekly`, `*monthly` and `*yearly` suggestions after `*`.
- The Help panel's metadata table documents the time and repeat syntax.
- The MCP server's instructions describe both tokens. `list_tasks` and `get_task` gain `time` and `repeat` fields, and completing a repeating task reports its next date.

## Phases

1. **Core and UI:** parser, roll-forward with undo, display, help and MCP. Useful alone: repeating tasks work everywhere with no notifications. Release as 1.1.0.
2. **Mac notifications.**
3. **Android notifications,** checked on a physical phone.

Each phase ships through the normal PR, CI and tag release flow.

## Verification

- **Parser:** times (valid and invalid: `13pm`, `9:60am`, a time with no date), intervals, interactions with existing tokens, and metadata-line detection.
- **Roll-forward:** late completion, month-end clamping, subtask reset, Won't Do, undo and redo, the sync projection of the rewritten text, and a task without a due date.
- **Occurrence calculation:** a pure function of tasks, now and delivered records, covering the 12-hour lateness window, date-only tasks at 9:00, and status changes.
- **Mac:** the service scheduler with a fake clock and fake notifier.
- **Android:** instrumentation tests for schedule storage, the alarm receiver's recheck and boot re-arming; then a real-phone check of permission, delivery, tap and reboot.
- **End to end:** `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`.

## Confirmed proposals (2026-10-09)

The user approved all five:

1. **Won't Do** also rolls forward, skipping one occurrence instead of ending the series.
2. **Subtasks** reset to pending when their parent rolls forward.
3. **24-hour input** (`18:30`) is also accepted, but displayed as 12-hour.
4. **Late reminders** are delivered when at most 12 hours late; older ones are skipped.
5. **Phase 1 ships alone** as 1.1.0, before notifications.
