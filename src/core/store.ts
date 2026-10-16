import { DatabaseSync } from "node:sqlite";
import type { TaskRecord } from "../shared/types";
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, record TEXT NOT NULL, sealed TEXT); CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);",
    );
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
    this.db
      .prepare(
        "INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,sealed=coalesce(excluded.sealed,tasks.sealed)",
      )
      .run(task.id, JSON.stringify(task), sealed ?? null);
  }
  list(): TaskRecord[] {
    return this.db
      .prepare(
        "SELECT record FROM tasks ORDER BY json_extract(record,'$.updatedAt') DESC",
      )
      .all()
      .map((r) => JSON.parse(String(r.record)));
  }
  sealed(id: string): string | undefined {
    const r = this.db.prepare("SELECT sealed FROM tasks WHERE id=?").get(id);
    return r?.sealed ? String(r.sealed) : undefined;
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
