import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/core/store";
import type { TaskRecord } from "../src/shared/types";

const task = (state: TaskRecord["state"]): TaskRecord => ({
  id: "task",
  title: "sample",
  state,
  updatedAt: Date.now(),
  resumable: true,
});
function database(run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "vidown-lifecycle-"));
  try {
    run(join(dir, "tasks.sqlite"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
it("migrates a legacy database without losing settings or sealed plans and sequences interruption", () =>
  database((path) => {
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE tasks(id TEXT PRIMARY KEY, record TEXT NOT NULL, sealed TEXT); CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);",
    );
    old
      .prepare("INSERT INTO tasks VALUES(?,?,?)")
      .run("task", JSON.stringify(task("downloading")), "protected-plan");
    old
      .prepare("INSERT INTO settings VALUES(1,?)")
      .run(JSON.stringify({ downloadDir: "existing-directory" }));
    old.close();
    let store = new Store(path);
    expect(store.get("task")).toMatchObject({
      state: "interrupted",
      sequence: 1,
    });
    expect(store.sealed("task")).toBe("protected-plan");
    expect(store.settings().downloadDir).toBe("existing-directory");
    store.put(task("queued"));
    store.put(task("downloading"));
    store.put({ ...task("downloading"), bytes: 42 });
    store.put(task("paused"));
    store.close();
    store = new Store(path);
    expect(store.events("task").map((e) => [e.sequence, e.state])).toEqual([
      [1, "interrupted"],
      [2, "queued"],
      [3, "downloading"],
      [5, "paused"],
    ]);
    expect(store.get("task")?.sequence).toBe(5);
    store.close();
  }));
it("rejects stale phase regressions and attempts to reopen completed or cancelled tasks", () =>
  database((path) => {
    const store = new Store(path);
    try {
      store.put(task("queued"));
      store.put(task("downloading"));
      store.put(task("merging"));
      expect(() => store.put(task("downloading"))).toThrow("无效任务状态变化");
      expect(store.get("task")?.sequence).toBe(3);
      store.put(task("verifying"));
      store.put(task("completed"));
      expect(() => store.put(task("queued"))).toThrow();
      store.put({ ...task("cancelled"), id: "cancelled" });
      expect(() => store.put({ ...task("queued"), id: "cancelled" })).toThrow();
      expect(store.events("task").map((e) => e.state)).toEqual([
        "queued",
        "downloading",
        "merging",
        "verifying",
        "completed",
      ]);
    } finally {
      store.close();
    }
  }));
it("rolls back the task and sealed plan if the matching event cannot be persisted", () =>
  database((path) => {
    const store = new Store(path);
    const connection = new DatabaseSync(path);
    try {
      store.put(task("queued"), "original-plan");
      connection.exec(
        "CREATE TRIGGER fail_event BEFORE INSERT ON task_events BEGIN SELECT RAISE(ABORT,'simulated event write failure'); END;",
      );
      expect(() => store.put(task("downloading"), "replacement-plan")).toThrow(
        "simulated event write failure",
      );
      expect(store.get("task")).toMatchObject({ state: "queued", sequence: 1 });
      expect(store.sealed("task")).toBe("original-plan");
      expect(store.events("task")).toHaveLength(1);
    } finally {
      connection.close();
      store.close();
    }
  }));
it("refuses a newer database without rewriting its version", () =>
  database((path) => {
    const future = new DatabaseSync(path);
    future.exec("PRAGMA user_version=99");
    future.close();
    expect(() => new Store(path)).toThrow("较新版本");
    const check = new DatabaseSync(path);
    expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(99);
    check.close();
  }));
