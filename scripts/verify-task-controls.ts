import { _electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createFixtures } from "./fixtures";
import { Store } from "../src/core/store";
import type { Snapshot } from "../src/shared/types";

const root = resolve("work/task-controls-verification");
const profile = join(root, "profile-" + randomUUID());
await mkdir(root, { recursive: true });
const dir = resolve("resources/tools");
const fixture = await createFixtures(join(root, "fixtures"), {
  ffmpeg: join(dir, "ffmpeg.exe"),
  ffprobe: join(dir, "ffprobe.exe"),
  m3u8: join(dir, "N_m3u8DL-RE.exe"),
  ytdlp: join(dir, "yt-dlp.exe"),
  runtime: process.execPath,
});
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env))
  if (value !== undefined) env[key] = value;
env.VIDOWN_TEST_DATA = profile;
env.VIDOWN_HEADLESS = "1";
delete env.ELECTRON_RUN_AS_NODE;
const options = {
  executablePath: resolve(
    process.env.VIDOWN_VERIFY_EXECUTABLE ||
      "release/win-unpacked/Vidown Preview.exe",
  ),
  args: [],
  env,
};
let app = await _electron.launch(options);
const results: { name: string; status: string }[] = [];
async function until<T>(
  check: () => Promise<T | undefined | false>,
  timeout = 60000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Task control assertion timed out");
}
try {
  let page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  await page.evaluate(
    (downloadDir) => window.vidown.settings({ downloadDir, concurrency: 1 }),
    join(root, "downloads"),
  );
  await page.evaluate(
    (url) => window.vidown.browser({ action: "new", url }),
    fixture.origin + "/login",
  );
  const candidate = await until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).candidates.find(
      (c) => c.protocol === "hls",
    ),
  );
  const asset = await page.evaluate(
    (candidateId) => window.vidown.probe({ candidateId }),
    candidate.id,
  );
  const video = asset.tracks.find((t) => t.kind === "video")!;
  const audio = asset.tracks.find((t) => t.kind === "audio")!;
  assert(video && audio);
  const plan = {
    assetId: asset.id,
    trackIds: [video.id, audio.id],
    output: "source" as const,
  };
  fixture.setSlowSegments(true);
  await page.evaluate((plan) => window.vidown.download(plan), plan);
  const first = await until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).tasks.find(
      (t) => t.networkBytes && t.state === "downloading",
    ),
  );
  await page.evaluate((plan) => window.vidown.download(plan), plan);
  const second = (
    await page.evaluate(() => window.vidown.snapshot())
  ).tasks.find((t) => t.id !== first.id)!;
  assert.equal(second.state, "queued");
  await page.evaluate(
    (id) => window.vidown.task({ id, action: "cancel" }),
    second.id,
  );
  await page.evaluate(
    (id) => window.vidown.task({ id, action: "pause" }),
    first.id,
  );
  const paused = (
    await page.evaluate(() => window.vidown.snapshot())
  ).tasks.find((t) => t.id === first.id)!;
  assert.equal(paused.state, "paused");
  assert(paused.resumable);
  const requests = fixture.requests.length;
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(
    fixture.requests.length,
    requests,
    "Pause must stop actual upstream requests",
  );
  results.push({
    name: "queued-cancel-and-active-pause-stop-real-requests",
    status: "passed",
  });
  await page.evaluate(
    (id) => window.vidown.task({ id, action: "resume" }),
    first.id,
  );
  const completed = await until(async () => {
    const task = (
      await page.evaluate(() => window.vidown.snapshot())
    ).tasks.find((t) => t.id === first.id)!;
    if (task.state === "failed") throw new Error(task.error);
    return task.state === "completed" && task;
  });
  assert((completed.sequence ?? 0) > (paused.sequence ?? 0));
  for (const id of [first.id, second.id])
    await assert.rejects(
      page.evaluate((id) => window.vidown.task({ id, action: "retry" }), id),
      /只有暂停/,
    );
  results.push({
    name: "resume-verifies-complete-media-and-terminal-tasks-cannot-reopen",
    status: "passed",
  });
  await page.evaluate((plan) => window.vidown.download(plan), plan);
  const third = await until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).tasks.find(
      (t) =>
        t.id !== first.id && t.id !== second.id && t.state === "downloading",
    ),
  );
  await page.evaluate(
    (id) => window.vidown.task({ id, action: "pause" }),
    third.id,
  );
  await app.close();
  const database = new Store(join(profile, "vidown.sqlite"));
  const events = database.events(first.id);
  assert.deepEqual(
    events.map((e) => e.state),
    [
      "queued",
      "downloading",
      "paused",
      "queued",
      "downloading",
      "merging",
      "verifying",
      "completed",
    ],
  );
  assert(
    events.every((e, i) => i === 0 || e.sequence > events[i - 1].sequence),
  );
  database.close();
  app = await _electron.launch(options);
  page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  const restarted: Snapshot = await page.evaluate(() =>
    window.vidown.snapshot(),
  );
  const unavailable = restarted.tasks.find((t) => t.id === third.id)!;
  assert.equal(unavailable.state, "paused");
  assert.equal(unavailable.resumable, false);
  await page.getByRole("button", { name: "下载记录", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "继续", exact: true }).count(),
    0,
  );
  await assert.rejects(
    page.evaluate(
      (id) => window.vidown.task({ id, action: "resume" }),
      third.id,
    ),
    /重新探测/,
  );
  results.push({
    name: "phase-events-persist-in-order-and-restart-does-not-offer-false-resume",
    status: "passed",
  });
} finally {
  await app.close().catch(() => {});
  await fixture.close();
  await writeFile(
    join(root, "report.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), packaged: true, results },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify(results, null, 2));
