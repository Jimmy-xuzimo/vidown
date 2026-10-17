import { DatabaseSync } from "node:sqlite";
import type { TaskRecord, TaskEvent } from "../shared/types";
import { assertTaskTransition } from "./tasks";
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    const version = Number(
      this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0,
    );
    if (version > 1) {
      this.db.close();
      throw new Error("任务数据库来自较新版本，请使用对应新版应用打开。");
    }
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, record TEXT NOT NULL, sealed TEXT);
        CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_events(task_id TEXT NOT NULL, sequence INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(task_id,sequence));
        PRAGMA user_version=1;
        COMMIT;
      `);
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.db.close();
      throw error;
    }
    for (const task of this.list())
      if (
        ["queued", "downloading", "merging", "verifying"].includes(task.state)
      )
        this.put({
          ...task,
          state: "interrupted",
          error: "应用曾中断；请重新探测以确认会话和源轨道。",
          updatedAt: Date.now(),
        });
  }
  put(task: TaskRecord, sealed?: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get(task.id);
      if (previous) assertTaskTransition(previous.state, task.state);
      const sequence = (previous?.sequence ?? 0) + 1;
      const record = { ...task, sequence };
      this.db
        .prepare(
          "INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,sealed=coalesce(excluded.sealed,tasks.sealed)",
        )
        .run(task.id, JSON.stringify(record), sealed ?? null);
      const event: TaskEvent = {
        taskId: task.id,
        sequence,
        state: task.state,
        progress: task.progress,
        bytes: task.bytes,
        message: task.error,
      };
      // Retain phase transitions, not every speed tick. The record revision still advances on every write.
      if (!previous || previous.state !== task.state)
        this.db
          .prepare("INSERT INTO task_events VALUES(?,?,?)")
          .run(task.id, sequence, JSON.stringify(event));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  events(id: string): TaskEvent[] {
    return this.db
      .prepare(
        "SELECT event FROM task_events WHERE task_id=? ORDER BY sequence",
      )
      .all(id)
      .map((r) => JSON.parse(String(r.event)));
  }
  list(): TaskRecord[] {
    return this.db
      .prepare(
        "SELECT record FROM tasks ORDER BY json_extract(record,'$.updatedAt') DESC",
      )
      .all()
      .map((r) => JSON.parse(String(r.record)));
  }
  get(id: string): TaskRecord | undefined {
    const row = this.db.prepare("SELECT record FROM tasks WHERE id=?").get(id);
    return row ? JSON.parse(String(row.record)) : undefined;
  }
  sealed(id: string): string | undefined {
    const r = this.db.prepare("SELECT sealed FROM tasks WHERE id=?").get(id);
    return r?.sealed ? String(r.sealed) : undefined;
  }
  forgetPlans(): void {
    this.db.exec(
      "UPDATE tasks SET sealed=NULL, record=json_set(record,'$.resumable',json('false'))",
    );
  }
  remove(id: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
      this.db.prepare("DELETE FROM tasks WHERE id=?").run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  settings(): any {
    return JSON.parse(
      String(
        this.db.prepare("SELECT value FROM settings WHERE id=1").get()?.value ??
          "{}",
      ),
    );
  }
  saveSettings(value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(value));
  }
  close(): void {
    this.db.close();
  }
}
