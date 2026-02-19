import { Kbd, KbdGroup } from '@/components/ui/kbd.js';

interface HelpPanelProps {
  onClose: () => void;
}

export function HelpPanel({ onClose }: HelpPanelProps) {
  return (
    <div className="absolute inset-0 z-40 bg-background/95 backdrop-blur-sm overflow-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">Help</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          Close
        </button>
      </div>

      <div className="space-y-4 text-xs">
        <section>
          <h3 className="font-medium text-sm mb-1.5">Metadata Prefixes</h3>
          <div className="grid grid-cols-2 gap-1 text-muted-foreground">
            <span className="font-mono">p1, p2, p3</span>
            <span>Priority (high, medium, low)</span>
            <span className="font-mono">@date</span>
            <span>Due date</span>
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
        </section>

        <section>
          <h3 className="font-medium text-sm mb-1.5">Search Filters</h3>
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

        <section>
          <h3 className="font-medium text-sm mb-1.5">Keyboard Shortcuts</h3>
          <div className="grid grid-cols-2 gap-1 text-muted-foreground items-center">
            <KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
            <span>Focus search</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>R</Kbd></KbdGroup>
            <span>Refresh</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>Z</Kbd></KbdGroup>
            <span>Undo</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>Z</Kbd></KbdGroup>
            <span>Redo</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>E</Kbd></KbdGroup>
            <span>Collapse/expand all</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>J</Kbd></KbdGroup>
            <span>Apply system sort</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>W</Kbd></KbdGroup>
            <span>Close popup</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>L</Kbd></KbdGroup>
            <span>Toggle logs</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>/</Kbd></KbdGroup>
            <span>Toggle help</span>
            <Kbd>Esc</Kbd>
            <span>Close / Cancel</span>
          </div>
        </section>

        <section>
          <h3 className="font-medium text-sm mb-1.5">Editing Shortcuts</h3>
          <div className="grid grid-cols-2 gap-1 text-muted-foreground items-center">
            <KbdGroup><Kbd>⌘</Kbd><Kbd>B</Kbd></KbdGroup>
            <span>Bold</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>I</Kbd></KbdGroup>
            <span>Italic</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>U</Kbd></KbdGroup>
            <span>Underline</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>X</Kbd></KbdGroup>
            <span>Strikethrough</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
            <span>Insert link</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>I</Kbd></KbdGroup>
            <span>Insert image</span>
            <Kbd>Tab</Kbd>
            <span>Next placeholder</span>
            <KbdGroup><Kbd>⌘</Kbd><Kbd>V</Kbd></KbdGroup>
            <span>Paste image from clipboard</span>
          </div>
        </section>
      </div>
    </div>
  );
}
