import type { ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  KeyboardSensor,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { VerticalPointerSensor } from "../lib/vertical-pointer-sensor.js";
import type { useTaskerStore } from "../hooks/use-tasker-store.js";
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
    if (from.startsWith("list::") && to.startsWith("list::")) {
      const a = store.lists.indexOf(from.slice(6)),
        b = store.lists.indexOf(to.slice(6));
      if (a >= 0 && b >= 0) void store.reorderList(from.slice(6), b, a);
    } else {
      const task = store.tasks.find((t) => t.id === from);
      if (!task) return;
      const tasks = store.tasksByList[task.listName] ?? [],
        a = tasks.findIndex((t) => t.id === from),
        b = tasks.findIndex((t) => t.id === to);
      if (a >= 0 && b >= 0) void store.reorderTask(from, b, task.listName, a);
    }
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={end}
    >
      <SortableContext
        items={store.lists.map((n) => "list::" + n)}
        strategy={verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}
