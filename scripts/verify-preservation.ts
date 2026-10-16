import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { command } from "../src/core/process";
import { mediaInfo, verifyMedia, type Tools } from "../src/core/engine";

const root = resolve(
  process.env.VIDOWN_PLATFORM_ROOT || "work/platform-verification",
);
const {
  task,
  page,
  video: selectedVideo,
  audio: selectedAudio,
} = JSON.parse(await readFile(join(root, "download.json"), "utf8"));
const dir = resolve("resources/tools");
const tools: Tools = {
  ffmpeg: join(dir, "ffmpeg.exe"),
  ffprobe: join(dir, "ffprobe.exe"),
  ytdlp: join(dir, "yt-dlp.exe"),
  m3u8: join(dir, "N_m3u8DL-RE.exe"),
  runtime: process.execPath,
};
const trackDir = join(
  resolve(process.env.VIDOWN_PLATFORM_PROFILE || join(root, "profile")),
  "work",
  task.id,
);
async function sourcePath(index: number): Promise<string> {
  const direct = join(trackDir, `track-${index}.source`);
  try {
    await stat(direct);
    return direct;
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  const mirrors = (await readdir(trackDir)).filter((name) =>
    new RegExp(`^track-${index}-mirror-\\d+\\.source$`).test(name),
  );
  if (mirrors.length === 1) return join(trackDir, mirrors[0]);
  const folder = join(trackDir, `stream-${index}`);
  const files = (await readdir(folder, { withFileTypes: true })).filter(
    (f) => f.isFile() && !/\.(json|log|txt|tmp)$/i.test(f.name),
  );
  assert.equal(files.length, 1, "Expected exactly one saved source track");
  return join(folder, files[0].name);
}
const sourceVideo = await sourcePath(0),
  sourceAudio = selectedAudio ? await sourcePath(1) : sourceVideo;
const [video, audio, output] = await Promise.all([
  mediaInfo(sourceVideo, tools),
  mediaInfo(sourceAudio, tools),
  mediaInfo(task.output, tools),
]);
verifyMedia(selectedAudio ? [video, audio] : [video], output);
const { asset } = JSON.parse(
  await readFile(join(root, "formats.json"), "utf8"),
);
if (asset.duration)
  assert(
    Math.abs(Number(output.format.duration) - asset.duration) < 2,
    "Saved duration differs from the platform's full video duration",
  );
const videoCodec = video.streams.find(
  (s: any) => s.codec_type === "video",
).codec_name;
const annexB =
  videoCodec === "hevc"
    ? "hevc_mp4toannexb"
    : videoCodec === "h264"
      ? "h264_mp4toannexb"
      : undefined;
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
        ...(type === "v" && annexB ? ["-bsf:v", annexB] : []),
        "-f",
        "hash",
        "-hash",
        "sha256",
        "-",
      ],
      { timeout: 300000 },
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
  "Encoded video bitstream changed",
);
assert.equal(
  hashes.sourceAudio,
  hashes.savedAudio,
  "Encoded audio bitstream changed",
);
const stream = output.streams.find((s: any) => s.codec_type === "video");
if (selectedVideo.dynamicRange === "DV")
  assert(
    stream.side_data_list?.some(
      (s: any) => /DOVI/i.test(s.side_data_type) && s.rpu_present_flag === 1,
    ),
    "No DOVI RPU configuration",
  );
const duration = Number(output.format.duration);
const decodedSampleSeconds = [
  0,
  Math.floor(duration / 2),
  Math.max(0, Math.floor(duration) - 5),
];
for (const position of decodedSampleSeconds) {
  await command(
    tools.ffmpeg,
    [
      "-v",
      "error",
      "-xerror",
      "-threads",
      "2",
      "-ss",
      String(position),
      "-i",
      task.output,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-t",
      "3",
      "-f",
      "null",
      "-",
    ],
    { timeout: 120000 },
  );
}
const report = {
  generatedAt: new Date().toISOString(),
  page,
  status: "passed",
  scope: `Exact full encoded ${videoCodec}${annexB ? " Annex-B" : ""} and audio bitstream hashes; media metadata and full platform duration. ${selectedVideo.dynamicRange === "DV" ? "DOVI configuration checked; hardware playback remains pending." : "No hardware playback claim."}`,
  hashes,
  decodedSamples: {
    positionsSeconds: decodedSampleSeconds,
    durationSeconds: 3,
    status: "passed",
  },
  video: stream,
  frameMetadata: output.frameMetadata,
  audio: output.streams.find((s: any) => s.codec_type === "audio"),
  duration: output.format.duration,
};
await writeFile(
  join(root, "preservation.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
