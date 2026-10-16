import type { PrivateAsset } from "../shared/types";
import { httpUrl } from "./safety";

export function isBilibiliPage(value: string): boolean {
  const url = new URL(value);
  return (
    url.hostname === "b23.tv" ||
    (/^(?:www\.|m\.)?bilibili\.com$/.test(url.hostname) &&
      /^\/video\/(?:BV[\w]+|av\d+)/i.test(url.pathname))
  );
}

/** Read JSON only: never run a site's scripts or expose media URLs to the renderer. */
export function addBilibiliMirrors(asset: PrivateAsset, html: string): number {
  const match = html.match(
    /window\.__playinfo__\s*=\s*(\{.+?\})\s*;?\s*<\/script>/s,
  );
  if (!match) return 0;
  const info = JSON.parse(match[1]);
  const dash = info.data?.dash;
  if (!dash) return 0;
  const streams = [
    ...(Array.isArray(dash.video) ? dash.video : []),
    ...(Array.isArray(dash.audio) ? dash.audio : []),
    ...(Array.isArray(dash.dolby?.audio) ? dash.dolby.audio : []),
    ...(dash.flac?.audio ? [dash.flac.audio] : []),
  ].slice(0, 250);
  let enriched = 0;
  for (const track of asset.tracks) {
    if (track.protocol !== "http") continue;
    const path = new URL(track.url).pathname;
    const stream = streams.find((s) => {
      const source = s.baseUrl ?? s.base_url;
      try {
        return (
          new URL(source).pathname === path &&
          (!track.codec ||
            track.codec.toLowerCase() === String(s.codecs).toLowerCase())
        );
      } catch {
        return false;
      }
    });
    if (!stream) continue;
    const urls = [
      stream.baseUrl ?? stream.base_url,
      ...(stream.backupUrl ?? stream.backup_url ?? []),
    ];
    const alternatives: string[] = [];
    for (const value of urls.slice(0, 8)) {
      try {
        const url = httpUrl(value);
        if (
          url.startsWith("https://") &&
          url !== track.url &&
          !alternatives.includes(url)
        )
          alternatives.push(url);
      } catch {
        /* A malformed backup never invalidates the primary source. */
      }
    }
    if (alternatives.length) {
      track.fallbacks = alternatives.map((url) => ({ url }));
      enriched++;
    }
  }
  return enriched;
}
