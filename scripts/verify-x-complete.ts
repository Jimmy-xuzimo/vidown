import { _electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { command } from "../src/core/process";

// Public, short sample listed in yt-dlp's Twitter extractor tests. Never reuse a login profile.
const url =
  process.env.VIDOWN_X_SAMPLE ||
  "https://x.com/CaptainAmerica/status/719944021058060289";
const root = resolve("work/x-complete-verification");
const profile = join(root, "profile-" + randomUUID());
await mkdir(root, { recursive: true });
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env))
  if (value !== undefined) env[key] = value;
env.VIDOWN_TEST_DATA = profile;
env.VIDOWN_HEADLESS = "1";
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: resolve(
    process.env.VIDOWN_VERIFY_EXECUTABLE ||
      "release/win-unpacked/Vidown Preview.exe",
  ),
  args: [],
  env,
});
const page = await app.firstWindow();
try {
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  const asset = await page.evaluate((url) => window.vidown.probe({ url }), url);
  assert(
    asset.duration && asset.duration > 0 && asset.duration <= 90,
    "Only bounded, short samples may be downloaded by this verification",
  );
  const separateVideo = asset.tracks.find(
    (t) => t.kind === "video" && t.protocol === "hls",
  );
  const audio = asset.tracks
    .filter((t) => t.kind === "audio")
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  const video =
    separateVideo && audio
      ? separateVideo
      : asset.tracks.find((t) => t.kind === "muxed" && t.protocol === "hls") ||
        asset.tracks.find((t) => t.kind === "muxed");
  assert(video, "No executable source video");
  const selectedAudio = video.kind === "video" ? audio : undefined;
  await writeFile(
    join(root, "formats.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), loginDetected: false, asset },
      null,
      2,
    ),
  );
  await page.evaluate(
    (directory) => window.vidown.settings({ downloadDir: directory }),
    join(root, "downloads"),
  );
  await page.evaluate((input) => window.vidown.download(input), {
    assetId: asset.id,
    trackIds: [video.id, ...(selectedAudio ? [selectedAudio.id] : [])],
    output: "source" as const,
  });
  let task;
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    task = (await page.evaluate(() => window.vidown.snapshot())).tasks[0];
    if (task?.state === "failed") throw new Error(task.error);
    if (task?.state === "completed") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(task?.state, "completed");
  await writeFile(
    join(root, "download.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        page: asset.pageUrl,
        video,
        audio: selectedAudio,
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
      timeout: 180000,
    },
  );
  await command(
    resolve("resources/tools/ffmpeg.exe"),
    [
      "-v",
      "error",
      "-xerror",
      "-i",
      task!.output!,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-f",
      "null",
      "-",
    ],
    { timeout: 180000 },
  );
  await writeFile(
    join(root, "report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        page: asset.pageUrl,
        status: "passed",
        loginRequired: false,
        desktopTracks: [
          video.protocol,
          ...(selectedAudio ? [selectedAudio.protocol] : []),
        ],
        separateAudioTrack: !!selectedAudio,
        taskState: task!.state,
        fullOutputDecoded: true,
        fullBitstreamHashesEqual: true,
        scope:
          "Complete short public X video and audio through packaged desktop, Chromium bridge and N_m3u8DL-RE; no authenticated X claim.",
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
      audio: selectedAudio?.label ?? "in-band audio",
    }),
  );
} finally {
  await app.close();
}
