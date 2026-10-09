import { useEffect, useRef } from "react";
import { CircleHelp } from "lucide-react";
import { Kbd, KbdGroup } from "./ui/kbd.js";
import { PanelHeader } from "./PanelHeader.js";
import { Button } from "./ui/button.js";

export function HelpPanel({
  onClose,
  touch = false,
  onAbout,
}: {
  onClose: () => void;
  touch?: boolean;
  onAbout?: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label="Tasker help"
      data-testid="help-panel"
      className="flex flex-col h-full min-h-0 outline-none"
    >
      <PanelHeader title="Help" icon={CircleHelp} onClose={onClose}>
        {onAbout && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-2 text-xs"
            onClick={onAbout}
          >
            About Tasker
          </Button>
        )}
      </PanelHeader>
      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4 text-xs">
        {touch && (
          <section>
            <h3 className="font-medium text-sm mb-1.5">Touch Controls</h3>
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
              <li>Tap + to add; tap a checkbox to complete.</li>
              <li>Swipe either way or tap ⋯ for task actions.</li>
              <li>Tap an image to enlarge it.</li>
              <li>Tap the list name to switch or manage lists.</li>
              <li>Use the bottom ⋯ for app options.</li>
              <li>Pull down at the top of the list to sync.</li>
            </ul>
          </section>
        )}
        <section>
          <h3 className="font-medium text-sm mb-1.5">Metadata Prefixes</h3>
          <p className="text-muted-foreground mb-2">
            Put metadata on a separate last line below your task description.
          </p>
          <div className="grid grid-cols-2 gap-1 text-muted-foreground">
            <span className="font-mono">p1, p2, p3</span>
            <span>Priority (high, medium, low)</span>
            <span className="font-mono">@date</span>
            <span>Due date (type @ to pick one)</span>
            <span className="font-mono">@date 6:30pm</span>
            <span>Due date and time (9am, 18:30)</span>
            <span className="font-mono">*weekly</span>
            <span>Repeat: *daily, *monthly, *yearly, *3d, *2w</span>
            <span className="font-mono">#tag</span>
            <span>Tag</span>
            <span className="font-mono">^abc</span>
            <span>Set parent task</span>
            <span className="font-mono">!abc</span>
            <span>Blocks task</span>
            <span className="font-mono">-^abc</span>
            <span>Has subtask</span>
            <span className="font-mono">-!abc</span>
            <span>Blocked by task</span>
            <span className="font-mono">~abc</span>
            <span>Related task</span>
            <span className="font-mono">&gt;list-name</span>
            <span>Create in / move to list (removed on save)</span>
          </div>
        </section>

        <section>
          <h3 className="font-medium text-sm mb-1.5">Date Formats</h3>
          <div className="grid grid-cols-2 gap-1 text-muted-foreground">
            <span className="font-mono">today, tomorrow</span>
            <span>Relative days</span>
            <span className="font-mono">mon, tue, ... sun</span>
            <span>Next weekday</span>
            <span className="font-mono">jan15, feb3</span>
            <span>Month + day</span>
            <span className="font-mono">+3d</span>
            <span>Days from now</span>
            <span className="font-mono">2026-02-15</span>
            <span>Exact date</span>
          </div>
          <p className="text-muted-foreground mt-2">
            Completing a repeating task moves it to its next date instead. Won&apos;t Do skips one date. Remove the *
            token to stop repeating.
          </p>
        </section>

        <section>
          <h3 className="font-medium text-sm mb-1.5">Search Filters</h3>
          <p className="text-muted-foreground mb-2">
            Search applies to the selected list. Use the list picker to switch
            lists.
          </p>
          <div className="grid grid-cols-2 gap-1 text-muted-foreground">
            <span className="font-mono">tag:name</span>
            <span>Filter by tag</span>
            <span className="font-mono">status:done</span>
            <span>pending, wip, done</span>
            <span className="font-mono">priority:high</span>
            <span>high/p1, medium/p2, low/p3</span>
            <span className="font-mono">due:today</span>
            <span>today, overdue, week, month</span>
            <span className="font-mono">list:name</span>
            <span>Filter by list</span>
            <span className="font-mono">has:subtasks</span>
            <span>subtasks, parent, due, tags</span>
            <span className="font-mono">id:abc</span>
            <span>Filter by task ID prefix</span>
            <span className="font-mono">status:!done</span>
            <span>Negate any filter with !</span>
          </div>
        </section>

        {!touch && (
          <>
            <section>
              <h3 className="font-medium text-sm mb-1.5">Keyboard Shortcuts</h3>
              <div className="grid grid-cols-2 gap-1 text-muted-foreground items-center">
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>P</Kbd>
                </KbdGroup>
                <span>Toggle previews</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
                <span>Focus search</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>R</Kbd>
                </KbdGroup>
                <span>Sync and refresh</span>
                <Kbd>Esc</Kbd>
                <span>Clear search when focused</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>Z</Kbd>
                </KbdGroup>
                <span>Undo</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>⇧</Kbd>
                  <Kbd>Z</Kbd>
                </KbdGroup>
                <span>Redo</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>J</Kbd>
                </KbdGroup>
                <span>Apply system sort</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>/</Kbd>
                </KbdGroup>
                <span>Toggle help</span>
                <Kbd>Esc</Kbd>
                <span>Close help</span>
              </div>
            </section>

            <section>
              <h3 className="font-medium text-sm mb-1.5">Editing Shortcuts</h3>
              <div className="grid grid-cols-2 gap-1 text-muted-foreground items-center">
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>Enter</Kbd>
                </KbdGroup>
                <span>Save task</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>B</Kbd>
                </KbdGroup>
                <span>Bold</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>I</Kbd>
                </KbdGroup>
                <span>Italic</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>U</Kbd>
                </KbdGroup>
                <span>Underline</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>⇧</Kbd>
                  <Kbd>X</Kbd>
                </KbdGroup>
                <span>Strikethrough</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
                <span>Insert link</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>⇧</Kbd>
                  <Kbd>I</Kbd>
                </KbdGroup>
                <span>Insert image</span>
                <Kbd>Tab</Kbd>
                <span>Next placeholder</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>V</Kbd>
                </KbdGroup>
                <span>Paste image from clipboard</span>
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
