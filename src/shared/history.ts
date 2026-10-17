import type { TaskRecord } from "./types";
export const canRemoveHistory = (task: TaskRecord): boolean =>
  ["completed", "failed", "cancelled", "interrupted"].includes(task.state);
