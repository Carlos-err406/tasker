import { Backups } from "./Backups.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Images,
  ImageOff,
  Trash2,
  Archive,
  Undo2,
  Redo2,
  Search,
  X,
  Check,
  CircleHelp,
  ArrowUpDown,
  ChevronsDownUp,
} from "lucide-react";
import { createRoot } from "react-dom/client";
import {
  SortableListSection,
  TaskDragContext,
  useTaskerStore,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Button,
  Input,
  TrashPanel,
  HelpPanel,
  Kbd,
  KbdGroup,
} from "@tasker/ui";
import { connectHost } from "./host-adapter.js";
import "@tasker/ui/styles.css";
import "./popover.css";
function IconButton({
  label,
  tooltipLabel = label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string;
  tooltipLabel?: string;
}) {
  const shortcut = props["aria-keyshortcuts"];
  const keySymbols: Record<string, string> = {
    Meta: "⌘",
    Shift: "⇧",
    Alt: "⌥",
    Control: "⌃",
    Escape: "Esc",
    Enter: "↵",
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="popover-icon"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={4}>
        <span className="flex items-center gap-1.5">
          {tooltipLabel}
          {shortcut && (
            <KbdGroup aria-label={shortcut}>
              {shortcut.split("+").map((key, index) => (
                <Kbd key={index}>{keySymbols[key] ?? key}</Kbd>
              ))}
            </KbdGroup>
          )}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
function App() {
  const store = useTaskerStore();
  const [panel, setPanel] = useState<"tasks" | "backups" | "trash" | "help">(
    "tasks",
  );
  const [creatingList, setCreatingList] = useState(false);
  const [listName, setListName] = useState("");
  const [showMedia, setShowMedia] = useState(
    () => localStorage.getItem("tasker:showMediaPreviews") !== "false",
  );
  const [mediaReset, setMediaReset] = useState(0);
  const togglePreviews = useCallback(() => {
    const next = !showMedia;
    setShowMedia(next);
    setMediaReset((v) => v + 1);
    localStorage.setItem("tasker:showMediaPreviews", String(next));
  }, [showMedia]);
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchOnMount = useRef(false);
  const clearSearch = useCallback(() => {
    clearTimeout(searchTimer.current);
    setSearch("");
    store.setSearch("");
  }, [store.setSearch]);
  useEffect(() => {
    if (panel === "tasks" && focusSearchOnMount.current) {
      focusSearchOnMount.current = false;
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [panel]);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const closeHelp = () => {
    setPanel("tasks");
    helpButtonRef.current?.focus();
  };
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const editing =
        event.target instanceof HTMLElement &&
        !!event.target.closest(
          'input, textarea, [contenteditable="true"], [role="dialog"]',
        );
      const plainCommand =
        event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      const outsideEditor = !editing || event.target === searchRef.current;
      if (plainCommand && outsideEditor && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (panel === "tasks") {
          searchRef.current?.focus();
          searchRef.current?.select();
        } else {
          focusSearchOnMount.current = true;
          setPanel("tasks");
        }
      } else if (
        plainCommand &&
        outsideEditor &&
        event.key.toLowerCase() === "r"
      ) {
        event.preventDefault();
        void store.refresh({ searchQuery: search });
      } else if (
        event.metaKey &&
        !event.altKey &&
        !editing &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        if (event.shiftKey) void store.redo();
        else void store.undo();
      } else if (
        event.metaKey &&
        !event.shiftKey &&
        !event.altKey &&
        !editing &&
        event.key === "e"
      ) {
        event.preventDefault();
        void store.toggleCollapseAll();
      } else if (
        event.metaKey &&
        !event.shiftKey &&
        !event.altKey &&
        !editing &&
        event.key === "j"
      ) {
        event.preventDefault();
        void store.applySystemSort();
      } else if (
        event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !editing &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        togglePreviews();
      } else if (event.metaKey && event.key === "/") {
        event.preventDefault();
        if (panel === "help") closeHelp();
        else setPanel("help");
      } else if (event.key === "Escape" && panel === "help") {
        event.preventDefault();
        closeHelp();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    panel,
    store.toggleCollapseAll,
    store.applySystemSort,
    store.undo,
    store.redo,
    store.refresh,
    search,
    togglePreviews,
  ]);
  return (
    <TooltipProvider delayDuration={400}>
      <main
        className="popover-shell"
        data-testid="tasker-app"
        aria-label="Tasker"
      >
        <nav className="popover-toolbar" aria-label="Task tools">
          <Button
            variant="ghost"
            size="xs"
            className="tasks-tab"
            onClick={() => setPanel("tasks")}
            aria-current={panel === "tasks" ? "page" : undefined}
          >
            Tasks
          </Button>
          <span className="toolbar-spacer" />
          <IconButton
            label="Create list"
            onClick={() => {
              setPanel("tasks");
              setCreatingList(true);
            }}
          >
            <Plus />
          </IconButton>
          <IconButton
            label={
              store.lists.every((name) => store.collapsedLists.has(name))
                ? "Expand all lists"
                : "Collapse all lists"
            }
            aria-keyshortcuts="Meta+E"
            onClick={() => void store.toggleCollapseAll()}
          >
            <ChevronsDownUp />
          </IconButton>
          <IconButton
            label={showMedia ? "Hide previews" : "Show previews"}
            aria-keyshortcuts="Meta+P"
            onClick={togglePreviews}
          >
            {showMedia ? <Images /> : <ImageOff />}
          </IconButton>
          <IconButton
            label="System sort"
            aria-keyshortcuts="Meta+J"
            onClick={() => void store.applySystemSort()}
          >
            <ArrowUpDown />
          </IconButton>
          <IconButton
            label="Trash"
            aria-pressed={panel === "trash"}
            onClick={() => setPanel("trash")}
          >
            <Trash2 />
          </IconButton>
          <IconButton
            label="Backups"
            aria-pressed={panel === "backups"}
            onClick={() => setPanel("backups")}
          >
            <Archive />
          </IconButton>
          <IconButton
            ref={helpButtonRef}
            label="Help"
            tooltipLabel="Toggle help"
            aria-keyshortcuts="Meta+/"
            aria-pressed={panel === "help"}
            onClick={() => (panel === "help" ? closeHelp() : setPanel("help"))}
          >
            <CircleHelp />
          </IconButton>
        </nav>
        <div className="popover-content">
          {panel === "help" ? (
            <HelpPanel onClose={closeHelp} />
          ) : panel === "backups" ? (
            <Backups
              onClose={() => setPanel("tasks")}
              onRestored={() => void store.refresh()}
            />
          ) : panel === "trash" ? (
            <TrashPanel
              onClose={() => setPanel("tasks")}
              onRefresh={() => void store.refresh()}
              onShowStatus={store.showStatus}
            />
          ) : (
            <>
              <div className="search-row">
                <Search aria-hidden="true" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Input
                      ref={searchRef}
                      aria-keyshortcuts="Meta+K"
                      className="search"
                      aria-label="Search tasks"
                      placeholder="Search tasks…"
                      value={search}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && search) {
                          event.preventDefault();
                          event.stopPropagation();
                          clearSearch();
                        }
                      }}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSearch(value);
                        clearTimeout(searchTimer.current);
                        searchTimer.current = setTimeout(
                          () => store.setSearch(value),
                          200,
                        );
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="flex items-center gap-1.5">
                      Focus search{" "}
                      <KbdGroup>
                        <Kbd>⌘</Kbd>
                        <Kbd>K</Kbd>
                      </KbdGroup>
                    </span>
                  </TooltipContent>
                </Tooltip>
                {search && (
                  <IconButton
                    label="Clear search"
                    aria-keyshortcuts="Escape"
                    onClick={clearSearch}
                  >
                    <X />
                  </IconButton>
                )}
              </div>
              <div
                className="task-workspace"
                data-testid="task-workspace"
                aria-busy={store.loading}
              >
                {creatingList && (
                  <form
                    className="create-list"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (listName.trim()) {
                        void store.createList(listName.trim());
                        setListName("");
                        setCreatingList(false);
                      }
                    }}
                  >
                    <Input
                      autoFocus
                      aria-label="New list name"
                      placeholder="New list name…"
                      value={listName}
                      onChange={(e) => setListName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setCreatingList(false);
                          setListName("");
                        }
                      }}
                    />
                    <IconButton
                      label="Add list"
                      aria-keyshortcuts="Enter"
                      type="submit"
                      disabled={!listName.trim()}
                    >
                      <Check />
                    </IconButton>
                    <IconButton
                      label="Cancel new list"
                      aria-keyshortcuts="Escape"
                      type="button"
                      onClick={() => {
                        setCreatingList(false);
                        setListName("");
                      }}
                    >
                      <X />
                    </IconButton>
                  </form>
                )}
                <TaskDragContext store={store}>
                  {/* Mount lists with their saved preferences, never the initial defaults. */}
                  {!store.loading &&
                    store.lists.map((name) => (
                      <SortableListSection
                        key={name}
                        listName={name}
                        tasks={store.tasksByList[name] ?? []}
                        lists={store.lists}
                        relDetails={store.relDetails}
                        isDefault={name === store.defaultList}
                        collapsed={store.collapsedLists.has(name)}
                        hideCompleted={store.hideCompletedLists.has(name)}
                        onToggleCollapsed={() =>
                          void store.toggleCollapsed(name)
                        }
                        onToggleHideCompleted={() =>
                          void store.toggleHideCompleted(name)
                        }
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
                        showMediaPreviews={showMedia}
                        mediaPreviewResetSignal={mediaReset}
                        onTagClick={(tag) => {
                          clearTimeout(searchTimer.current);
                          setSearch("#" + tag);
                          store.setSearch("#" + tag);
                        }}
                      />
                    ))}
                </TaskDragContext>
              </div>
            </>
          )}
        </div>
        <footer className="popover-footer">
          <span role="status" className="status">
            {store.statusMessage || `${store.pendingCount} pending`}
          </span>
          <IconButton
            label="Undo"
            aria-keyshortcuts="Meta+Z"
            onClick={() => void store.undo()}
          >
            <Undo2 />
          </IconButton>
          <IconButton
            label="Redo"
            aria-keyshortcuts="Meta+Shift+Z"
            onClick={() => void store.redo()}
          >
            <Redo2 />
          </IconButton>
        </footer>
      </main>
    </TooltipProvider>
  );
}
connectHost()
  .then(() => createRoot(document.getElementById("root")!).render(<App />))
  .catch((error) => {
    document.getElementById("root")!.textContent = String(error);
  });
