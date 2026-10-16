import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createFixtures } from "./fixtures";
import { parseManifest } from "../src/core/manifest";
import { TransportBridge } from "../src/core/bridge";
import { execute, mediaInfo, type Tools } from "../src/core/engine";
import { command } from "../src/core/process";
const root = resolve("work/protocol-edge-verification");
await mkdir(root, { recursive: true });
const dir = resolve("resources/tools"),
  suffix = process.platform === "win32" ? ".exe" : "";
const tools: Tools = {
  ffmpeg: join(dir, "ffmpeg" + suffix),
  ffprobe: join(dir, "ffprobe" + suffix),
  m3u8: join(dir, "N_m3u8DL-RE" + suffix),
  ytdlp: join(dir, "yt-dlp" + suffix),
  runtime: process.execPath,
};
const fixture = await createFixtures(join(root, "fixtures"), tools);
const unicodeWork = join(root, "中文目录和'引号");
await mkdir(unicodeWork, { recursive: true });
const results: any[] = [];
try {
  await writeFile(
    join(fixture.root, "video/discontinuity.m3u8"),
    "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-PLAYLIST-TYPE:VOD\n" +
      [0, 1, 2].map((n) => `#EXTINF:1,\nseg-00${n}.ts\n`).join("") +
      "#EXT-X-DISCONTINUITY\n" +
      [0, 1, 2].map((n) => `#EXTINF:1,\nseg-00${n}.ts\n`).join("") +
      "#EXT-X-ENDLIST\n",
  );
  const mpd = await readFile(join(fixture.root, "dash/manifest.mpd"), "utf8");
  const first = mpd
    .match(/<Period\b[\s\S]+?<\/Period>/)![0]
    .replace('start="PT0.0S"', 'start="PT0S" duration="PT6S"');
  const second = first.replace(
    '<Period id="0" start="PT0S"',
    '<Period id="1" start="PT6S"',
  );
  await writeFile(
    join(fixture.root, "dash/multi-period.mpd"),
    mpd
      .replace(
        'mediaPresentationDuration="PT6.0S"',
        'mediaPresentationDuration="PT12S"',
      )
      .replace(/<Period\b[\s\S]+?<\/Period>/, first + second),
  );
  for (const [name, path, expected] of [
    ["hls-timestamp-reset-discontinuity", "video/discontinuity.m3u8", 6],
    ["dash-two-periods-same-representations", "dash/multi-period.mpd", 12],
  ] as const) {
    const bridge = new TransportBridge(
      fetch,
      join(root, name, "cache"),
      () => ({ Cookie: "vidown_fixture=allowed" }),
    );
    await bridge.start();
    try {
      const asset = parseManifest(
        await readFile(join(fixture.root, path), "utf8"),
        fixture.origin + "/auth/" + path,
        { id: "fixture", profile: "test" },
      );
      assert.equal(asset.duration, expected);
      const output = await execute(
        {
          id: randomUUID(),
          asset,
          tracks: asset.tracks.map((t) => ({
            ...t,
            url: bridge.register(t.url),
          })),
          output: "source",
          directory: unicodeWork,
        },
        tools,
        unicodeWork,
        new AbortController().signal,
        () => {},
      );
      const info = await mediaInfo(output, tools);
      assert(Math.abs(Number(info.format.duration) - expected) < 0.25);
      await command(tools.ffmpeg, [
        "-v",
        "error",
        "-xerror",
        "-i",
        output,
        "-f",
        "null",
        "-",
      ]);
      results.push({
        name,
        status: "passed",
        expectedDuration: expected,
        actualDuration: Number(info.format.duration),
        output,
      });
    } catch (error) {
      results.push({ name, status: "failed", error: String(error) });
    } finally {
      await bridge.close();
    }
  }
} finally {
  await fixture.close();
  await writeFile(
    join(root, "report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  );
}
console.log(JSON.stringify(results, null, 2));
assert(
  results.every((r) => r.status === "passed"),
  "Protocol edge verification failed; inspect the report before declaring support",
);
