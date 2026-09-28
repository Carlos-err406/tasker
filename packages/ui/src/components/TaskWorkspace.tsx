import { useLayoutEffect, useRef, type Ref } from "react";
import type { useTaskerStore } from "../hooks/use-tasker-store.js";
import { ListSection, type ListSectionHandle } from "./ListSection.js";
import { TaskDragContext } from "./TaskDragContext.js";

export function TaskWorkspace({
  store,
  showMediaPreviews = true,
  mediaPreviewResetSignal = 0,
  showListHeader = true,
  editorRef,
}: {
  store: ReturnType<typeof useTaskerStore>;
  showMediaPreviews?: boolean;
  mediaPreviewResetSignal?: number;
  showListHeader?: boolean;
  editorRef?: Ref<ListSectionHandle>;
}) {
  const name = store.selectedList;
  const root = useRef<HTMLDivElement>(null);
  const previousList = useRef(name);
  useLayoutEffect(() => {
    if (previousList.current !== name) {
      root.current
        ?.querySelector<HTMLButtonElement>(".list-picker")
        ?.focus({ preventScroll: true });
      previousList.current = name;
    }
  }, [name]);
  if (store.loading) return null;
  return (
    <div ref={root}>
      <TaskDragContext store={store}>
        <ListSection
          ref={editorRef}
          showHeader={showListHeader}
          key={name}
          listName={name}
          lists={store.lists}
          tasks={store.tasksByList[name] ?? []}
          relDetails={store.relDetails}
          isDefault={name === store.defaultList}
          searching={!!store.searchQuery}
          onSelectList={store.selectList}
          onReorderList={store.reorderList}
          onEditingChange={store.setIsEditing}
          hideCompleted={store.hideCompletedLists.has(name)}
          onToggleHideCompleted={() => void store.toggleHideCompleted(name)}
          onAddTask={store.addTask}
          onToggleStatus={store.toggleStatus}
          onSetStatus={store.setStatusTo}
          onRename={store.rename}
          onDelete={store.deleteTask}
          onMove={store.moveTask}
          onRenameList={store.renameList}
          onDeleteList={store.deleteList}
          onShowStatus={store.showStatus}
          onNavigateToTask={store.navigateToTask}
          onTagClick={(tag) => store.setSearch("#" + tag)}
          showMediaPreviews={showMediaPreviews}
          mediaPreviewResetSignal={mediaPreviewResetSignal}
        />
      </TaskDragContext>
    </div>
  );
}
