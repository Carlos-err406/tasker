import { createContext, useContext, type ReactNode } from "react";
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
export function TaskContextMenuContent({ children }: { children?: ReactNode }) {
  const taskMenu = useContext(TaskMenuContext);
  return (
    <ContextMenuContent
      collisionPadding={8}
      onCloseAutoFocus={taskMenu?.onCloseAutoFocus}
    >
      {children}
      {children && taskMenu && <ContextMenuSeparator />}
      {taskMenu?.items}
    </ContextMenuContent>
  );
}
