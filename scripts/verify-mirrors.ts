import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { command } from "../src/core/process";
import { execute, mediaInfo, type Tools } from "../src/core/engine";
import { TransportBridge } from "../src/core/bridge";
import type { DownloadPlan } from "../src/shared/types";

const root = resolve("work/mirror-verification");
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
const source = join(root, "fixture.mp4");
await command(tools.ffmpeg, [
  "-v",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=24",
  "-t",
  "6",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-movflags",
  "+faststart",
  source,
]);
const media = await readFile(source),
  invalidPrefix = Buffer.from(media);
invalidPrefix.fill(0, 0, 32);
const requests: { host: string; range?: string; authorization?: string }[] = [];
let primaryFailed = false;
const primary = createServer((req, res) => {
  requests.push({
    host: "primary",
    range: req.headers.range,
    authorization: req.headers.authorization,
  });
  if (primaryFailed) {
    res.writeHead(503).end("Primary unavailable");
    return;
  }
  res.writeHead(200, {
    "content-type": "video/mp4",
    "content-length": media.length,
    etag: '"shared-validator"',
    "accept-ranges": "bytes",
  });
  let offset = 0;
  const timer = setInterval(() => {
    const end = Math.min(media.length, offset + 4096);
    res.write(invalidPrefix.subarray(offset, end));
    offset = end;
    if (offset === media.length) {
      clearInterval(timer);
      res.end();
    }
  }, 25);
  res.once("close", () => clearInterval(timer));
});
const backup = createServer((req, res) => {
  requests.push({
    host: "backup",
    range: req.headers.range,
    authorization: req.headers.authorization,
  });
  res.writeHead(200, {
    "content-type": "video/mp4",
    "content-length": media.length,
    etag: '"shared-validator"',
    "accept-ranges": "bytes",
  });
  res.end(media);
});
await new Promise<void>((r) => primary.listen(0, "127.0.0.1", r));
await new Promise<void>((r) => backup.listen(0, "127.0.0.1", r));
const primaryOrigin = `http://127.0.0.1:${(primary.address() as any).port}`;
const backupOrigin = `http://127.0.0.1:${(backup.address() as any).port}`;
const bridge = new TransportBridge(
  fetch,
  join(root, "cache"),
  (url): Record<string, string> =>
    new URL(url).origin === primaryOrigin
      ? { Authorization: "fixture-only" }
      : {},
);
await bridge.start();
try {
  const track = {
    id: "video",
    kind: "video" as const,
    protocol: "http" as const,
    url: bridge.register(primaryOrigin + "/video.mp4"),
    identity: "primary-stable",
    fallbacks: [
      {
        url: bridge.register(backupOrigin + "/video.mp4"),
        identity: "backup-stable",
      },
    ],
    label: "video",
    height: 360,
    codec: "avc1",
  };
  const plan: DownloadPlan = {
    id: randomUUID(),
    asset: {
      id: "asset",
      title: "Mirror isolation",
      pageUrl: primaryOrigin,
      context: { id: "fixture", profile: "test" },
      tracks: [track],
      duration: 6,
      warnings: [],
    },
    tracks: [track],
    output: "source",
    directory: root,
  };
  const controller = new AbortController();
  await assert.rejects(() =>
    execute(plan, tools, root, controller.signal, (event) => {
      if ((event.bytes ?? 0) > 32768) controller.abort();
    }),
  );
  const partial = await stat(join(root, plan.id, "track-0.source.part"));
  assert(partial.size > 0);
  primaryFailed = true;
  const output = await execute(
    plan,
    tools,
    root,
    new AbortController().signal,
    () => {},
  );
  assert(requests.some((r) => r.host === "backup"));
  assert(
    requests
      .filter((r) => r.host === "backup")
      .every((r) => !r.range && !r.authorization),
    "Mirror inherited an offset or another origin's Authorization",
  );
  const saved = await readFile(join(root, plan.id, "track-0-mirror-1.source"));
  assert.equal(
    createHash("sha256").update(saved).digest("hex"),
    createHash("sha256").update(media).digest("hex"),
  );
  const info = await mediaInfo(output, tools);
  assert.equal(info.streams[0].height, 360);
  const report = {
    generatedAt: new Date().toISOString(),
    status: "passed",
    scope:
      "Real HTTP origins, Chromium-compatible scoped bridge transport, real FFmpeg merge/validation. A partially retained primary with a deliberately invalid prefix is never appended to a backup with the same ETag.",
    checks: [
      "actual transport stops on pause",
      "primary 503 selects registered backup",
      "backup starts at byte zero despite matching ETag",
      "Authorization does not cross origins",
      "saved backup bytes exactly match independent source",
      "result metadata passes",
    ],
    retainedPrimaryBytes: partial.size,
    backupBytes: saved.length,
    output,
  };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await bridge.close();
  primary.closeAllConnections();
  backup.closeAllConnections();
  await Promise.all([
    new Promise<void>((r) => primary.close(() => r())),
    new Promise<void>((r) => backup.close(() => r())),
  ]);
}
