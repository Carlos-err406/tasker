import {
  createContext,
  useContext,
  useEffect,
  useId,
  type ReactNode,
} from "react";
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "./ui/context-menu.js";

export interface TaskMenuAction {
  label: string;
  icon?: ReactNode;
  /** Resolved image URL for the touch drawer's content picker. */
  imagePreview?: string;
  onSelect?: () => void;
  children?: TaskMenuAction[];
  destructive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** Let the drawer finish closing before opening an editor or changing rows. */
  deferUntilClosed?: boolean;
}

export function TaskMenuItems({ actions }: { actions: TaskMenuAction[] }) {
  return actions.map((action) =>
    action.children ? (
      <ContextMenuSub key={action.label}>
        <ContextMenuSubTrigger
          disabled={action.disabled}
          className={action.destructive ? "text-destructive" : undefined}
        >
          {action.icon}
          {action.label}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent collisionPadding={8}>
          <TaskMenuItems actions={action.children} />
        </ContextMenuSubContent>
      </ContextMenuSub>
    ) : (
      <ContextMenuItem
        key={action.label}
        onSelect={action.onSelect}
        disabled={action.disabled}
        variant={action.destructive ? "destructive" : "default"}
        className={action.selected ? "font-medium" : undefined}
      >
        {action.icon}
        {action.label}
      </ContextMenuItem>
    ),
  );
}

// Read when the drawer opens; registering rendered media never causes a rerender.
export const TaskMediaActionsContext = createContext<Map<
  string,
  TaskMenuAction
> | null>(null);
export function useTaskMediaActions(
  label: string | undefined,
  actions: TaskMenuAction[],
  imagePreview?: string,
) {
  const registry = useContext(TaskMediaActionsContext);
  const id = useId();
  useEffect(() => {
    if (label && actions.length)
      registry?.set(id, { label, children: actions, imagePreview });
    return () => {
      registry?.delete(id);
    };
  }, [registry, id, label, actions, imagePreview]);
}
