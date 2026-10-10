import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  Plus,
  Settings,
  ArrowUpDown,
  Ellipsis,
  Search,
  Undo2,
  Redo2,
  Trash2,
  Check,
  X,
  CircleHelp,
} from "lucide-react";
import {
  useTaskerStore,
  TaskWorkspace,
  ListPicker,
  type ListSectionHandle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  TooltipProvider,
  Button,
  Input,
  TrashPanel,
  HelpPanel,
  BackupsPanel,
  SettingsPanel,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  usePullToRefresh,
  PullToRefreshIndicator,
  syncAndRefresh,
  listLabel,
} from "@tasker/ui";
import { manageSync } from "./sync";
import { About } from "./About";
import { SyncIndicator } from "./SyncIndicator";
import { manageBackups } from "./backups";
import { connectAndroidHost } from "./host";
import { getHost } from "@tasker/ui/host";
import type { SettingKey } from "@tasker/core/queries";
import "@tasker/ui/styles.css";
import "./mobile.css";

function App() {
  const store = useTaskerStore();
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    const preview = (event: Event) =>
      setImage((event as CustomEvent<string>).detail);
    window.addEventListener("tasker:previewImage", preview);
    return () => window.removeEventListener("tasker:previewImage", preview);
  }, []);
  useEffect(() => {
    void manageSync({ action: "sync-editing", editing: store.isEditing }).catch(
      () => {},
    );
  }, [store.isEditing]);
  const search = store.searchQuery;
  const setSearch = store.setSearch;
  const [searchOpen, setSearchOpen] = useState(false);
  const searchShown = searchOpen || !!search;
  const closeSearch = () => {
    setSearch("");
    setSearchOpen(false);
  };
  const [panel, setPanel] = useState<
    "tasks" | "trash" | "help" | "settings" | "backups" | "about"
  >("tasks");
  const [listAction, setListAction] = useState<"create" | "rename" | null>(
    null,
  );
  const [listBusy, setListBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const taskEditor = useRef<ListSectionHandle>(null);
  const [addRequested, setAddRequested] = useState(false);
  const showMedia = store.settings.mediaPreviews;
  const [mediaReset, setMediaReset] = useState(0);
  const changeSetting = (key: SettingKey, value: boolean) => {
    if (key === "mediaPreviews") setMediaReset((v) => v + 1);
    void store.setSetting(key, value);
  };
  const controlsDisabled =
    store.loading || store.isEditing || !!listAction || backupBusy;
  const workspace = useRef<HTMLDivElement>(null);
  const pull = usePullToRefresh(
    workspace,
    () => syncAndRefresh(manageSync, store.showStatus, () => store.refresh()),
    panel === "tasks" && !controlsDisabled,
  );
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
  const previousListAction = useRef(listAction);
  useEffect(() => {
    if (previousListAction.current && !listAction)
      document.querySelector<HTMLButtonElement>(".mobile-list-picker")?.focus();
    previousListAction.current = listAction;
  }, [listAction]);
  const [listName, setListName] = useState("");
  useEffect(() => {
    window.taskerBack = () => {
      if (backupBusy) return true;
      if (panel !== "tasks") {
        setPanel(
          panel === "about" ? "help" : panel === "backups" ? "settings" : "tasks",
        );
        return true;
      }
      if (listAction) {
        if (!listBusy) setListAction(null);
        return true;
      }
      if (searchShown) {
        closeSearch();
        return true;
      }
      return false;
    };
    return () => {
      delete window.taskerBack;
    };
  }, [panel, listAction, listBusy, backupBusy, searchShown]);
  return (
    <TooltipProvider>
      <main className="mobile-shell" aria-label="Tasker">
        {panel === "tasks" ? (
          <>
            <header className="mobile-top-bar">
              <div className="mobile-title">
                <ListPicker
                  className="mobile-list-picker"
                  side="bottom"
                  lists={store.lists}
                  selected={store.selectedList}
                  defaultList={store.defaultList}
                  disabled={controlsDisabled}
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
                <div className="mobile-status">
                  <span role="status">
                    {store.statusMessage || `${store.pendingCount} pending`}
                  </span>
                  <SyncIndicator />
                </div>
              </div>
              <nav className="mobile-app-controls" aria-label="App controls">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Search"
                  aria-pressed={searchShown}
                  onClick={() => (searchShown ? closeSearch() : setSearchOpen(true))}
                >
                  <Search />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="App options"
                      disabled={controlsDisabled}
                    >
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    side="bottom"
                    collisionPadding={8}
                  >
                    <DropdownMenuItem onSelect={() => void store.undo()}>
                      <Undo2 />
                      Undo
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void store.redo()}>
                      <Redo2 />
                      Redo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        setPanel("tasks");
                        void store.applySystemSort();
                      }}
                    >
                      <ArrowUpDown /> System sort
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setPanel("trash")}>
                      <Trash2 /> View trash
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPanel("settings")}>
                      <Settings /> Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPanel("help")}>
                      <CircleHelp /> View help
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </nav>
            </header>
            {searchShown && (
              <div className="mobile-search">
                <Search aria-hidden="true" />
                <Input
                  autoFocus={!search}
                  aria-label="Search tasks"
                  placeholder={`Search ${listLabel(store.selectedList)}…`}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close search"
                  onClick={closeSearch}
                >
                  <X />
                </Button>
              </div>
            )}
            {listAction && (
              <form
                className="mobile-create-list"
                onSubmit={async (e) => {
                  e.preventDefault();
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
                      setListAction(null);
                      setListName("");
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
                  placeholder="List name"
                  value={listName}
                  disabled={listBusy}
                  onChange={(e) => setListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!listBusy) setListAction(null);
                    }
                  }}
                />
                <Button
                  type="submit"
                  aria-label="Save list"
                  disabled={listBusy || !listName.trim()}
                >
                  <Check />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Cancel list"
                  disabled={listBusy}
                  onClick={() => setListAction(null)}
                >
                  <X />
                </Button>
              </form>
            )}
            <div
              ref={workspace}
              className="mobile-workspace mobile-tasks"
              aria-busy={store.loading}
            >
              <PullToRefreshIndicator {...pull} />
              <TaskWorkspace
                store={store}
                showListHeader={false}
                editorRef={taskEditor}
                showMediaPreviews={showMedia}
                mediaPreviewResetSignal={mediaReset}
              />
            </div>
          </>
        ) : panel === "trash" ? (
          <div className="mobile-workspace">
            <TrashPanel
              onClose={() => setPanel("tasks")}
              onRefresh={() => void store.refresh()}
              onShowStatus={store.showStatus}
            />
          </div>
        ) : panel === "about" ? (
          <div className="mobile-workspace mobile-backups">
            <About onClose={() => setPanel("help")} />
          </div>
        ) : panel === "settings" ? (
          <div className="mobile-workspace mobile-backups">
            <SettingsPanel
              settings={store.settings}
              onChange={changeSetting}
              onOpenBackups={() => setPanel("backups")}
              onClose={() => setPanel("tasks")}
              notifications={!!getHost().notifications}
              touch
            />
          </div>
        ) : panel === "backups" ? (
          <div className="mobile-workspace mobile-backups">
            <BackupsPanel
              manage={manageBackups}
              manageSync={manageSync}
              deviceName="phone"
              onBusyChange={setBackupBusy}
              onClose={() => setPanel("settings")}
              onRestored={async () => {
                setMediaReset((v) => v + 1);
                await store.refresh();
              }}
            />
          </div>
        ) : (
          <div className="mobile-workspace mobile-help">
            <HelpPanel
              onClose={() => setPanel("tasks")}
              onAbout={() => setPanel("about")}
              touch
            />
          </div>
        )}
        {panel === "tasks" && (
          <Button
            className="mobile-fab"
            size="icon"
            aria-label="Add task"
            disabled={controlsDisabled}
            onClick={() => {
              setPanel("tasks");
              setAddRequested(true);
            }}
          >
            <Plus />
          </Button>
        )}
        <Dialog
          open={!!image}
          onOpenChange={(open) => {
            if (!open) setImage(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Image</DialogTitle>
              <DialogDescription>Stored on this phone.</DialogDescription>
            </DialogHeader>
            {image && (
              <img
                src={image}
                alt="Task attachment"
                style={{
                  maxHeight: "70dvh",
                  objectFit: "contain",
                  width: "100%",
                }}
              />
            )}
          </DialogContent>
        </Dialog>
        {store.isEditing &&
          store.statusMessage.startsWith("Error:") &&
          createPortal(
            <div role="alert" className="mobile-editor-error">
              {store.statusMessage}
            </div>,
            document.body,
          )}
      </main>
    </TooltipProvider>
  );
}
try {
  connectAndroidHost();
  createRoot(document.getElementById("root")!).render(<App />);
} catch (error) {
  document.getElementById("root")!.textContent =
    `Tasker could not start: ${String(error)}`;
}
