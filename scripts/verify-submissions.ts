import { _electron } from "playwright";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createFixtures } from "./fixtures";
const root = resolve(
  process.env.VIDOWN_VERIFY_REPORT_DIR || "work/submission-verification",
);
await mkdir(root, { recursive: true });
const exe = process.platform === "win32" ? ".exe" : "";
const dir = resolve("resources/tools");
const fixture = await createFixtures(join(root, "fixtures"), {
  ffmpeg: join(dir, "ffmpeg" + exe),
  ffprobe: join(dir, "ffprobe" + exe),
  ytdlp: join(dir, "yt-dlp" + exe),
  m3u8: join(dir, "N_m3u8DL-RE" + exe),
  runtime: process.execPath,
});
const env: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ),
  VIDOWN_TEST_DATA: join(root, "profile-" + randomUUID()),
  VIDOWN_HEADLESS: "1",
  VIDOWN_BROWSER_BACKEND: process.env.VIDOWN_BROWSER_BACKEND || "chromium",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  ...(process.env.VIDOWN_VERIFY_EXECUTABLE
    ? {
        executablePath: resolve(process.env.VIDOWN_VERIFY_EXECUTABLE),
        args: [],
      }
    : { args: ["."] }),
  cwd: resolve("."),
  env,
  timeout: 60000,
});
const errors: string[] = [];
async function until<T>(
  check: () => Promise<T>,
  timeout = 90000,
): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result as NonNullable<T>;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("Submission integration timed out");
}
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  await page.evaluate(
    (dir) => window.vidown.settings({ downloadDir: dir, concurrency: 2 }),
    join(root, "downloads"),
  );
  await page.evaluate(
    (url) => window.vidown.browser({ action: "new", url }),
    fixture.origin + "/login",
  );
  await until(
    async () =>
      (await page.evaluate(() => window.vidown.snapshot())).candidates.length >
      0,
  );
  const urls = [
    fixture.origin + "/auth/master.m3u8",
    fixture.origin + "/auth/direct.mp4",
    fixture.origin + "/auth/missing.mp4",
    fixture.origin + "/auth/direct.mp4",
  ];
  await page.getByLabel("视频链接", { exact: true }).fill(urls.join("\n"));
  await page.getByRole("button", { name: "解析并下载", exact: true }).click();
  const snapshot = await until(async () => {
    const s = await page.evaluate(() => window.vidown.snapshot());
    return s.submissions?.length === 3 &&
      s.submissions.every((i) =>
        ["queued", "failed", "selection"].includes(i.state),
      )
      ? s
      : undefined;
  });
  assert.equal(
    snapshot.submissions!.filter((i) => i.state === "queued").length,
    2,
  );
  const failed = snapshot.submissions!.find((i) => i.state === "failed")!;
  assert(failed);
  const completed = await until(async () => {
    const s = await page.evaluate(() => window.vidown.snapshot());
    return s.tasks.filter((t) => t.state === "completed").length === 2
      ? s
      : undefined;
  });
  assert(completed.tasks.every((t) => !!t.output));
  await page.evaluate(
    (id) => window.vidown.submission({ id, action: "retry" }),
    failed.id,
  );
  await until(
    async () =>
      (await page.evaluate(() => window.vidown.snapshot())).submissions!.find(
        (i) => i.id === failed.id,
      )?.state === "failed",
  );
  assert.equal(
    (await page.evaluate(() => window.vidown.snapshot())).tasks.length,
    2,
  );
  fixture.setSlow(true);
  await page.evaluate(async (url) => {
    const a = await window.vidown.probe({ url });
    const input = {
      assetId: a.id,
      trackIds: [a.tracks[0].id],
      output: "source" as const,
    };
    await Promise.all([
      window.vidown.download(input),
      window.vidown.download(input),
    ]);
  }, urls[1]);
  const afterDuplicate = await page.evaluate(() => window.vidown.snapshot());
  assert.equal(afterDuplicate.tasks.length, 3);
  await until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).tasks.every(
      (t) => t.state === "completed",
    ),
  );
  // A replayed submission request must not duplicate records even after completion.
  const request = { requestId: randomUUID(), urls: [urls[2]] };
  await page.evaluate(async (input) => {
    await window.vidown.submit(input);
    await window.vidown.submit(input);
  }, request);
  await until(
    async () =>
      (await page.evaluate(() => window.vidown.snapshot())).submissions!
        .length === 4,
  );
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(root, "workbench.png") });
  await writeFile(
    join(root, "summary.json"),
    JSON.stringify(
      {
        passed: true,
        backend: (await page.evaluate(() => window.vidown.snapshot())).tools
          .browser,
        checks: [
          "one-click-ui-multiple-links",
          "input-deduplication",
          "partial-failure-isolation",
          "real-hls-and-direct-completed-with-verification",
          "retry-only-failed",
          "concurrent-manual-enqueue-deduplication",
          "request-replay-idempotency",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Submission desktop integration passed: 7 checks with real controlled downloads.",
  );
} finally {
  await app.close();
  await fixture.close();
}
