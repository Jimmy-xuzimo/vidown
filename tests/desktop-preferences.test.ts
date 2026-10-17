import { it, expect } from "vitest";
import { completeAddress } from "../src/shared/address";
import { canRemoveHistory } from "../src/shared/history";
import { Store } from "../src/core/store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("completes web addresses while preserving explicit protocols, queries and local development ports", () => {
  expect(completeAddress(" bilibili.com/video/BV1?a=2#part ")).toBe(
    "https://bilibili.com/video/BV1?a=2#part",
  );
  expect(completeAddress("http://example.com/v")).toBe("http://example.com/v");
  expect(completeAddress("localhost:8080/player")).toBe(
    "http://localhost:8080/player",
  );
  expect(completeAddress("127.0.0.1:2000")).toBe("http://127.0.0.1:2000/");
  expect(completeAddress("[::1]:8080")).toBe("http://[::1]:8080/");
  expect(completeAddress("example.com:8080")).toBe("https://example.com:8080/");
  for (const v of [
    "javascript:alert(1)",
    "file:///C:/test",
    "data:text/html,test",
    "https://user:password@example.com/",
    "hello world",
    "",
  ])
    expect(() => completeAddress(v)).toThrow();
});
it("removes a record, its private plan and phase history atomically without touching other tasks or settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "vidown-history-"));
  try {
    const file = join(dir, "tasks.sqlite");
    let store = new Store(file);
    store.saveSettings({ theme: "jade" });
    for (const id of ["removed", "kept"])
      store.put(
        { id, title: id, state: "completed", updatedAt: 1, resumable: false },
        "private-plan",
      );
    store.remove("removed");
    expect(store.get("removed")).toBeUndefined();
    expect(store.events("removed")).toEqual([]);
    expect(store.sealed("removed")).toBeUndefined();
    expect(store.get("kept")).toBeDefined();
    store.close();
    store = new Store(file);
    expect(store.list()).toHaveLength(1);
    expect(store.settings().theme).toBe("jade");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("protects queued, active and paused downloads from history clearing", () => {
  for (const state of [
    "queued",
    "downloading",
    "paused",
    "merging",
    "verifying",
  ] as const)
    expect(
      canRemoveHistory({
        id: state,
        title: state,
        state,
        updatedAt: 1,
        resumable: true,
      }),
    ).toBe(false);
  for (const state of [
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ] as const)
    expect(
      canRemoveHistory({
        id: state,
        title: state,
        state,
        updatedAt: 1,
        resumable: false,
      }),
    ).toBe(true);
});
