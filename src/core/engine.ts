import {
  mkdir,
  readFile,
  writeFile,
  stat,
  rename,
  rm,
  open,
} from "node:fs/promises";
import { join, extname } from "node:path";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { command } from "./process";
import { fromYtdlp, containerFor } from "./formats";
import { parseManifest } from "./manifest";
import { downloadAdaptive } from "./adaptive";
import { httpUrl, safeName, digest, publicUrl } from "./safety";
import type {
  PrivateAsset,
  DownloadPlan,
  TaskEvent,
  RequestContextRef,
  PrivateTrack,
} from "../shared/types";

export interface Tools {
  ytdlp: string;
  m3u8: string;
  ffmpeg: string;
  ffprobe: string;
  runtime: string;
}
export interface ProbeInput {
  url: string;
  context: RequestContextRef;
  headers: Record<string, string>;
  cookies: string;
  bridgeUrl?: string;
  manifestText?: string;
  proxy?: string;
}
export async function probe(
  input: ProbeInput,
  tools: Tools,
  work: string,
  signal: AbortSignal,
): Promise<PrivateAsset> {
  const url = httpUrl(input.url);
  await mkdir(work, { recursive: true });
  const cookieFile = join(work, randomUUID() + ".cookies.txt");
  try {
    if (input.manifestText)
      return parseManifest(input.manifestText, url, input.context);
    if (input.cookies)
      await writeFile(cookieFile, input.cookies, { mode: 0o600 });
    const args = [
      "--ignore-config",
      "--no-playlist",
      "--skip-download",
      "--dump-single-json",
      "--no-warnings",
      "--socket-timeout",
      "25",
      "--extractor-retries",
      "1",
      "--ffmpeg-location",
      tools.ffmpeg,
    ];
    if (input.cookies) args.push("--cookies", cookieFile);
    if (input.proxy) args.push("--proxy", input.proxy);
    for (const [key, value] of Object.entries(input.headers))
      if (!/^(cookie|authorization|host|content-length)$/i.test(key))
        args.push("--add-headers", `${key}:${value}`);
    args.push("--js-runtimes", `node:${tools.runtime}`, "--", url);
    // Manifests captured by the browser use the browser transport even during parsing.
    if (input.bridgeUrl) {
      const response = await fetch(input.bridgeUrl, { signal });
      if (!response.ok) throw new Error(`媒体请求返回 ${response.status}`);
      const type = response.headers.get("content-type") ?? "";
      if (
        /mpegurl|dash\+xml/i.test(type) ||
        /\.(m3u8|mpd)(?:[?#]|$)/i.test(url)
      ) {
        const text = await response.text();
        if (text.length > 8 * 1024 * 1024) throw new Error("清单过大");
        // URLs already point to the browser transport; preserve their source URL separately for titles.
        const asset = parseManifest(text, input.bridgeUrl, input.context);
        asset.pageUrl = publicUrl(url);
        asset.title = new URL(url).pathname.split("/").pop() || "流媒体";
        return asset;
      }
      await response.body?.cancel();
      return {
        id: randomUUID(),
        title: new URL(url).pathname.split("/").pop() || "媒体",
        pageUrl: publicUrl(url),
        context: input.context,
        warnings: [],
        tracks: [
          {
            id: randomUUID(),
            kind: /^audio\//.test(type) ? "audio" : "muxed",
            protocol: "http",
            url,
            label: "浏览器媒体 · 规格将在保存时验证",
          },
        ],
      };
    }
    const result = await command(tools.ytdlp, args, {
      signal,
      timeout: 90000,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    const data = JSON.parse(result);
    if (data.is_live) throw new Error("本版不支持直播录制");
    const asset = fromYtdlp(data, input.context);
    if (/preview|试看/i.test(data.format_note ?? ""))
      asset.warnings.push("平台返回了试看内容，请确认登录及会员权限。");
    return asset;
  } finally {
    await rm(cookieFile, { force: true });
  }
}
export async function mediaInfo(
  path: string,
  tools: Tools,
  signal?: AbortSignal,
): Promise<any> {
  const info = JSON.parse(
    await command(
      tools.ffprobe,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
      { signal },
    ),
  );
  if (info.streams?.some((s: any) => s.codec_type === "video")) {
    const frames = JSON.parse(
      await command(
        tools.ffprobe,
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-read_intervals",
          "%+#1",
          "-show_frames",
          "-of",
          "json",
          path,
        ],
        { signal },
      ),
    );
    info.frameMetadata = (frames.frames?.[0]?.side_data_list ?? []).filter(
      (s: any) =>
        /Mastering display|Content light|DOVI|Dolby/i.test(s.side_data_type),
    );
  }
  return info;
}
function codecTrack(stream: any): PrivateTrack {
  const dynamic = stream.side_data_list?.some((s: any) =>
    /DOVI|Dolby/i.test(s.side_data_type),
  )
    ? "DV"
    : undefined;
  return {
    id: "verified",
    kind: stream.codec_type === "audio" ? "audio" : "video",
    protocol: "http",
    url: "",
    label: "verified",
    codec: stream.codec_name,
    dynamicRange: dynamic,
  };
}
export async function execute(
  plan: DownloadPlan,
  tools: Tools,
  work: string,
  signal: AbortSignal,
  emit: (event: Partial<TaskEvent>) => void,
): Promise<string> {
  const taskDir = join(work, plan.id);
  await mkdir(taskDir, { recursive: true });
  await mkdir(plan.directory, { recursive: true });
  const inputs: string[] = [];
  const infos: any[] = [];
  let lastProgress = 0;
  let completedBytes = 0;
  for (let index = 0; index < plan.tracks.length; index++) {
    signal.throwIfAborted();
    const track = plan.tracks[index];
    emit({
      state: "downloading",
      message: `下载轨道 ${index + 1}/${plan.tracks.length}`,
    });
    let input: string;
    if (track.protocol === "telegram") {
      input = track.url;
    } else if (track.protocol === "http") {
      const locations = [
        { url: track.url, identity: track.identity },
        ...(track.fallbacks ?? []),
      ];
      input = "";
      let failure: unknown;
      for (
        let locationIndex = 0;
        locationIndex < locations.length;
        locationIndex++
      ) {
        const location = locations[locationIndex];
        // Strong ETags are scoped to a resource, not interchangeable across origins.
        // A mirror always has its own file and checkpoint, even if its ETag matches.
        const path = join(
          taskDir,
          `track-${index}${locationIndex ? `-mirror-${locationIndex}` : ""}.source`,
        );
        try {
          await direct(
            location.url,
            path,
            signal,
            (bytes) => {
              if (Date.now() - lastProgress > 250) {
                lastProgress = Date.now();
                emit({ bytes: completedBytes + bytes });
              }
            },
            location.identity,
          );
          input = path;
          break;
        } catch (error: any) {
          if (
            signal.aborted ||
            /^(ENOSPC|EACCES|EPERM|EROFS|EMFILE)$/.test(error.code ?? "")
          )
            throw error;
          failure = error;
          if (locationIndex + 1 < locations.length)
            emit({
              message:
                "当前地址失败，使用备用源独立下载，不拼接不同源的旧字节。",
            });
        }
      }
      if (!input) throw failure;
    } else if (track.protocol === "hls" || track.protocol === "dash") {
      const response = await fetch(track.url, { signal });
      if (!response.ok) throw new Error(`清单请求返回 ${response.status}`);
      const text = await response.text();
      if (track.protocol === "hls" && !text.includes("#EXT-X-ENDLIST"))
        throw new Error(
          "所选清单尚未结束或仍为主清单；本版只下载明确结束的点播媒体。",
        );
      const fingerprint =
        response.headers.get("x-vidown-manifest-sha256") ?? digest(text);
      const fingerprintPath = join(taskDir, `manifest-${index}.sha256`);
      let previous: string | undefined;
      try {
        previous = await readFile(fingerprintPath, "utf8");
      } catch {}
      if (previous && previous !== fingerprint)
        throw new Error(
          "源清单已经变化，不能复用旧分片；请重新探测并创建新任务。",
        );
      await writeFile(fingerprintPath, fingerprint);
      const folder = join(taskDir, `stream-${index}`);
      await mkdir(folder, { recursive: true });
      input = await downloadAdaptive(track, text, folder, tools, signal);
    } else throw new Error("该轨道需要 Telegram 专用下载流程");
    const info = await mediaInfo(input, tools, signal);
    if (
      !info.streams?.some((s: any) => ["video", "audio"].includes(s.codec_type))
    )
      throw new Error("下载结果不是有效音视频");
    verifySelectedTrack(
      track,
      info,
      plan.asset.duration,
      plan.asset.tracks.some((t) => t.kind === "audio"),
    );
    inputs.push(input);
    infos.push(info);
    completedBytes += (await stat(input)).size;
    emit({ bytes: completedBytes });
  }
  const selectedInfos = infos.map((info, index) => ({
    ...info,
    streams: info.streams.filter((s: any) =>
      plan.tracks[index].kind === "muxed"
        ? ["audio", "video"].includes(s.codec_type)
        : s.codec_type === plan.tracks[index].kind,
    ),
  }));
  const streams = selectedInfos.flatMap((i) => i.streams);
  if (
    plan.output === "compatible" &&
    streams.some(
      (s: any) =>
        s.color_transfer === "smpte2084" ||
        s.color_transfer === "arib-std-b67" ||
        codecTrack(s).dynamicRange,
    )
  )
    throw new Error(
      "HDR／杜比视界的兼容导出需要显式色彩转换；本验证版只允许保留源规格，未执行降级。",
    );
  const ext = containerFor(
    streams.map(codecTrack),
    plan.output === "compatible",
  );
  const destination = join(
    plan.directory,
    `${safeName(plan.asset.title)} [${plan.id.slice(0, 8)}].${ext}`,
  );
  try {
    await stat(destination);
    throw new Error("输出文件已存在，不能覆盖");
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  const partial = join(taskDir, `merged.${ext}`);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
  inputs.forEach((p) => args.push("-i", p));
  if (inputs.length === 1) {
    if (plan.tracks[0].kind === "muxed")
      args.push("-map", "0:v?", "-map", "0:a?");
    else
      args.push("-map", `0:${plan.tracks[0].kind === "audio" ? "a:0" : "v:0"}`);
  } else
    for (let i = 0; i < plan.tracks.length; i++)
      args.push(
        "-map",
        `${i}:${plan.tracks[i].kind === "audio" ? "a:0" : "v:0"}`,
      );
  args.push("-map_metadata", "0");
  if (plan.output === "compatible")
    args.push(
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "medium",
      "-c:a",
      "aac",
      "-b:a",
      "256k",
    );
  else args.push("-c", "copy");
  if (ext === "mp4" || ext === "m4a") args.push("-movflags", "+faststart");
  args.push(partial);
  emit({ state: "merging" });
  await command(tools.ffmpeg, args, { signal, timeout: 24 * 3600 * 1000 });
  emit({ state: "verifying" });
  const output = await mediaInfo(partial, tools, signal);
  verifyMedia(selectedInfos, output, plan.output === "compatible");
  // Copy into the destination filesystem, then commit atomically. Never expose partial media as finished.
  const staging = destination + ".partial";
  const { copyFile } = await import("node:fs/promises");
  await copyFile(partial, staging);
  signal.throwIfAborted();
  await rename(staging, destination);
  return destination;
}
export function verifySelectedTrack(
  track: PrivateTrack,
  info: any,
  expectedDuration?: number,
  externalAudioAvailable = false,
): void {
  const type =
    track.kind === "audio" ||
    (track.kind === "muxed" &&
      !track.width &&
      !track.height &&
      !info.streams?.some((s: any) => s.codec_type === "video"))
      ? "audio"
      : "video";
  const stream = info.streams?.find((s: any) => s.codec_type === type);
  if (!stream) throw new Error(`下载源缺少所选 ${type} 轨道`);
  if (
    track.kind === "muxed" &&
    externalAudioAvailable &&
    !info.streams.some((s: any) => s.codec_type === "audio")
  )
    throw new Error(
      "该未知编码变体实际不含音频，请改选分离的视频和音轨；未保存无声成品。",
    );
  if (
    track.dynamicRange === "DV" &&
    !stream.side_data_list?.some(
      (s: any) => /DOVI/i.test(s.side_data_type) && s.rpu_present_flag === 1,
    )
  )
    throw new Error("下载源缺少所选杜比视界配置，已停止合并。");
  if (track.dynamicRange === "HDR10" && stream.color_transfer !== "smpte2084")
    throw new Error("下载源与所选 HDR10 规格不同，已停止合并。");
  for (const key of ["width", "height"] as const) {
    if (track[key] && stream[key] !== track[key])
      throw new Error("下载源分辨率与所选轨道不同，已停止合并。");
  }
  const codec = track.codec?.toLowerCase() ?? "";
  const expectedCodec = /^(avc|h264)/.test(codec)
    ? "h264"
    : /^(hev|hvc|dvh|hevc)/.test(codec)
      ? "hevc"
      : /^(av01|av1)/.test(codec)
        ? "av1"
        : /^(mp4a|aac)/.test(codec)
          ? "aac"
          : /^(ec-3|eac3)/.test(codec)
            ? "eac3"
            : /^(flac|opus|vorbis)$/.test(codec)
              ? codec
              : undefined;
  if (expectedCodec && stream.codec_name !== expectedCodec)
    throw new Error("下载源编码与所选轨道不同，已停止合并。");
  if (
    expectedDuration &&
    Math.abs(Number(info.format?.duration) - expectedDuration) >
      Math.max(2, expectedDuration * 0.005)
  )
    throw new Error(
      "下载源时长与平台返回的完整时长不同，可能缺失分片或只有试看内容。",
    );
}
export function verifyMedia(
  inputs: any[],
  output: any,
  transcoded = false,
): void {
  const source = inputs
    .flatMap((i) => i.streams ?? [])
    .filter((s: any) => ["video", "audio"].includes(s.codec_type));
  const target = (output.streams ?? []).filter((s: any) =>
    ["video", "audio"].includes(s.codec_type),
  );
  for (const original of source) {
    const saved = target.find((s: any) => s.codec_type === original.codec_type);
    if (!saved) throw new Error(`成品缺少 ${original.codec_type} 轨道`);
    if (!transcoded) {
      for (const key of [
        "codec_name",
        "width",
        "height",
        "sample_rate",
        "channels",
        "color_transfer",
        "color_primaries",
        "color_space",
      ])
        if (
          original[key] !== undefined &&
          original[key] !== "unknown" &&
          String(original[key]) !== String(saved[key])
        )
          throw new Error(`成品 ${key} 与源轨不同，未标记成功`);
      const bitDepth = Number(
        original.bits_per_raw_sample || original.bits_per_sample || 0,
      );
      const savedDepth = Number(
        saved.bits_per_raw_sample || saved.bits_per_sample || 0,
      );
      if (
        original.codec_type === "audio" &&
        bitDepth > 0 &&
        bitDepth !== savedDepth
      )
        throw new Error("音频位深发生变化或无法验证");
      if (original.codec_type === "video") {
        const rate = (value: string) => {
          const [n, d] = String(value ?? "")
            .split("/")
            .map(Number);
          return n / (d ?? 1);
        };
        const sourceRate = rate(original.avg_frame_rate),
          savedRate = rate(saved.avg_frame_rate);
        if (
          sourceRate > 0 &&
          savedRate > 0 &&
          Math.abs(sourceRate - savedRate) > 0.01
        )
          throw new Error("成品帧率与源轨不同");
      }
      for (const side of original.side_data_list ?? []) {
        if (
          /DOVI|Dolby|Mastering display|Content light/i.test(
            side.side_data_type,
          )
        ) {
          const match = saved.side_data_list?.find(
            (s: any) => s.side_data_type === side.side_data_type,
          );
          if (!match || JSON.stringify(side) !== JSON.stringify(match))
            throw new Error("HDR／杜比元数据未完整保留，已保留源轨");
        }
      }
    }
  }
  if (!transcoded)
    for (const input of inputs)
      for (const side of input.frameMetadata ?? []) {
        const match = output.frameMetadata?.find(
          (s: any) => s.side_data_type === side.side_data_type,
        );
        if (!match || JSON.stringify(side) !== JSON.stringify(match))
          throw new Error("首帧 HDR／杜比元数据未完整保留");
      }
  const durations = inputs
    .map((i) => Number(i.format?.duration))
    .filter(Number.isFinite);
  const duration = Number(output.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("成品时长无效");
  if (
    durations.length &&
    Math.abs(Math.max(...durations) - duration) >
      Math.max(0.25, Math.max(...durations) * 0.005)
  )
    throw new Error("成品与源时长不一致");
}
async function direct(
  url: string,
  path: string,
  signal: AbortSignal,
  onBytes: (bytes: number) => void,
  sourceIdentity = digest(url),
): Promise<void> {
  const part = path + ".part",
    metaPath = path + ".checkpoint.json";
  let offset = 0,
    checkpoint: any;
  try {
    const complete = JSON.parse(
      await readFile(path + ".complete.json", "utf8"),
    );
    const existing = await stat(path);
    if (
      complete.identity === sourceIdentity &&
      complete.etag &&
      existing.size === complete.size
    ) {
      const check = await fetch(url, { method: "HEAD", signal });
      if (
        check.ok &&
        check.headers.get("etag") === complete.etag &&
        Number(check.headers.get("content-length")) === existing.size
      ) {
        onBytes(existing.size);
        return;
      }
    }
  } catch (error) {
    if (signal.aborted) throw error;
  }
  try {
    checkpoint = JSON.parse(await readFile(metaPath, "utf8"));
    offset = (await stat(part)).size;
    if (!checkpoint.etag || checkpoint.url !== sourceIdentity) offset = 0;
  } catch {
    offset = 0;
  }
  const headers: Record<string, string> = {};
  if (offset) {
    headers.Range = `bytes=${offset}-`;
    headers["If-Range"] = checkpoint.etag;
  }
  const response = await fetch(url, { signal, headers });
  if (!response.ok) throw new Error(`媒体下载返回 HTTP ${response.status}。`);
  if (offset && response.status === 206) {
    if (
      !response.headers.get("content-range")?.startsWith(`bytes ${offset}-`) ||
      response.headers.get("etag") !== checkpoint.etag
    )
      throw new Error("源文件身份或 Range 不一致，不能继续拼接。");
  } else offset = 0;
  if (!response.body) throw new Error("媒体响应为空");
  const etag = response.headers.get("etag");
  const strongEtag = etag && !etag.startsWith("W/") ? etag : undefined;
  await writeFile(
    metaPath,
    JSON.stringify({ url: sourceIdentity, etag: strongEtag }),
    { mode: 0o600 },
  );
  let bytes = offset;
  const meter = new Transform({
    transform(chunk, _, cb) {
      bytes += chunk.length;
      onBytes(bytes);
      cb(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as any),
    meter,
    createWriteStream(part, { flags: offset ? "a" : "w", mode: 0o600 }),
    { signal },
  );
  const length = Number(response.headers.get("content-length"));
  if (length && bytes - offset !== length)
    throw new Error("响应不完整，未提交下载文件");
  await rename(part, path);
  await writeFile(
    path + ".complete.json",
    JSON.stringify({ identity: sourceIdentity, etag: strongEtag, size: bytes }),
    { mode: 0o600 },
  );
  await rm(metaPath, { force: true });
}
