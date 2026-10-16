/** Window event (detail: task ID) asking that task's row to open its editor. */
export const EDIT_TASK_EVENT = "tasker:edit-task";

export interface NavigateOptions {
  /** Open the task's editor once it is shown. */
  edit?: boolean;
}
