import { randomUUID } from "node:crypto";
import type { PrivateAsset, RequestContextRef } from "../shared/types";
import { fromYtdlp } from "./formats";
import { httpUrl } from "./safety";

export function pgcTarget(
  value: string,
): { key: string; id: string } | undefined {
  const u = new URL(value);
  if (!/^(?:www\.|m\.)?bilibili\.com$/.test(u.hostname)) return;
  const m = u.pathname.match(
    /^\/bangumi\/(?:play\/(ep|ss)|media\/(md))(\d+)\/?$/,
  );
  if (m) return { key: m[1] || m[2], id: m[3] };
}

type JsonFetch = (url: string) => Promise<any>;

/** Public web playback APIs, using the caller's browser session. Never synthesize signatures. */
export async function probePgc(
  value: string,
  context: RequestContextRef,
  get: JsonFetch,
): Promise<PrivateAsset> {
  const target = pgcTarget(value);
  if (!target) throw new Error("请输入有效的影片或单集链接");
  const api = "https://api.bilibili.com/";
  if (target.key === "md") {
    const media = await get(api + "pgc/review/user?media_id=" + target.id);
    const season = media.result?.media?.season_id;
    if (!/^\d+$/.test(String(season)))
      throw new Error("影片信息不可用，请打开具体单集链接");
    return probePgc(
      `https://www.bilibili.com/bangumi/play/ss${season}`,
      context,
      get,
    );
  }
  const season = await get(
    api +
      "pgc/view/web/season?" +
      (target.key === "ep" ? "ep_id=" : "season_id=") +
      target.id,
  );
  if (season.code !== 0)
    throw new Error(
      `影片信息不可用（${season.code}）：${String(season.message || "请确认登录、地区和访问权限").slice(0, 180)}`,
    );
  // Prefer main episodes: sections often contain trailers and interviews.
  const main = season.result?.episodes || [];
  const episodes = (
    main.length
      ? main
      : (season.result?.section || []).flatMap((s: any) => s.episodes || [])
  )
    .filter((e: any) => /^\d+$/.test(String(e.id)))
    .slice(0, 1000)
    .filter(
      (e: any, i: number, all: any[]) =>
        all.findIndex((p) => String(p.id) === String(e.id)) === i,
    );
  if (target.key === "ss") {
    if (episodes.length === 1)
      return probePgc(
        `https://www.bilibili.com/bangumi/play/ep${episodes[0].id}`,
        context,
        get,
      );
    if (!episodes.length) throw new Error("尚无可用单集，或当前账号无权访问");
    return {
      id: randomUUID(),
      context,
      title: season.result.title || "选择单集或版本",
      pageUrl: `https://www.bilibili.com/bangumi/play/ss${target.id}`,
      tracks: [],
      warnings: [
        "请选择一个单集或配音版本，再选择保存规格。不会批量下载整季。",
      ],
      episodes: episodes.map((e: any) => ({
        title: [e.title, e.long_title].filter(Boolean).join(" · "),
        url: `https://www.bilibili.com/bangumi/play/ep${e.id}`,
      })),
    };
  }
  const episode = episodes.find((e: any) => String(e.id) === target.id);
  if (!episode) throw new Error("当前影片没有这个单集，请重新打开影片页选择");
  const pageUrl = `https://www.bilibili.com/bangumi/play/ep${target.id}`;
  const raw = await get(
    api +
      `pgc/player/web/v2/playurl?ep_id=${target.id}&fnval=12240&fnver=0&fourk=1&qn=127`,
  );
  const payload = raw.raw ?? raw.data ?? raw;
  const result = payload.result ?? payload.data ?? payload;
  const code = raw.code ?? payload.code;
  if (code && code !== 0)
    throw new Error(
      `播放权限不足或地区受限（${code}），请在浏览器确认本集可以完整播放后重试`,
    );
  const info = result.video_info ?? (result.dash || result.durl ? result : {});
  if (info.is_drm || info.drm_tech_type || result.is_drm)
    throw new Error("当前单集使用 DRM，无法保存受保护的媒体");
  const dash = info.dash ?? {};
  const formats = [
    ...(dash.video ?? []).map((s: any) => ({
      ...s,
      vcodec: s.codecs,
      acodec: "none",
      dynamic_range:
        Number(s.id) === 126 ? "DV" : Number(s.id) === 125 ? "HDR10" : "SDR",
    })),
    ...(dash.audio ?? []),
    ...(dash.dolby?.audio ?? []),
    ...(dash.flac?.audio ? [dash.flac.audio] : []),
  ]
    .filter((s: any) => !s.drm_type && !s.is_drm)
    .map((s: any, index: number) => ({
      format_id: String(index),
      url: s.baseUrl ?? s.base_url,
      width: s.width,
      height: s.height,
      fps:
        typeof s.frame_rate === "string" && s.frame_rate.includes("/")
          ? Number(s.frame_rate.split("/")[0]) /
            Number(s.frame_rate.split("/")[1])
          : Number(s.frame_rate || s.frameRate) || undefined,
      vcodec: s.vcodec ?? "none",
      acodec: s.acodec ?? s.codecs ?? "unknown",
      tbr: s.bandwidth ? s.bandwidth / 1000 : undefined,
      dynamic_range: s.dynamic_range,
      protocol: "https",
      _source: s,
    }));
  if (!formats.length) {
    const durl = info.durl ?? [];
    if (durl.length > 1)
      throw new Error(
        "当前单集仅返回多段旧式媒体，请在浏览器切换 DASH 画质后重试",
      );
    if (durl.length === 1)
      formats.push({
        format_id: "muxed",
        url: durl[0].url,
        vcodec: "unknown",
        acodec: "unknown",
        protocol: "https",
        _source: durl[0],
      } as any);
  }
  const asset = fromYtdlp(
    {
      title: [season.result.title, episode.title, episode.long_title]
        .filter(Boolean)
        .join(" · "),
      webpage_url: pageUrl,
      formats,
      duration: info.timelength ? info.timelength / 1000 : undefined,
    },
    context,
  );
  for (const track of asset.tracks) {
    const s: any = formats.find((f) => f.format_id === track.engineId)?._source;
    const backup = s?.backupUrl ?? s?.backup_url ?? [];
    track.fallbacks = (Array.isArray(backup) ? backup : [])
      .slice(0, 8)
      .flatMap((u: unknown) => {
        try {
          const url = httpUrl(String(u));
          return url.startsWith("https://") ? [{ url }] : [];
        } catch {
          return [];
        }
      });
  }
  if (
    info.is_preview ||
    result.is_preview ||
    ["PLAY_PREVIEW", "preview"].includes(
      result.play_check?.play_detail ?? result.play_video_type,
    )
  )
    asset.warnings.push(
      "当前账号仅获得试看内容，保存的不会是全片。请确认本集的会员或购买权限后重新解析。",
    );
  return asset;
}
