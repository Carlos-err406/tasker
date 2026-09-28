import { createContext, useContext, type ReactNode } from "react";
import {
  TaskMenuItems,
  useTaskMediaActions,
  type TaskMenuAction,
} from "./task-menu-actions.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuSeparator,
} from "./ui/context-menu.js";

interface TaskMenu {
  items: ReactNode;
  onCloseAutoFocus: (event: Event) => void;
}

const TaskMenuContext = createContext<TaskMenu | null>(null);
export function TaskContextMenu({
  items,
  onCloseAutoFocus,
  children,
}: TaskMenu & { children: ReactNode }) {
  return (
    <TaskMenuContext.Provider value={{ items, onCloseAutoFocus }}>
      <ContextMenu>{children}</ContextMenu>
    </TaskMenuContext.Provider>
  );
}

/** Media menus retain the owning task's actions and editor focus handoff. */
export function TaskContextMenuContent({
  children,
  mediaLabel,
  imagePreview,
  actions = [],
}: {
  children?: ReactNode;
  mediaLabel?: string;
  imagePreview?: string;
  actions?: TaskMenuAction[];
}) {
  const taskMenu = useContext(TaskMenuContext);
  useTaskMediaActions(mediaLabel, actions, imagePreview);
  return (
    <ContextMenuContent
      collisionPadding={8}
      onCloseAutoFocus={taskMenu?.onCloseAutoFocus}
    >
      {children}
      <TaskMenuItems actions={actions} />
      {(children || actions.length > 0) && taskMenu && <ContextMenuSeparator />}
      {taskMenu?.items}
    </ContextMenuContent>
  );
}
