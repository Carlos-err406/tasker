import { useState, useEffect, useCallback } from 'react';
import type { Task } from '@tasker/core/types';
import { Undo2, Trash2, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { getDisplayTitle } from '@/lib/task-display.js';
import * as taskService from '@/lib/services/tasks.js';
import { Button } from '@/components/ui/button.js';

interface TrashPanelProps {
  onClose: () => void;
  onShowStatus: (message: string) => void;
  onRefresh: () => void;
}

export function TrashPanel({ onClose, onShowStatus, onRefresh }: TrashPanelProps) {
  const [trashedTasks, setTrashedTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTrash = useCallback(async () => {
    try {
      const items = await taskService.getTrash();
      setTrashedTasks(items);
    } catch (err) {
      onShowStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [onShowStatus]);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const handleRestore = async (taskId: string) => {
    try {
      await taskService.restoreTask(taskId);
      onShowStatus('Restored');
      onRefresh();
      await loadTrash();
    } catch (err) {
      onShowStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleClearTrash = async () => {
    try {
      const count = await taskService.clearTrash();
      onShowStatus(`Permanently deleted ${count} task${count !== 1 ? 's' : ''}`);
      onRefresh();
      await loadTrash();
    } catch (err) {
      onShowStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex flex-col h-full" data-testid="trash-panel">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary/20 border-b border-border/50">
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Trash2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Trash</span>
        <span className="text-[10px] text-muted-foreground">{trashedTasks.length} item{trashedTasks.length !== 1 ? 's' : ''}</span>
        {trashedTasks.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            className="text-destructive hover:text-destructive text-[10px]"
            onClick={handleClearTrash}
          >
            Empty trash
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Loading...
          </div>
        ) : trashedTasks.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Trash is empty
          </div>
        ) : (
          trashedTasks.map((task) => (
            <div
              key={task.id}
              data-testid={`trash-item-${task.id.slice(0, 3)}`}
              className="flex items-start gap-2 px-3 py-2 hover:bg-accent/50 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-muted-foreground line-through truncate">
                  {getDisplayTitle(task)}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 mt-0.5">
                  <span>{task.listName}</span>
                  <span>{task.id.slice(0, 3)}</span>
                </div>
              </div>
              <button
                onClick={() => handleRestore(task.id)}
                className={cn(
                  'flex-shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
                  'opacity-0 group-hover:opacity-100',
                )}
                title="Restore"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
