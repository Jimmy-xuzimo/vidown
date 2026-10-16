import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { command } from "../src/core/process";
import { mediaInfo, verifyMedia, type Tools } from "../src/core/engine";

const root = resolve("work/platform-verification");
const { task, page } = JSON.parse(
  await readFile(join(root, "download.json"), "utf8"),
);
const dir = resolve("resources/tools");
const tools: Tools = {
  ffmpeg: join(dir, "ffmpeg.exe"),
  ffprobe: join(dir, "ffprobe.exe"),
  ytdlp: join(dir, "yt-dlp.exe"),
  m3u8: join(dir, "N_m3u8DL-RE.exe"),
  runtime: process.execPath,
};
const trackDir = join(root, "profile/work", task.id);
const sourceVideo = join(trackDir, "track-0.source"),
  sourceAudio = join(trackDir, "track-1.source");
const [video, audio, output] = await Promise.all([
  mediaInfo(sourceVideo, tools),
  mediaInfo(sourceAudio, tools),
  mediaInfo(task.output, tools),
]);
verifyMedia([video, audio], output);
async function streamHash(path: string, type: "v" | "a") {
  return (
    await command(
      tools.ffmpeg,
      [
        "-v",
        "error",
        "-i",
        path,
        "-map",
        `0:${type}:0`,
        "-c",
        "copy",
        ...(type === "v" ? ["-bsf:v", "hevc_mp4toannexb"] : []),
        "-f",
        "hash",
        "-hash",
        "sha256",
        "-",
      ],
      { timeout: 120000 },
    )
  ).trim();
}
const hashes = {
  sourceVideo: await streamHash(sourceVideo, "v"),
  savedVideo: await streamHash(task.output, "v"),
  sourceAudio: await streamHash(sourceAudio, "a"),
  savedAudio: await streamHash(task.output, "a"),
};
assert.equal(
  hashes.sourceVideo,
  hashes.savedVideo,
  "Encoded HEVC bitstream changed",
);
assert.equal(
  hashes.sourceAudio,
  hashes.savedAudio,
  "Encoded audio bitstream changed",
);
const stream = output.streams.find((s: any) => s.codec_type === "video");
assert(
  stream.side_data_list?.some(
    (s: any) => /DOVI/i.test(s.side_data_type) && s.rpu_present_flag === 1,
  ),
  "No DOVI RPU configuration",
);
const report = {
  generatedAt: new Date().toISOString(),
  page,
  status: "passed",
  scope:
    "Exact full encoded HEVC Annex-B and audio bitstream hashes; DOVI configuration and media metadata. Hardware playback remains pending.",
  hashes,
  video: stream,
  audio: output.streams.find((s: any) => s.codec_type === "audio"),
  duration: output.format.duration,
};
await writeFile(
  join(root, "preservation.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
