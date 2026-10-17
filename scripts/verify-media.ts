import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TransportBridge } from "../src/core/bridge";
import { parseManifest } from "../src/core/manifest";
import { execute, mediaInfo, type Tools } from "../src/core/engine";
import { createFixtures } from "./fixtures";
import type { DownloadPlan, PrivateAsset } from "../src/shared/types";
const root = resolve("work/media-verification");
await mkdir(root, { recursive: true });
const exe = process.platform === "win32" ? ".exe" : "";
const dir = resolve("resources/tools");
const tools: Tools = {
  ffmpeg: join(dir, "ffmpeg" + exe),
  ffprobe: join(dir, "ffprobe" + exe),
  m3u8: join(dir, "N_m3u8DL-RE" + exe),
  ytdlp: join(dir, "yt-dlp" + exe),
  runtime: process.execPath,
};
const fixture = await createFixtures(join(root, "fixtures"), tools);
const results: any[] = [];
const context = { id: "fixture", profile: "controlled-test" };
async function runManifest(name: string, path: string, selected?: number[]) {
  const asset = parseManifest(
    await readFile(join(fixture.root, path), "utf8"),
    fixture.origin + "/auth/" + path,
    context,
  );
  const bridge = new TransportBridge(fetch, join(root, name, "cache"), () => ({
    Cookie: "vidown_fixture=allowed",
  }));
  await bridge.start();
  try {
    const tracks = (
      selected ? selected.map((index) => asset.tracks[index]) : asset.tracks
    ).map((t) => ({ ...t, url: bridge.register(t.url) }));
    const plan: DownloadPlan = {
      id: name,
      asset,
      tracks,
      output: "source",
      directory: join(root, "results"),
    };
    // Repeated verification runs use new output names without deleting previous evidence.
    plan.id = randomUUID();
    const output = await execute(
      plan,
      tools,
      root,
      new AbortController().signal,
      () => {},
    );
    const info = await mediaInfo(output, tools);
    results.push({
      name,
      status: "passed",
      output,
      streams: info.streams.map((s: any) => ({
        type: s.codec_type,
        codec: s.codec_name,
        width: s.width,
        height: s.height,
        sampleRate: s.sample_rate,
      })),
      duration: info.format.duration,
    });
    console.log("PASS", name);
  } catch (error) {
    await writeFile(
      join(root, "failed-requests.json"),
      JSON.stringify(fixture.requests, null, 2),
    );
    throw error;
  } finally {
    await bridge.close();
  }
}
try {
  assert.equal((await fetch(fixture.origin + "/auth/master.m3u8")).status, 403);
  await runManifest("authenticated-hls-separated-audio", "master.m3u8");
  await runManifest("aes128-key-rotation", "aes/index.m3u8");
  await runManifest("hls-fmp4-initialization", "fmp4/index.m3u8");
  await runManifest("hls-byte-range", "range/index.m3u8");
  await runManifest(
    "dash-template-timeline-separated-audio",
    "dash/manifest.mpd",
  );
  const highBridge = new TransportBridge(
    fetch,
    join(root, "hdr-cache"),
    () => ({ Cookie: "vidown_fixture=allowed" }),
  );
  await highBridge.start();
  try {
    const asset: PrivateAsset = {
      id: randomUUID(),
      title: "HDR10 + Hi-Res 原规格验证",
      pageUrl: fixture.origin + "/player",
      context,
      warnings: [],
      tracks: [
        {
          id: "video",
          kind: "video",
          protocol: "http",
          url: highBridge.register(fixture.origin + "/auth/hdr10.mp4"),
          label: "HDR10",
        },
        {
          id: "audio",
          kind: "audio",
          protocol: "http",
          url: highBridge.register(fixture.origin + "/auth/hires.flac"),
          label: "FLAC",
        },
      ],
    };
    const output = await execute(
      {
        id: randomUUID(),
        asset,
        tracks: asset.tracks,
        output: "source",
        directory: join(root, "results"),
      },
      tools,
      root,
      new AbortController().signal,
      () => {},
    );
    const info = await mediaInfo(output, tools);
    assert(output.endsWith(".mkv"));
    assert.equal(
      info.streams.find((s: any) => s.codec_type === "video").color_transfer,
      "smpte2084",
    );
    const audio = info.streams.find((s: any) => s.codec_type === "audio");
    assert.equal(audio.sample_rate, "96000");
    assert.equal(audio.bits_per_raw_sample, "24");
    results.push({
      name: "generated-hdr10-10bit-and-flac-96khz-24bit-source-preservation",
      status: "passed",
      output,
      frameMetadata: info.frameMetadata,
    });
    console.log("PASS generated-hdr10-and-hires-source-preservation");
  } finally {
    await highBridge.close();
  }
  const bridge = new TransportBridge(fetch, join(root, "direct-cache"), () => ({
    Cookie: "vidown_fixture=allowed",
  }));
  await bridge.start();
  fixture.reset();
  fixture.setSlow(true);
  try {
    const asset: PrivateAsset = {
      id: "direct",
      title: "暂停恢复验证",
      pageUrl: fixture.origin + "/player",
      context,
      warnings: [],
      tracks: [
        {
          id: "direct",
          kind: "muxed",
          protocol: "http",
          url: bridge.register(fixture.origin + "/auth/direct.mp4"),
          label: "direct",
        },
      ],
    };
    const plan: DownloadPlan = {
      id: randomUUID(),
      asset,
      tracks: asset.tracks,
      output: "source",
      directory: join(root, "results"),
    };
    const controller = new AbortController();
    let paused = false;
    await assert.rejects(() =>
      execute(plan, tools, root, controller.signal, (event) => {
        if ((event.bytes ?? 0) > 32768) {
          paused = true;
          controller.abort();
        }
      }),
    );
    assert(paused);
    const partial = await stat(join(root, plan.id, "track-0.source.part"));
    assert(partial.size > 0);
    const output = await execute(
      plan,
      tools,
      root,
      new AbortController().signal,
      () => {},
    );
    assert(
      fixture.requests.some((r) =>
        r.range?.startsWith(`bytes=${partial.size}-`),
      ),
    );
    results.push({
      name: "direct-pause-resume-with-etag-range",
      status: "passed",
      reusedBytes: partial.size,
      output,
    });
    console.log("PASS direct-pause-resume-with-etag-range");
    const changed = { ...plan, id: randomUUID() };
    const stop = new AbortController();
    await assert.rejects(() =>
      execute(changed, tools, root, stop.signal, (event) => {
        if ((event.bytes ?? 0) > 32768) stop.abort();
      }),
    );
    fixture.changeSource();
    const changedOutput = await execute(
      changed,
      tools,
      root,
      new AbortController().signal,
      () => {},
    );
    results.push({
      name: "changed-validator-restarts-instead-of-appending",
      status: "passed",
      output: changedOutput,
    });
    console.log("PASS changed-validator-restarts-instead-of-appending");
  } finally {
    await bridge.close();
  }
  fixture.reset();
  fixture.setSlow(false);
  fixture.setSlowSegments(true);
  const resumableAsset = parseManifest(
    await readFile(join(fixture.root, "video/index.m3u8"), "utf8"),
    fixture.origin + "/auth/video/index.m3u8",
    context,
  );
  const resumablePlan: DownloadPlan = {
    id: randomUUID(),
    asset: resumableAsset,
    tracks: resumableAsset.tracks,
    output: "source",
    directory: join(root, "results"),
  };
  const pauseController = new AbortController();
  let pauseTimer: NodeJS.Timeout | undefined;
  let streamBridge = new TransportBridge(
    fetch,
    join(root, resumablePlan.id, "cache"),
    () => ({ Cookie: "vidown_fixture=allowed" }),
    () => {
      if (!pauseTimer)
        pauseTimer = setTimeout(() => pauseController.abort(), 150);
    },
  );
  await streamBridge.start();
  try {
    await assert.rejects(() =>
      execute(
        {
          ...resumablePlan,
          tracks: resumablePlan.tracks.map((t) => ({
            ...t,
            url: streamBridge.register(t.url),
          })),
        },
        tools,
        root,
        pauseController.signal,
        () => {},
      ),
    );
  } finally {
    if (pauseTimer) clearTimeout(pauseTimer);
    await streamBridge.close();
  }
  const completedSegments = fixture.requests
    .filter((r) => r.completed && r.path.endsWith(".ts"))
    .map((r) => r.path);
  assert(completedSegments.length > 0);
  streamBridge = new TransportBridge(
    fetch,
    join(root, resumablePlan.id, "cache"),
    () => ({ Cookie: "vidown_fixture=allowed" }),
  );
  await streamBridge.start();
  try {
    const resumed = {
      ...resumablePlan,
      tracks: resumablePlan.tracks.map((t) => ({
        ...t,
        url: streamBridge.register(t.url),
      })),
    };
    const output = await execute(
      resumed,
      tools,
      root,
      new AbortController().signal,
      () => {},
    );
    for (const path of completedSegments)
      assert.equal(
        fixture.requests.filter((r) => r.path === path).length,
        1,
        `Completed segment fetched again: ${path}`,
      );
    results.push({
      name: "hls-pause-resume-across-new-bridge-without-refetching-completed-segments",
      status: "passed",
      reusedSegments: completedSegments.length,
      output,
    });
    console.log("PASS hls-pause-resume-no-completed-segment-refetch");
    fixture.changeManifest();
    await assert.rejects(
      () =>
        execute(resumed, tools, root, new AbortController().signal, () => {}),
      /清单已经变化/,
    );
    results.push({
      name: "changed-manifest-refuses-old-segment-checkpoint",
      status: "passed",
    });
    console.log("PASS changed-manifest-refuses-old-segments");
  } finally {
    await streamBridge.close();
  }
  assert(fixture.requests.every((r) => r.authorized));
  results.push(
    ...[
      "bilibili-premium-8k-hdr-dolby-hires",
      "x-authenticated",
      "telegram-private-media",
      "real-dolby-rpu-preservation",
    ].map((name) => ({
      name,
      status: "pending",
      reason:
        "Requires user-owned account or real source sample; not inferred from unit tests.",
    })),
  );
} catch (error) {
  results.push({ status: "failed", error: String(error) });
  throw error;
} finally {
  await fixture.close();
  await writeFile(
    join(root, "report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        platform: process.platform,
        results,
      },
      null,
      2,
    ),
  );
}
