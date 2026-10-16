import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { command } from "../src/core/process";
import { mediaInfo, verifyMedia, type Tools } from "../src/core/engine";

// Bounded follow-up to a deliberately cancelled long-video desktop test.
// Raw extractor data and media stay in ignored work/, never in the evidence bundle.
const root = resolve("work/x-verification");
const { task } = JSON.parse(
  await readFile(join(root, "cancelled-download.json"), "utf8"),
);
assert.equal(task.state, "cancelled");
const { asset, loginDetected } = JSON.parse(
  await readFile(join(root, "formats.json"), "utf8"),
);
const toolDir = resolve("resources/tools");
const tools: Tools = {
  ffmpeg: join(toolDir, "ffmpeg.exe"),
  ffprobe: join(toolDir, "ffprobe.exe"),
  ytdlp: join(toolDir, "yt-dlp.exe"),
  m3u8: join(toolDir, "N_m3u8DL-RE.exe"),
  runtime: process.execPath,
};
const parts = join(
  root,
  "profile/work",
  task.id,
  "stream-0/parts/track-0/0____",
);
const segments = (await readdir(parts))
  .filter((name) => /^\d+\.mp4$/.test(name))
  .sort();
assert(
  segments.length >= 3,
  "Need complete media segments from the actual desktop download",
);
let downloadedVideoBytes = 0;
for (const file of segments)
  downloadedVideoBytes += (await stat(join(parts, file))).size;
const videoPath = join(root, "sample-video.mp4");
await writeFile(
  videoPath,
  Buffer.concat(
    await Promise.all(
      ["_init.mp4", ...segments.slice(0, 3)].map((name) =>
        readFile(join(parts, name)),
      ),
    ),
  ),
);
const videoInfo = await mediaInfo(videoPath, tools);
const sampleDuration = Number(videoInfo.format.duration);
assert(sampleDuration > 0 && sampleDuration < 60);
const raw = JSON.parse(
  await command(
    tools.ytdlp,
    [
      "--ignore-config",
      "--no-playlist",
      "--skip-download",
      "--dump-single-json",
      "--no-warnings",
      "--socket-timeout",
      "15",
      "--",
      asset.pageUrl,
    ],
    { timeout: 60000 },
  ),
);
const audio = raw.formats
  .filter((f: any) => f.vcodec === "none" && /m3u8/.test(f.protocol))
  .sort((a: any, b: any) => (b.abr ?? 0) - (a.abr ?? 0))[0];
assert(audio, "No public HLS audio variant");
const audioPath = join(root, "sample-audio.m4a");
await command(
  tools.ffmpeg,
  [
    "-v",
    "error",
    "-nostdin",
    "-y",
    "-rw_timeout",
    "20000000",
    "-i",
    audio.url,
    "-t",
    String(sampleDuration),
    "-map",
    "0:a:0",
    "-c",
    "copy",
    audioPath,
  ],
  { timeout: 60000 },
);
const outputPath = join(root, "x-download-sample.mp4");
await command(tools.ffmpeg, [
  "-v",
  "error",
  "-nostdin",
  "-y",
  "-i",
  videoPath,
  "-i",
  audioPath,
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  outputPath,
]);
const [audioInfo, outputInfo] = await Promise.all([
  mediaInfo(audioPath, tools),
  mediaInfo(outputPath, tools),
]);
verifyMedia([videoInfo, audioInfo], outputInfo);
await command(tools.ffmpeg, [
  "-v",
  "error",
  "-xerror",
  "-threads",
  "2",
  "-i",
  outputPath,
  "-map",
  "0:v:0",
  "-map",
  "0:a:0",
  "-f",
  "null",
  "-",
]);
const report = {
  generatedAt: new Date().toISOString(),
  page: asset.pageUrl,
  title: asset.title,
  status: "passed",
  scope:
    "Bounded public X download smoke test. Full download cancelled at user request; no full-length or authenticated-X acceptance claim.",
  loginDetected,
  platformDurationSeconds: asset.duration,
  taskFinalState: task.state,
  desktopDownload: {
    engine: "N_m3u8DL-RE via Chromium session bridge",
    completeVideoSegments: segments.length,
    downloadedVideoBytes,
  },
  sample: {
    videoSource:
      "First three complete fragments retained from the actual desktop task",
    audioSource:
      "Bounded public HLS fetch with FFmpeg; desktop audio path not separately exercised on X",
    durationSeconds: Number(outputInfo.format.duration),
    video: outputInfo.streams.find((s: any) => s.codec_type === "video"),
    audio: outputInfo.streams.find((s: any) => s.codec_type === "audio"),
    streamCopyMerge: "passed",
    fullSampleDecode: "passed",
  },
};
await writeFile(join(root, "smoke.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
