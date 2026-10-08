import type { ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  KeyboardSensor,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { VerticalPointerSensor } from "../lib/vertical-pointer-sensor.js";
import type { useTaskerStore } from "../hooks/use-tasker-store.js";
import { ALL_LISTS } from "../lib/all-lists.js";
export function TaskDragContext({
  store,
  children,
}: {
  store: ReturnType<typeof useTaskerStore>;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(VerticalPointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function end({ active, over }: DragEndEvent) {
    if (!over || over.id === active.id) return;
    const from = String(active.id),
      to = String(over.id);
    const task = store.tasks.find((t) => t.id === from);
    if (!task) return;
    if (store.selectedList === ALL_LISTS) {
      const all = store.tasksByList[ALL_LISTS] ?? [],
        target = all.findIndex((t) => t.id === to);
      if (target >= 0) void store.reorderAllListsTask(from, target);
      return;
    }
    const tasks = store.tasksByList[task.listName] ?? [],
      a = tasks.findIndex((t) => t.id === from),
      b = tasks.findIndex((t) => t.id === to);
    if (a >= 0 && b >= 0) void store.reorderTask(from, b, task.listName, a);
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={end}
    >
      {children}
    </DndContext>
  );
}
