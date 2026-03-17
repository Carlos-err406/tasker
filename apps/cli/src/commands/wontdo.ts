import { Command } from 'commander';
import type { TaskerDb, UndoManager } from '@tasker/core';
import { TaskStatus, setStatuses, getTaskById } from '@tasker/core';
import * as out from '../output.js';
import { $try } from '../helpers.js';

export function createWontDoCommand(db: TaskerDb, undo: UndoManager): Command {
  return new Command('wontdo')
    .description("Mark tasks as won't do")
    .argument('<taskIds...>', 'The id(s) of the task(s)')
    .action((taskIds: string[]) => $try(() => {
      const oldTasks = taskIds.map(id => getTaskById(db, id)).filter((t): t is NonNullable<typeof t> => t !== null);
      const result = setStatuses(db, taskIds, TaskStatus.WontDo);
      out.printBatchResults(result);

      if (oldTasks.length > 0) {
        undo.beginBatch(`Set ${taskIds.length} task(s) to won't do`);
        for (const old of oldTasks) {
          if (old.status !== TaskStatus.WontDo) {
            undo.recordCommand({
              $type: 'set-status',
              taskId: old.id,
              oldStatus: old.status,
              newStatus: TaskStatus.WontDo,
              executedAt: new Date().toISOString(),
            });
          }
        }
        undo.endBatch();
        undo.saveHistory();
      }
    }));
}
