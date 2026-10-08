import { SyncPanel } from "@tasker/ui";
import { manage } from "./host-adapter.js";
import { Backups } from "./Backups.js";
import { About } from "./About.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Eye,
  EyeOff,
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
} from "lucide-react";
import { createRoot } from "react-dom/client";
import {
  ListPicker,
  TaskWorkspace,
  type ListSectionHandle,
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
  useEffect(() => {
    void manage({ action: "sync-editing", editing: store.isEditing }).catch(
      () => {},
    );
  }, [store.isEditing]);
  const [panel, setPanel] = useState<
    "tasks" | "backups" | "trash" | "help" | "sync" | "about"
  >("tasks");
  const [listAction, setListAction] = useState<"create" | "rename" | null>(
    null,
  );
  const [listBusy, setListBusy] = useState(false);
  const taskEditor = useRef<ListSectionHandle>(null);
  const [addRequested, setAddRequested] = useState(false);
  useEffect(() => {
    if (
      addRequested &&
      panel === "tasks" &&
      !store.loading &&
      taskEditor.current
    ) {
      taskEditor.current.startAdding();
      setAddRequested(false);
    }
  }, [addRequested, panel, store.loading]);
  const [listName, setListName] = useState("");
  const previousListAction = useRef(listAction);
  useEffect(() => {
    if (previousListAction.current && !listAction)
      document.querySelector<HTMLButtonElement>(".top-list-picker")?.focus();
    previousListAction.current = listAction;
  }, [listAction]);
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
  const search = store.searchQuery;
  const setSearch = store.setSearch;
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchOnMount = useRef(false);
  const clearSearch = useCallback(() => {
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
      } else if (event.key === "Escape" && panel === "about") {
        event.preventDefault();
        setPanel("help");
      } else if (event.key === "Escape" && panel === "help") {
        event.preventDefault();
        closeHelp();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    panel,
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
          <ListPicker
            className="top-list-picker"
            lists={store.lists}
            selected={store.selectedList}
            defaultList={store.defaultList}
            disabled={store.loading || store.isEditing || !!listAction}
            onSelect={(name) => {
              store.selectList(name);
              setPanel("tasks");
            }}
            onCreate={() => {
              setPanel("tasks");
              setListName("");
              setListAction("create");
            }}
            onRename={() => {
              setPanel("tasks");
              setListName(store.selectedList);
              setListAction("rename");
            }}
            onDelete={() => {
              setPanel("tasks");
              void store.deleteList(store.selectedList);
            }}
          />
          <div className="app-controls" aria-label="App controls">
            <IconButton
              label="Add task"
              disabled={store.loading || store.isEditing || !!listAction}
              onClick={() => {
                setPanel("tasks");
                setAddRequested(true);
              }}
            >
              <Plus />
            </IconButton>
            <IconButton
              label={
                store.hideCompletedLists.has(store.selectedList)
                  ? "Show completed tasks"
                  : "Hide completed tasks"
              }
              aria-pressed={store.hideCompletedLists.has(store.selectedList)}
              disabled={store.loading || store.isEditing || !!listAction}
              onClick={() => {
                setPanel("tasks");
                void store.toggleHideCompleted(store.selectedList);
              }}
            >
              {store.hideCompletedLists.has(store.selectedList) ? (
                <EyeOff />
              ) : (
                <Eye />
              )}
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
              tooltipLabel="View trash"
              aria-pressed={panel === "trash"}
              onClick={() => setPanel("trash")}
            >
              <Trash2 />
            </IconButton>
            <IconButton
              label="Backups"
              tooltipLabel="View backups"
              aria-pressed={panel === "backups"}
              onClick={() => setPanel("backups")}
            >
              <Archive />
            </IconButton>
            <IconButton
              ref={helpButtonRef}
              label="Help"
              tooltipLabel="View help"
              aria-keyshortcuts="Meta+/"
              aria-pressed={panel === "help"}
              onClick={() => setPanel("help")}
            >
              <CircleHelp />
            </IconButton>
          </div>
        </nav>
        <div className="popover-content">
          {panel === "help" ? (
            <HelpPanel onClose={closeHelp} onAbout={() => setPanel("about")} />
          ) : panel === "about" ? (
            <About onClose={() => setPanel("help")} />
          ) : panel === "sync" ? (
            <SyncPanel
              manage={manage}
              onClose={() => setPanel("tasks")}
              onViewBackups={() => setPanel("backups")}
            />
          ) : panel === "backups" ? (
            <Backups
              onViewSync={() => setPanel("sync")}
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
                      placeholder={`Search ${store.selectedList}…`}
                      value={search}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && search) {
                          event.preventDefault();
                          event.stopPropagation();
                          clearSearch();
                        }
                      }}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </TooltipTrigger>
                  <TooltipContent className="search-tooltip pointer-events-none">
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
                {listAction && (
                  <form
                    className="create-list"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (listBusy || !listName.trim()) return;
                      setListBusy(true);
                      try {
                        const saved =
                          listAction === "create"
                            ? await store.createList(listName.trim())
                            : await store.renameList(
                                store.selectedList,
                                listName.trim(),
                              );
                        if (saved) {
                          setListName("");
                          setListAction(null);
                        }
                      } finally {
                        setListBusy(false);
                      }
                    }}
                  >
                    <Input
                      autoFocus
                      aria-label={
                        listAction === "create" ? "New list name" : "List name"
                      }
                      placeholder={
                        listAction === "create"
                          ? "New list name…"
                          : "List name…"
                      }
                      value={listName}
                      onChange={(e) => setListName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          if (listBusy) return;
                          setListAction(null);
                          setListName("");
                        }
                      }}
                    />
                    <IconButton
                      label={
                        listAction === "create" ? "Add list" : "Save list name"
                      }
                      aria-keyshortcuts="Enter"
                      type="submit"
                      disabled={listBusy || !listName.trim()}
                    >
                      <Check />
                    </IconButton>
                    <IconButton
                      label={
                        listAction === "create"
                          ? "Cancel new list"
                          : "Cancel rename"
                      }
                      disabled={listBusy}
                      aria-keyshortcuts="Escape"
                      type="button"
                      onClick={() => {
                        setListAction(null);
                        setListName("");
                      }}
                    >
                      <X />
                    </IconButton>
                  </form>
                )}
                <TaskWorkspace
                  store={store}
                  showListHeader={false}
                  editorRef={taskEditor}
                  showMediaPreviews={showMedia}
                  mediaPreviewResetSignal={mediaReset}
                />
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
