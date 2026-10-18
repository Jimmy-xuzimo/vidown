import { randomUUID } from "node:crypto";
import type {
  PrivateAsset,
  PrivateTrack,
  RequestContextRef,
} from "../shared/types";
import { douyinVideoUrl } from "../shared/douyin";
import { httpUrl } from "./safety";

const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;

function urls(address: any): string[] {
  const list = Array.isArray(address)
    ? address
    : (address?.url_list ?? address?.urlList ?? []);
  return [
    ...new Set(
      (Array.isArray(list) ? list : [])
        .filter((v): v is string => typeof v === "string")
        .map((v) => {
          try {
            return httpUrl(v.startsWith("//") ? "https:" + v : v);
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    ),
  ];
}

/** Parse only normal webpage data. No private APIs, signing code or challenge bypass. */
export function fromDouyinData(
  data: unknown,
  videoId: string,
  context: RequestContextRef,
): PrivateAsset | undefined {
  const pending: { value: any; depth: number }[] = [{ value: data, depth: 0 }];
  let detail: any;
  const visited = new Set<object>();
  for (let n = 0; pending.length && n < 30000; n++) {
    const { value, depth } = pending.pop()!;
    if (!value || typeof value !== "object" || visited.has(value) || depth > 18)
      continue;
    visited.add(value);
    // IDs must remain strings: JSON numbers would already have lost precision.
    if (
      (value.aweme_id === videoId || value.awemeId === videoId) &&
      value.video
    ) {
      detail = value;
      break;
    }
    for (const child of Object.values(value))
      if (child && typeof child === "object")
        pending.push({ value: child, depth: depth + 1 });
  }
  if (!detail) return;
  const video = detail.video;
  if (video.is_drm || video.isDrm || video.drm_type || video.drmType)
    throw new Error("该媒体使用受保护的加密方式，无法保存");
  const rates = video.bit_rate ?? video.bitRateList ?? video.bitRate ?? [];
  const variants = [
    ...(Array.isArray(rates) ? rates : []),
    {
      play_addr: video.play_addr ?? video.playAddr,
      width: video.width,
      height: video.height,
    },
  ];
  const tracks: PrivateTrack[] = [];
  const seen = new Set<string>();
  for (const rate of variants) {
    if (!rate || typeof rate !== "object" || rate.is_drm || rate.isDrm)
      continue;
    const address = rate.play_addr ?? rate.playAddr;
    const locations = urls(address);
    if (!locations.length || seen.has(locations[0])) continue;
    seen.add(locations[0]);
    const width = positive(address?.width ?? rate.width ?? video.width);
    const height = positive(address?.height ?? rate.height ?? video.height);
    const bitrate = positive(rate.bit_rate ?? rate.bitRate);
    const fps = positive(rate.fps ?? video.fps);
    // Do not infer codec/HDR/audio parameters from quality names or device support.
    const encoded =
      rate.is_h265 ?? rate.isH265 ?? video.is_h265 ?? video.isH265;
    const codec = encoded === 1 || encoded === true ? "hevc" : undefined;
    const label = [
      height ? `${height}p` : "源清晰度",
      fps ? `${fps}fps` : "",
      codec ?? "编码待验证",
      bitrate ? `${Math.round(bitrate / 1000)} kbps` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    tracks.push({
      id: randomUUID(),
      kind: "muxed",
      protocol: "http",
      url: locations[0],
      fallbacks: locations.slice(1).map((url) => ({ url })),
      label,
      width,
      height,
      bitrate,
      fps,
      codec,
    });
  }
  tracks.sort(
    (a, b) =>
      (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0),
  );
  if (!tracks.length) return;
  return {
    id: randomUUID(),
    title: String(detail.desc ?? detail.caption ?? `视频 ${videoId}`).slice(
      0,
      500,
    ),
    pageUrl: douyinVideoUrl(videoId),
    context,
    tracks,
    duration: positive(video.duration ?? detail.duration)
      ? (video.duration ?? detail.duration) / 1000
      : undefined,
    warnings: [
      "仅显示当前网页实际返回的源规格；未知编码和音频参数将在保存后验证。",
    ],
  };
}
