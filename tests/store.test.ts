import { it, expect } from "vitest";
import { Store } from "../src/core/store";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
it("persists completed tasks but marks abandoned active work as interrupted", () => {
  const dir = mkdtempSync(join(tmpdir(), "vidown-store-")),
    file = join(dir, "test.sqlite");
  try {
    let s = new Store(file);
    s.put(
      {
        id: "a",
        title: "high quality",
        state: "downloading",
        updatedAt: 1,
        resumable: true,
      },
      "sealed-secret",
    );
    s.put({
      id: "b",
      title: "done",
      state: "completed",
      updatedAt: 2,
      resumable: false,
      output: "file.mp4",
    });
    s.close();
    s = new Store(file);
    expect(s.list().find((t) => t.id === "a")?.state).toBe("interrupted");
    expect(s.list().find((t) => t.id === "b")?.state).toBe("completed");
    expect(s.sealed("a")).toBe("sealed-secret");
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
