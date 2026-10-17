import type { TaskState } from "../shared/types";

const transitions: Record<TaskState, readonly TaskState[]> = {
  queued: ["downloading", "paused", "cancelled", "failed", "interrupted"],
  downloading: [
    "merging",
    "verifying",
    "paused",
    "cancelled",
    "failed",
    "interrupted",
  ],
  merging: ["verifying", "paused", "cancelled", "failed", "interrupted"],
  verifying: ["completed", "paused", "cancelled", "failed", "interrupted"],
  paused: ["queued", "cancelled", "interrupted"],
  failed: ["queued", "paused", "cancelled"],
  interrupted: ["queued", "paused", "cancelled"],
  cancelled: [],
  completed: [],
};

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (from !== to && !transitions[from]?.includes(to))
    throw new Error(`无效任务状态变化：${from} → ${to}`);
}
