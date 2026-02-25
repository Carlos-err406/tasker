import { forwardRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, TaskStatus } from '@tasker/core/types';
import type { TaskRelDetails } from '@/hooks/use-tasker-store.js';
import { ListSection, type ListSectionHandle } from './ListSection.js';

interface SortableListSectionProps {
  listName: string;
  tasks: Task[];
  lists: string[];
  relDetails: Record<string, TaskRelDetails>;
  isDefault: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAddTask: (description: string, listName: string) => void;
  onToggleStatus: (taskId: string, currentStatus: TaskStatus) => void;
  onSetStatus: (taskId: string, status: TaskStatus) => void;
  onRename: (taskId: string, newDescription: string) => void;
  onDelete: (taskId: string, cascade?: boolean) => void;
  onMove: (taskId: string, targetList: string) => void;
  onRenameList: (oldName: string, newName: string) => void;
  onDeleteList: (name: string) => void;
  onShowStatus: (message: string) => void;
  onNavigateToTask: (taskId: string) => void;
  onDecompose?: (taskId: string) => void;
  onSummary?: (listName: string, timeRange: string) => void;
  lmStudioAvailable?: boolean;
  onTagClick?: (tag: string) => void;
  hideCompleted: boolean;
  onToggleHideCompleted: () => void;
}

export type { ListSectionHandle as SortableListSectionHandle };

export const SortableListSection = forwardRef<ListSectionHandle, SortableListSectionProps>(
  function SortableListSection({ listName, ...rest }, ref) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: `list::${listName}` });

    const style = {
      transform: CSS.Translate.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
      // Only hint willChange during active drags — a permanent willChange creates a new
      // stacking context that puts the next section's sticky header on top of dropdowns.
      willChange: transform ? 'transform' : undefined,
    };

    return (
      <div ref={setNodeRef} style={style}>
        <ListSection
          ref={ref}
          listName={listName}
          dragHandleListeners={listeners}
          dragHandleAttributes={attributes}
          {...rest}
        />
      </div>
    );
  }
);
