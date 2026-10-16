import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command } from "./process";
import type { Tools } from "./engine";
import type { PrivateTrack } from "../shared/types";
import { parseIsoDuration } from "./manifest";
const list = (v: any): any[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

export function splitDashPeriods(
  text: string,
  track: PrivateTrack,
): { text: string; duration?: number }[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("不接受带外部实体的 MPD");
  const options = { ignoreAttributes: false, attributeNamePrefix: "@_" };
  const doc = new XMLParser(options).parse(text);
  const periods = list(doc.MPD?.Period);
  if (periods.length <= 1) return [{ text }];
  const total = parseIsoDuration(doc.MPD["@_mediaPresentationDuration"]);
  const result: { text: string; duration: number }[] = [];
  let end = 0,
    signature: string | undefined;
  for (let index = 0; index < periods.length; index++) {
    const period = periods[index];
    const start = parseIsoDuration(period["@_start"]) ?? end;
    const next =
      index + 1 < periods.length
        ? parseIsoDuration(periods[index + 1]["@_start"])
        : total;
    const duration =
      parseIsoDuration(period["@_duration"]) ??
      (next === undefined ? undefined : next - start);
    if (duration === undefined || duration <= 0 || Math.abs(start - end) > 0.1)
      throw new Error(
        "DASH 多 Period 的时间范围不完整或存在间隔，不能安全拼接。",
      );
    end = start + duration;
    let selected: any, adaptation: any;
    for (const adapt of list(period.AdaptationSet))
      for (const rep of list(adapt.Representation)) {
        const kind = /audio/.test(
          rep["@_mimeType"] ??
            adapt["@_mimeType"] ??
            adapt["@_contentType"] ??
            "",
        )
          ? "audio"
          : "video";
        if (String(rep["@_id"]) === track.engineId && kind === track.kind) {
          selected = rep;
          adaptation = adapt;
        }
      }
    if (!selected)
      throw new Error(
        "所选轨道并未覆盖每一个 DASH Period，请重新选择；本版不自动替换缺失轨道。",
      );
    const current = JSON.stringify([
      selected["@_codecs"] ?? adaptation["@_codecs"],
      selected["@_width"],
      selected["@_height"],
      selected["@_audioSamplingRate"],
      adaptation["@_lang"],
    ]);
    if (signature !== undefined && signature !== current)
      throw new Error(
        "DASH 跨 Period 的编码、分辨率或语言发生变化，不能无损拼接。",
      );
    signature = current;
    const single = structuredClone(doc);
    single.MPD.Period = structuredClone(period);
    single.MPD.Period["@_start"] = "PT0S";
    single.MPD.Period["@_duration"] = `PT${duration}S`;
    single.MPD["@_mediaPresentationDuration"] = `PT${duration}S`;
    result.push({
      text: new XMLBuilder({
        ...options,
        suppressBooleanAttributes: false,
      }).build(single),
      duration,
    });
  }
  return result;
}

export async function downloadAdaptive(
  track: PrivateTrack,
  text: string,
  folder: string,
  tools: Tools,
  signal: AbortSignal,
): Promise<string> {
  const periods =
    track.protocol === "dash" ? splitDashPeriods(text, track) : [{ text }];
  const files: string[] = [];
  let signature: string | undefined;
  for (let index = 0; index < periods.length; index++) {
    const target =
      periods.length === 1 ? folder : join(folder, `period-${index}`);
    await mkdir(target, { recursive: true });
    let source = track.url;
    if (periods.length > 1) {
      source = join(target, "manifest.mpd");
      await writeFile(source, periods[index].text);
    }
    const args = [
      source,
      "--save-dir",
      target,
      "--tmp-dir",
      join(target, "parts"),
      "--save-name",
      "media",
      "--auto-select",
      "--no-log",
      "--log-level",
      "WARN",
      "--thread-count",
      "4",
      "--download-retry-count",
      "3",
      "--del-after-done",
      "false",
      "--disable-update-check",
      "--use-system-proxy",
      "false",
      "--ffmpeg-binary-path",
      tools.ffmpeg,
    ];
    if (track.protocol === "dash") {
      if (!track.selector)
        throw new Error("缺少 DASH 轨道选择信息，请重新探测");
      args.push(
        track.kind === "audio" ? "--select-audio" : "--select-video",
        track.selector,
        track.kind === "audio" ? "--drop-video" : "--drop-audio",
        "all",
        "--drop-subtitle",
        "all",
      );
    }
    await command(tools.m3u8, args, {
      signal,
      timeout: 24 * 3600 * 1000,
      maxOutput: 1024 * 1024,
    });
    const media = (await readdir(target, { withFileTypes: true })).filter(
      (f) => f.isFile() && !/\.(json|log|txt|tmp|mpd)$/i.test(f.name),
    );
    if (media.length !== 1)
      throw new Error(
        `下载器输出 ${media.length} 个媒体文件，不能确定所选轨道，已保留临时文件。`,
      );
    const path = join(target, media[0].name);
    files.push(path);
    if (periods.length > 1) {
      const info = JSON.parse(
        await command(
          tools.ffprobe,
          [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-show_data_hash",
            "sha256",
            "-of",
            "json",
            path,
          ],
          { signal },
        ),
      );
      const selected = info.streams.filter(
        (s: any) => s.codec_type === track.kind,
      );
      if (
        selected.length !== 1 ||
        Math.abs(Number(info.format.duration) - periods[index].duration!) >
          Math.max(0.25, periods[index].duration! * 0.005)
      )
        throw new Error("DASH Period 结果不完整，不能拼接。");
      const current = JSON.stringify(
        selected.map((s: any) => [
          s.codec_name,
          s.width,
          s.height,
          s.sample_rate,
          s.channels,
          s.extradata_hash,
          s.color_transfer,
          s.color_space,
          s.color_primaries,
          s.side_data_list,
        ]),
      );
      if (signature !== undefined && signature !== current)
        throw new Error(
          "DASH Period 的实际编码配置不同，已保留源轨，未执行不可靠拼接。",
        );
      signature = current;
    }
  }
  if (files.length === 1) return files[0];
  const concat = join(folder, "periods.ffconcat");
  // All filenames are generated beneath this task. Quoting also handles a user path containing apostrophes.
  await writeFile(
    concat,
    "ffconcat version 1.0\n" +
      files
        .map(
          (path) =>
            `file '${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`,
        )
        .join("\n"),
  );
  const output = join(folder, "combined.mkv");
  await command(
    tools.ffmpeg,
    [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concat,
      "-map",
      track.kind === "audio" ? "0:a:0" : "0:v:0",
      "-c",
      "copy",
      output,
    ],
    { signal, timeout: 24 * 3600 * 1000 },
  );
  return output;
}
