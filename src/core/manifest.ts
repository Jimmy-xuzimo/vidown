import { Parser } from "m3u8-parser";
import { XMLParser } from "fast-xml-parser";
import { randomUUID } from "node:crypto";
import type {
  PrivateAsset,
  PrivateTrack,
  RequestContextRef,
} from "../shared/types";
import { publicUrl } from "./safety";
const list = (value: any): any[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const num = (value: any): number | undefined =>
  value === undefined ? undefined : Number(value);
export function parseIsoDuration(value: unknown): number | undefined {
  const m =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      String(value ?? ""),
    );
  if (!m || m.slice(1).every((v) => v === undefined)) return;
  const seconds =
    Number(m[1] ?? 0) * 86400 +
    Number(m[2] ?? 0) * 3600 +
    Number(m[3] ?? 0) * 60 +
    Number(m[4] ?? 0);
  return seconds;
}
export function parseManifest(
  text: string,
  url: string,
  context: RequestContextRef,
): PrivateAsset {
  const asset: PrivateAsset = {
    id: randomUUID(),
    title: new URL(url).pathname.split("/").pop() || "流媒体",
    pageUrl: publicUrl(url),
    context,
    tracks: [],
    warnings: [],
  };
  if (text.trimStart().startsWith("#EXTM3U")) {
    const parser = new Parser();
    parser.push(text);
    parser.end();
    const m = parser.manifest;
    if (/#EXT-X-KEY:.*(?:skd:|KEYFORMAT="(?!identity))/i.test(text))
      throw new Error("DRM 或不支持的密钥格式，不能按普通 AES-128 下载。");
    if (m.playlists?.length) {
      for (const p of m.playlists) {
        const a = p.attributes ?? {};
        asset.tracks.push({
          id: randomUUID(),
          kind: a.AUDIO ? "video" : "muxed",
          protocol: "hls",
          url: new URL(p.uri, url).href,
          label: `${a.RESOLUTION?.height ?? "?"}p · ${a.CODECS ?? "未知编码"} · ${a.BANDWIDTH ? Math.round(a.BANDWIDTH / 1000) + " kbps" : "码率未知"}`,
          height: a.RESOLUTION?.height,
          width: a.RESOLUTION?.width,
          fps: a["FRAME-RATE"],
          bitrate: a.BANDWIDTH,
          codec: String(a.CODECS ?? "").split(",")[0],
          audioCodec: String(a.CODECS ?? "").split(",")[1],
          dynamicRange: a["VIDEO-RANGE"],
          selector: a.AUDIO ? `audio-group:${a.AUDIO}` : undefined,
        });
      }
      for (const [group, members] of Object.entries(
        m.mediaGroups?.AUDIO ?? {},
      )) {
        for (const [name, a] of Object.entries(members as any) as [
          string,
          any,
        ][]) {
          if (a.uri)
            asset.tracks.push({
              id: randomUUID(),
              kind: "audio",
              protocol: "hls",
              url: new URL(a.uri, url).href,
              label: `音频 · ${name} · ${a.language ?? "未知语言"}`,
              language: a.language,
              selector: `audio-group:${group}`,
            });
        }
      }
      // AUDIO entries without URI are in-band; these variants already contain their audio.
      for (const t of asset.tracks)
        if (
          t.kind === "video" &&
          !asset.tracks.some(
            (a) => a.kind === "audio" && a.selector === t.selector,
          )
        )
          t.kind = "muxed";
    } else {
      if (!m.endList)
        asset.warnings.push("检测到直播或尚未结束的清单，本版不支持直播录制。");
      asset.duration = m.segments?.reduce(
        (sum: number, s: any) => sum + (s.duration ?? 0),
        0,
      );
      asset.tracks.push({
        id: randomUUID(),
        kind: "muxed",
        protocol: "hls",
        url,
        label: "当前播放清单 · 编码与码率待成品验证",
      });
    }
  } else {
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw new Error("不接受带外部实体的 MPD");
    const doc = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
    }).parse(text);
    const mpd = doc.MPD;
    if (!mpd) throw new Error("不是有效的 HLS／DASH 清单");
    asset.duration = parseIsoDuration(mpd["@_mediaPresentationDuration"]);
    if (mpd["@_type"] === "dynamic")
      asset.warnings.push("检测到 DASH 直播，本版不支持直播录制。");
    for (const period of list(mpd.Period))
      for (const adapt of list(period.AdaptationSet)) {
        if (adapt.ContentProtection)
          throw new Error(
            "DRM ContentProtection：该 DASH 媒体需要专用授权，不能普通下载。",
          );
        for (const rep of list(adapt.Representation)) {
          if (rep.ContentProtection) throw new Error("DRM ContentProtection");
          const rid = String(rep["@_id"] ?? "");
          if (!rid)
            throw new Error("DASH 缺少稳定轨道 ID，无法保证选择与恢复一致。");
          const mime = String(
            rep["@_mimeType"] ??
              adapt["@_mimeType"] ??
              adapt["@_contentType"] ??
              "",
          );
          const kind = /audio/.test(mime) ? "audio" : "video";
          if (asset.tracks.some((t) => t.engineId === rid && t.kind === kind))
            continue;
          const codec = rep["@_codecs"] ?? adapt["@_codecs"];
          const rate = String(rep["@_frameRate"] ?? adapt["@_frameRate"] ?? "");
          const [n, d] = rate.split("/").map(Number);
          asset.tracks.push({
            id: randomUUID(),
            kind,
            protocol: "dash",
            url,
            engineId: rid,
            selector: `id=^${rid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$:for=best`,
            label: `${kind === "audio" ? "音频" : (rep["@_height"] ?? "?") + "p"} · ${codec ?? "未知编码"} · ${rid}`,
            codec,
            height: num(rep["@_height"]),
            width: num(rep["@_width"]),
            bitrate: num(rep["@_bandwidth"]),
            language: adapt["@_lang"],
            sampleRate: num(rep["@_audioSamplingRate"]),
            fps: n ? (d ? n / d : n) : undefined,
          });
        }
      }
  }
  if (!asset.tracks.length) throw new Error("清单没有可下载的媒体轨道");
  return asset;
}
