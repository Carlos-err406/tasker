import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { configureHost } from "../../../../packages/ui/src/host";
import { TouchTaskActions } from "../../../../packages/ui/src/components/TouchTaskActions";
import { MarkdownContent } from "../../../../packages/ui/src/components/MarkdownContent";
import { TaskItem } from "../../../../packages/ui/src/components/TaskItem";
import { TooltipProvider } from "../../../../packages/ui/src/components/ui/tooltip";
import type { Task } from "@tasker/core/types";
import "../../../../packages/ui/src/styles.css";
import "../../../android/src/mobile.css";

configureHost({
  touch: true,
  operations: {} as never,
  onDbChanged: () => () => {},
  onPopupShown: () => () => {},
  onPopupHidden: () => () => {},
  openExternal: async () => {},
  saveImage: async () => "",
  resolveMedia: (src) => src,
});

function Fixture() {
  const [clicks, setClicks] = useState(0);
  const tap = () => setClicks((value) => value + 1);
  return (
    <div className="mobile-shell">
      <output data-testid="click-count">{clicks}</output>
      <TouchTaskActions
        title="Gesture fixture"
        shortId="test"
        actions={[{ label: "Edit", onSelect: tap, deferUntilClosed: true }]}
      >
        <div style={{ padding: 16 }} onClick={tap}>
          <span data-testid="text">Task text</span>
          <button
            data-testid="button"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span>Button with a nested target</span>
          </button>
          <a data-testid="link" href="#link">
            Link
          </a>
          <input data-testid="checkbox" type="checkbox" />
          <img
            data-testid="image"
            alt="Fixture"
            width="100"
            height="60"
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='60'%3E%3C/svg%3E"
          />
          <video data-testid="video" controls />
          <MarkdownContent
            content="![hidden](https://example.invalid/image.png)"
            showMediaPreviews={false}
          />
        </div>
        {createPortal(
          <button data-testid="portal" onClick={tap}>
            Separate editor surface
          </button>,
          document.body,
        )}
      </TouchTaskActions>
    </div>
  );
}

function TaskFixture() {
  const [lastAction, setLastAction] = useState("");
  const [task, setTask] = useState<Task>({
    id: "abc-task",
    description:
      "Drawer task\n\n![sample](https://example.invalid/image.png)\n\n[Website](https://example.invalid)\n\n[Video](https://example.invalid/clip.mp4)\n\n```\nconst example = 1;\n```" +
      (location.search.includes("two-images")
        ? "\n\n![sample](https://example.invalid/second.png)"
        : ""),
    status: 0,
    createdAt: "2026-09-28",
    listName: "Tasks",
    dueDate: null,
    priority: null,
    tags: null,
    isTrashed: 0,
    sortOrder: 0,
    completedAt: null,
    parentId: null,
  });
  return (
    <TooltipProvider>
      <div className="mobile-shell">
        <output data-testid="last-action">{lastAction}</output>
        <TaskItem
          task={task}
          lists={["Tasks", "Other"]}
          relDetails={{
            parent: null,
            subtasks: [{ id: "child", title: "Child", status: 0 }],
            blocks: [],
            blockedBy: [],
            related: [],
          }}
          onToggleStatus={() => setLastAction("toggle")}
          onSetStatus={(_, status) => {
            setTask({ ...task, status });
            setLastAction(`status:${status}`);
          }}
          onRename={async (_, description) => {
            setTask({ ...task, description });
            return true;
          }}
          onDelete={(_, cascade) => setLastAction(`delete:${cascade}`)}
          onMove={(_, list) => setLastAction(`move:${list}`)}
          onShowStatus={setLastAction}
          onNavigateToTask={() => {}}
          onCreateSubtask={() => setLastAction("subtask")}
          showMediaPreviews={false}
        />
      </div>
    </TooltipProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  location.search.includes("task") ? <TaskFixture /> : <Fixture />,
);
