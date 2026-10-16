import type {
  MediaAsset,
  PrivateAsset,
  PrivateTrack,
  RequestContextRef,
  Track,
} from "../shared/types";
import { publicUrl } from "./safety";
import { randomUUID } from "node:crypto";

export function fromYtdlp(info: any, context: RequestContextRef): PrivateAsset {
  if (info._type === "playlist" || Array.isArray(info.entries))
    throw new Error(
      "该链接包含多项内容，请打开具体视频或指定分 P；本版不抓取合集。",
    );
  const tracks: PrivateTrack[] = [];
  for (const f of info.formats ?? []) {
    if (
      !f.url ||
      f.has_drm ||
      f.vcodec === "images" ||
      /mhtml|storyboard/.test(f.protocol ?? "")
    )
      continue;
    const video = f.vcodec
      ? f.vcodec !== "none"
      : Boolean(f.width || f.height || (f.video_ext && f.video_ext !== "none"));
    const audio = f.acodec
      ? f.acodec !== "none"
      : f.vcodec === "none" &&
        Boolean(
          f.abr ||
          (f.audio_ext && f.audio_ext !== "none") ||
          f.resolution === "audio only",
        );
    if (!video && !audio) continue;
    const protocol = /m3u8/.test(f.protocol ?? "")
      ? "hls"
      : /dash_segments/.test(f.protocol ?? "")
        ? "dash"
        : "http";
    // Fragment-based platform formats need a manifest selector; never pretend the manifest itself is a complete file.
    if (protocol === "dash") continue;
    // HTTP variants without codec metadata may contain both streams; inspect the saved source before mapping.
    const unknownMuxed = video && !f.vcodec && !f.acodec && protocol === "http";
    const kind = video ? (audio || unknownMuxed ? "muxed" : "video") : "audio";
    const range =
      f.dynamic_range && f.dynamic_range !== "SDR"
        ? f.dynamic_range
        : undefined;
    const bits: string[] = [
      f.height ? `${f.height}p` : "音频",
      f.fps ? `${f.fps}fps` : "",
      range ?? "",
      (f.vcodec === "none" ? f.acodec : f.vcodec) || "编码未知",
      f.format_note ?? "",
      f.language ?? "",
    ];
    tracks.push({
      id: randomUUID(),
      engineId: String(f.format_id),
      kind,
      protocol,
      url: f.url,
      label: [...new Set(bits.filter(Boolean))].join(" · "),
      width: f.width,
      height: f.height,
      fps: f.fps,
      codec: video ? f.vcodec : f.acodec,
      audioCodec: audio ? f.acodec : undefined,
      bitrate:
        (f.tbr ?? f.abr ?? f.vbr)
          ? Math.round((f.tbr ?? f.abr ?? f.vbr) * 1000)
          : undefined,
      language: f.language,
      dynamicRange: range,
      sampleRate: f.asr,
      channels: f.audio_channels,
    });
  }
  tracks.sort(
    (a, b) =>
      (b.height ?? 0) - (a.height ?? 0) ||
      (b.fps ?? 0) - (a.fps ?? 0) ||
      (b.bitrate ?? 0) - (a.bitrate ?? 0),
  );
  if (!tracks.length)
    throw new Error(
      "没有可执行的非 DRM 媒体轨道。请在内置浏览器播放后探测；分片格式可能需要原始清单。",
    );
  return {
    id: randomUUID(),
    title: info.title || info.id || "未命名视频",
    pageUrl: publicUrl(info.webpage_url || info.original_url || ""),
    tracks,
    context,
    duration: info.duration,
    warnings: info.is_live ? ["检测到直播，本版不支持直播录制。"] : [],
  };
}
export function publicAsset(asset: PrivateAsset): MediaAsset {
  return {
    ...asset,
    tracks: asset.tracks.map(
      ({ url, selector, manifest, engineId, identity, ...track }) => track,
    ),
    context: undefined,
  } as MediaAsset;
}
export function chooseTracks(
  asset: PrivateAsset,
  ids: string[],
): PrivateTrack[] {
  if (!ids.length || ids.length > 2 || new Set(ids).size !== ids.length)
    throw new Error("请选择一个视频和至多一个音轨，或单独选择音频。");
  const tracks = ids.map((id) => asset.tracks.find((t) => t.id === id));
  if (tracks.some((t) => !t)) throw new Error("轨道已失效，请重新探测。");
  const selected = tracks as PrivateTrack[];
  if (
    selected.filter((t) => t.kind !== "audio").length > 1 ||
    selected.filter((t) => t.kind === "audio").length > 1 ||
    (selected.some((t) => t.kind === "muxed") && selected.length > 1)
  )
    throw new Error("该轨道组合不兼容。");
  if (
    selected.some((t) => t.kind === "video") &&
    !selected.some((t) => t.kind === "audio") &&
    asset.tracks.some((t) => t.kind === "audio")
  )
    throw new Error("该视频不含音频，请同时选择一个音轨。");
  if (asset.warnings.some((w) => w.includes("直播")))
    throw new Error("本版不支持直播录制。");
  const video = selected.find(
    (t) => t.kind === "video" && t.protocol === "hls",
  );
  const audio = selected.find(
    (t) => t.kind === "audio" && t.protocol === "hls",
  );
  if (
    video?.selector?.startsWith("audio-group:") &&
    audio?.selector !== video.selector
  )
    throw new Error("该音轨不属于所选视频的音频组。");
  return selected;
}
export function containerFor(tracks: Track[], compatible = false): string {
  if (compatible)
    return tracks.every((t) => t.kind === "audio") ? "m4a" : "mp4";
  const audioOnly = tracks.every((t) => t.kind === "audio");
  const codecs = tracks
    .map((t) => `${t.codec ?? ""} ${t.audioCodec ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (audioOnly)
    return /flac/.test(codecs)
      ? "flac"
      : /aac|mp4a/.test(codecs)
        ? "m4a"
        : "mka";
  return /flac|opus|vorbis|dts|truehd|vp[89]|vp0[89]/.test(codecs) ||
    tracks.some((t) => /DV|DOLBY/i.test(t.dynamicRange ?? ""))
    ? "mkv"
    : "mp4";
}
