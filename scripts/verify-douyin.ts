import { _electron } from "playwright";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { command } from "../src/core/process";
import { mediaInfo, type Tools } from "../src/core/engine";

// Opt-in public-site acceptance. Uses an isolated profile, never a user's account.
const backend = process.env.VIDOWN_BROWSER_BACKEND || "webview2";
const root = resolve(
  process.env.VIDOWN_DOUYIN_ROOT || `work/douyin-${backend}-verification`,
);
await mkdir(root, { recursive: true });
const dir = resolve("resources/tools");
const suffix = process.platform === "win32" ? ".exe" : "";
const tools: Tools = {
  ffmpeg: join(dir, "ffmpeg" + suffix),
  ffprobe: join(dir, "ffprobe" + suffix),
  ytdlp: join(dir, "yt-dlp" + suffix),
  m3u8: join(dir, "N_m3u8DL-RE" + suffix),
  runtime: process.execPath,
};
const env: NodeJS.ProcessEnv = {
  ...process.env,
  VIDOWN_BROWSER_BACKEND: backend,
  VIDOWN_TEST_DATA: join(root, "profile-" + randomUUID()),
  VIDOWN_HEADLESS: "1",
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
  env: env as Record<string, string>,
});
const results: any[] = [];
let version: string | undefined;
let succeeded = false;
try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  version = (await page.evaluate(() => window.vidown.snapshot())).version;
  assert.equal(version, "1.0.5", "Acceptance must run the fixed app version");
  await page.evaluate(
    (directory) =>
      window.vidown.settings({ downloadDir: directory, clipboard: false }),
    join(root, "downloads"),
  );
  const userUrl =
    "https://www.douyin.com/jingxuan?modal_id=7666811827413601586";
  await page.getByLabel("视频链接", { exact: true }).fill(userUrl);
  await page.getByRole("button", { name: "探测资源", exact: true }).click();
  await page
    .getByRole("heading", { name: "选择保存规格" })
    .waitFor({ timeout: 45000 });
  assert(
    (
      await page
        .getByLabel("视频轨道", { exact: true })
        .locator("option")
        .allTextContents()
    ).some((v) => v.includes("2160p")),
  );
  const long = await page.evaluate(
    (url) => window.vidown.probe({ url }),
    userUrl,
  );
  assert.equal(
    long.pageUrl,
    "https://www.douyin.com/video/7666811827413601586",
  );
  assert.equal(long.tracks[0].height, 2160);
  assert(!JSON.stringify(long).includes("url_list"));
  await page.screenshot({ path: join(root, "workbench-4k.png") });
  results.push({
    name: "modal-link-workbench-source-formats",
    status: "passed",
    formats: long.tracks.length,
    highest: long.tracks[0].label,
  });
  console.log("Modal link: highest source format resolved");

  // Bound the long sample to 16 MiB and remux five seconds. Do not download 31 minutes.
  const sample = await app.evaluate(async () => {
    const b = (globalThis as any).__vidownBrowser;
    const asset = [...b.douyinAssets.values()].find(
      (x: any) => x.videoId === "7666811827413601586",
    ) as any;
    if (!asset) throw new Error("No browser-captured exact video");
    const source = asset.asset.tracks[0].url;
    const response = await b.session.fetch(source, {
      headers: {
        ...b.headersFor(source, asset.asset.pageUrl),
        Range: "bytes=0-16777215",
      },
      credentials: "include",
      referrerPolicy: "unsafe-url",
      signal: AbortSignal.timeout(45000),
    });
    if (![200, 206].includes(response.status))
      throw new Error("Media HTTP " + response.status);
    const reader = response.body.getReader();
    const parts: Buffer[] = [];
    let bytes = 0;
    try {
      while (bytes < 16777216) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const piece = chunk.value.slice(0, 16777216 - bytes);
        parts.push(Buffer.from(piece));
        bytes += piece.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return {
      base64: Buffer.concat(parts).toString("base64"),
      bytes,
      status: response.status,
    };
  });
  const partial = join(root, "bounded-source.mp4");
  await writeFile(partial, Buffer.from(sample.base64, "base64"));
  const clip = join(root, "source-4k-five-seconds.mp4");
  await command(
    tools.ffmpeg,
    [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-i",
      partial,
      "-t",
      "5",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c",
      "copy",
      clip,
    ],
    { timeout: 45000 },
  );
  const info = await mediaInfo(clip, tools);
  const video = info.streams.find((s: any) => s.codec_type === "video"),
    audio = info.streams.find((s: any) => s.codec_type === "audio");
  assert(video && audio);
  assert.equal(video.width, 3840);
  assert.equal(video.height, 2160);
  assert.equal(video.codec_name, "hevc");
  assert(Number(info.format.duration) > 1 && Number(info.format.duration) < 7);
  results.push({
    name: "user-sample-bounded-real-transfer-and-remux",
    status: "passed",
    networkBytes: sample.bytes,
    http: sample.status,
    video: {
      width: video.width,
      height: video.height,
      codec: video.codec_name,
    },
    audio: { codec: audio.codec_name, sampleRate: audio.sample_rate },
    seconds: Number(info.format.duration),
    fullLongVideoDownloaded: false,
  });
  console.log("4K sample: actual video and audio verified");

  const short = await page.evaluate(() =>
    window.vidown.probe({
      url: "https://www.douyin.com/video/6961737553342991651",
    }),
  );
  assert(short.duration && short.duration < 60);
  await page.evaluate(
    (asset) =>
      window.vidown.download({
        assetId: asset.id,
        trackIds: [asset.tracks[0].id],
        output: "source",
      }),
    short,
  );
  const deadline = Date.now() + 120000;
  let completed: any;
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => window.vidown.snapshot());
    const task = snapshot.tasks.find((t) => t.title === short.title);
    if (task?.state === "failed") throw new Error(task.error);
    if (task?.state === "completed") {
      completed = task;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  assert(completed?.output, "Short-video download did not finish");
  const saved = await mediaInfo(completed.output, tools);
  assert(saved.streams.some((s: any) => s.codec_type === "audio"));
  assert(
    saved.streams.some(
      (s: any) =>
        s.codec_type === "video" && s.height === short.tracks[0].height,
    ),
  );
  assert(Math.abs(Number(saved.format.duration) - short.duration!) < 1);
  results.push({
    name: "short-video-complete-queue-download-remux-verification",
    status: "passed",
    bytes: (await stat(completed.output)).size,
    seconds: Number(saved.format.duration),
  });
  console.log("Short video: actual app task completed and file verified");

  // Exercise extraction from the original query-style browser page as well as pasted links.
  await page.evaluate(
    (url) => window.vidown.browser({ action: "new", url }),
    userUrl,
  );
  const navigationDeadline = Date.now() + 20000;
  let navigated = false;
  while (Date.now() < navigationDeadline) {
    navigated = await app.evaluate(() =>
      ((globalThis as any).__vidownBrowser.currentUrl() ?? "").includes(
        "/jingxuan",
      ),
    );
    if (navigated) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert(navigated, "Query-style page navigation did not commit");
  const current = await page.evaluate(() =>
    window.vidown.probe({ tabId: undefined }),
  );
  assert.equal(current.pageUrl, long.pageUrl);
  assert(current.tracks.some((t) => t.height === 2160));
  const snapshot = await page.evaluate(() => window.vidown.snapshot());
  const tabId = snapshot.activeTab!;
  await page.evaluate(
    (tabId) => window.vidown.browser({ action: "close", tabId }),
    tabId,
  );
  assert.equal(
    await app.evaluate(
      (_, id) => (globalThis as any).__vidownBrowser.douyinAssets.has(id),
      tabId,
    ),
    false,
  );
  await page.evaluate(() =>
    window.vidown.clearData({ browser: true, history: false }),
  );
  await assert.rejects(() =>
    page.evaluate(
      (asset) =>
        window.vidown.download({
          assetId: asset.id,
          trackIds: [asset.tracks[0].id],
          output: "source",
        }),
      long,
    ),
  );
  results.push({
    name: "query-style-current-page-exact-id-and-cleanup-invalidation",
    status: "passed",
  });
  succeeded = true;
} finally {
  await app.close();
  await writeFile(
    join(root, "report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        status: succeeded ? "passed" : "failed",
        version,
        backend,
        packaged: !!process.env.VIDOWN_VERIFY_EXECUTABLE,
        scope:
          "Public videos in an isolated browser; 4K long sample bounded to 16 MiB, short sample fully downloaded; no real-account acceptance",
        results,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify(results, null, 2));
