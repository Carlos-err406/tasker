import type { ReactNode } from "react";
import type { Settings as SettingsValues, SettingKey } from "@tasker/core/queries";
import {
  Archive,
  ArrowUpDown,
  Bell,
  ChevronRight,
  Eye,
  Images,
  Info,
  Settings,
} from "lucide-react";
import { PanelHeader } from "./PanelHeader.js";
import { Switch } from "./ui/switch.js";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.js";
import { Kbd } from "./ui/kbd.js";

const GROUP =
  "divide-y divide-border overflow-hidden rounded-lg border border-border bg-muted/20";
const ICON = "size-4 text-muted-foreground";

function Row({
  icon,
  title,
  detail,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      {children}
    </div>
  );
}

/** This device's settings. Backups & sync opens from here. */
export function SettingsPanel({
  settings,
  onChange,
  onOpenBackups,
  onClose,
  notifications = false,
  touch = false,
}: {
  settings: SettingsValues;
  onChange: (key: SettingKey, value: boolean) => void;
  onOpenBackups: () => void;
  onClose: () => void;
  /** Whether this device can show notifications yet. */
  notifications?: boolean;
  touch?: boolean;
}) {
  const toggle = (key: SettingKey, label: string) => (
    <Switch
      aria-label={label}
      checked={settings[key]}
      onCheckedChange={(value) => onChange(key, value)}
    />
  );
  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="settings-panel">
      <PanelHeader title="Settings" icon={Settings} onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <p className="text-xs text-muted-foreground">These settings apply to this device only.</p>
        <div className={GROUP}>
          <Row
            icon={<Eye className={ICON} />}
            title="Show completed tasks"
            detail="Done and won't-do tasks stay in every list"
          >
            {toggle("showCompleted", "Show completed tasks")}
          </Row>
          <Row
            icon={<Images className={ICON} />}
            title={
              <>
                Media previews
                {!touch && <Kbd className="ml-1">⌘P</Kbd>}
              </>
            }
            detail="Show images and videos inside tasks"
          >
            {toggle("mediaPreviews", "Media previews")}
          </Row>
          <Row
            icon={<ArrowUpDown className={ICON} />}
            title={
              <>
                Auto sort
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="About auto sort"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Info className="size-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start">
                    Every list is re-sorted by status, priority and due date whenever a task is added
                    or changed. Dragging to reorder tasks is turned off while auto sort is on.
                  </PopoverContent>
                </Popover>
              </>
            }
            detail="Keep lists in system order after every change"
          >
            {toggle("autoSort", "Auto sort")}
          </Row>
          {notifications && (
            <Row
              icon={<Bell className={ICON} />}
              title="Notifications"
              detail="Remind at due times; 9:00 for date-only tasks"
            >
              {toggle("notifications", "Notifications")}
            </Row>
          )}
        </div>
        <div className={GROUP}>
          <button
            type="button"
            onClick={onOpenBackups}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <Archive className={ICON} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Backups & sync</div>
              <div className="text-xs text-muted-foreground">Snapshots, Google Drive and device sync</div>
            </div>
            <ChevronRight className={ICON} />
          </button>
        </div>
      </div>
    </section>
  );
}
