import { _electron } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { command } from "../src/core/process";

// Sample URL comes from public JiJiDown/Tracker issue 3; credentials and media URLs in that issue are not used.
const url = "https://www.bilibili.com/video/BV1J8411F7QG/";
const root = resolve("work/bilibili-flac-verification");
const profile = resolve("work/platform-verification/profile");
await mkdir(root, { recursive: true });
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env))
  if (value !== undefined) env[key] = value;
env.VIDOWN_TEST_DATA = profile;
env.VIDOWN_HEADLESS = "1";
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: resolve("release/win-unpacked/Vidown.exe"),
  args: [],
  env,
});
const page = await app.firstWindow();
let settings;
try {
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  settings = (await page.evaluate(() => window.vidown.snapshot())).settings;
  const asset = await page.evaluate((url) => window.vidown.probe({ url }), url);
  assert(asset.duration && asset.duration < 600, "Use a bounded public sample");
  const audio = asset.tracks.find(
    (t) => t.kind === "audio" && /flac/i.test(t.codec ?? ""),
  );
  assert(
    audio,
    "Sample did not return a FLAC source track; do not substitute AAC",
  );
  const video = asset.tracks
    .filter((t) => t.kind === "video" && /^(avc|h264)/i.test(t.codec ?? ""))
    .sort((a, b) => (a.height ?? 0) - (b.height ?? 0))[0];
  assert(video);
  await writeFile(
    join(root, "formats.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), loginDetected: true, asset },
      null,
      2,
    ),
  );
  await page.evaluate(
    (directory) => window.vidown.settings({ downloadDir: directory }),
    join(root, "downloads"),
  );
  const before = new Set(
    (await page.evaluate(() => window.vidown.snapshot())).tasks.map(
      (t) => t.id,
    ),
  );
  await page.evaluate((input) => window.vidown.download(input), {
    assetId: asset.id,
    trackIds: [video.id, audio.id],
    output: "source" as const,
  });
  const end = Date.now() + 600000;
  let task;
  while (Date.now() < end) {
    task = (await page.evaluate(() => window.vidown.snapshot())).tasks.find(
      (t) => !before.has(t.id),
    );
    if (task?.state === "failed") throw new Error(task.error);
    if (task?.state === "completed") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(task?.state, "completed");
  assert(
    task?.output?.endsWith(".mkv"),
    "FLAC plus video must use a reliable source-quality container",
  );
  await writeFile(
    join(root, "download.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        page: asset.pageUrl,
        video,
        audio,
        task,
      },
      null,
      2,
    ),
  );
  await command(
    process.execPath,
    ["--import", "tsx", "scripts/verify-preservation.ts"],
    {
      env: { VIDOWN_PLATFORM_ROOT: root, VIDOWN_PLATFORM_PROFILE: profile },
      timeout: 600000,
    },
  );
  const preservation = JSON.parse(
    await readFile(join(root, "preservation.json"), "utf8"),
  );
  const previousIds = new Set(
    (await page.evaluate(() => window.vidown.snapshot())).tasks.map(
      (t) => t.id,
    ),
  );
  await page.evaluate((input) => window.vidown.download(input), {
    assetId: asset.id,
    trackIds: [audio.id],
    output: "source" as const,
  });
  let audioTask;
  const audioEnd = Date.now() + 180000;
  while (Date.now() < audioEnd) {
    audioTask = (
      await page.evaluate(() => window.vidown.snapshot())
    ).tasks.find((t) => !previousIds.has(t.id));
    if (audioTask?.state === "failed") throw new Error(audioTask.error);
    if (audioTask?.state === "completed") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(audioTask?.state, "completed");
  assert(audioTask?.output?.endsWith(".flac"));
  const ffmpeg = resolve("resources/tools/ffmpeg.exe");
  const audioHash = (
    await command(ffmpeg, [
      "-v",
      "error",
      "-i",
      audioTask!.output!,
      "-map",
      "0:a:0",
      "-c",
      "copy",
      "-f",
      "hash",
      "-hash",
      "sha256",
      "-",
    ])
  ).trim();
  assert.equal(audioHash, preservation.hashes.sourceAudio);
  await command(
    ffmpeg,
    ["-v", "error", "-xerror", "-i", audioTask!.output!, "-f", "null", "-"],
    { timeout: 180000 },
  );
  await writeFile(
    join(root, "audio-only.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        page: asset.pageUrl,
        status: "passed",
        sourceAudioHash: preservation.hashes.sourceAudio,
        savedAudioHash: audioHash,
        fullAudioDecoded: true,
        audio: preservation.audio,
        duration: preservation.duration,
        scope:
          "Complete real Bilibili FLAC-only download through packaged desktop; source encoded audio hash unchanged, complete decode passed.",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      page: asset.pageUrl,
      duration: asset.duration,
      video: video.label,
      audio: audio.label,
    }),
  );
} finally {
  if (settings)
    await page
      .evaluate((settings) => window.vidown.settings(settings), settings)
      .catch(() => {});
  await app.close();
}
