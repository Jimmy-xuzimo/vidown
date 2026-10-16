import { describe, it, expect } from "vitest";
import {
  fromYtdlp,
  publicAsset,
  chooseTracks,
  containerFor,
} from "../src/core/formats";
import { parseManifest } from "../src/core/manifest";
import { redact, safeName, httpUrl } from "../src/core/safety";
import { verifyMedia, verifySelectedTrack } from "../src/core/engine";
import { addBilibiliMirrors, isBilibiliPage } from "../src/core/bilibili";
import { splitDashPeriods } from "../src/core/adaptive";
const context = { id: "test", profile: "browser" };
describe("source-quality track contracts", () => {
  it("only attaches Bilibili mirrors to an exact media path and codec and keeps them private", () => {
    const asset = fromYtdlp(
      {
        title: "Bili",
        formats: [
          {
            format_id: "dv",
            url: "https://primary.example/aid/cid-1.m4s?sig=one",
            vcodec: "hvc1",
            acodec: "none",
            width: 3840,
            height: 2160,
          },
          {
            format_id: "other",
            url: "https://primary.example/other/cid-1.m4s",
            vcodec: "avc1",
            acodec: "none",
            height: 1080,
          },
        ],
      },
      context,
    );
    const html = `<script>window.__playinfo__=${JSON.stringify({ data: { dash: { video: [{ baseUrl: "https://primary.example/aid/cid-1.m4s?sig=two", codecs: "hvc1", backupUrl: ["https://backup.example/aid/cid-1.m4s?private=token", "javascript:bad", "https://name:password@evil.example/file"] }] } } })}</script>`;
    expect(addBilibiliMirrors(asset, html)).toBe(1);
    expect(asset.tracks[0].fallbacks).toHaveLength(2);
    expect(asset.tracks[1].fallbacks).toBeUndefined();
    expect(JSON.stringify(publicAsset(asset))).not.toContain("fallbacks");
    expect(JSON.stringify(publicAsset(asset))).not.toContain("backup.example");
    expect(isBilibiliPage("https://www.bilibili.com/video/BV123?p=2")).toBe(
      true,
    );
    expect(
      isBilibiliPage("https://bilibili.com.evil.example/video/BV123"),
    ).toBe(false);
  });
  it("keeps X audio-only HLS and HTTP variants when codec names are unknown", () => {
    const asset = fromYtdlp(
      {
        title: "X long video",
        webpage_url: "https://x.com/example/status/1",
        formats: [
          {
            format_id: "hls-audio-128",
            url: "https://cdn.example/audio.m3u8",
            protocol: "m3u8_native",
            vcodec: "none",
            audio_ext: "mp4",
            abr: 128,
            resolution: "audio only",
          },
          {
            format_id: "http-1080",
            url: "https://cdn.example/video.mp4",
            protocol: "https",
            width: 1922,
            height: 1080,
            video_ext: "mp4",
          },
          {
            format_id: "hls-1080",
            url: "https://cdn.example/video.m3u8",
            protocol: "m3u8_native",
            vcodec: "avc1.640032",
            acodec: "none",
            height: 1080,
          },
        ],
      },
      context,
    );
    const audio = asset.tracks.find((t) => t.kind === "audio");
    expect(audio).toBeDefined();
    expect(audio?.codec).toBeUndefined();
    expect(audio?.label).toContain("编码未知");
    expect(asset.tracks.find((t) => t.protocol === "http")?.kind).toBe("muxed");
    expect(
      chooseTracks(asset, [
        asset.tracks.find((t) => t.kind === "video")!.id,
        audio!.id,
      ]),
    ).toHaveLength(2);
  });
  it("preserves Bilibili 8K, DV and FLAC as independent choices and strips private URLs", () => {
    const a = fromYtdlp(
      {
        title: "sample",
        webpage_url: "https://example.com/watch?token=private",
        formats: [
          {
            format_id: "8k",
            url: "https://cdn.example/video?signature=secret",
            vcodec: "hev1",
            acodec: "none",
            height: 4320,
            fps: 60,
            tbr: 24000,
            protocol: "https",
          },
          {
            format_id: "dv",
            url: "https://cdn.example/dv",
            vcodec: "dvh1",
            acodec: "none",
            height: 2160,
            dynamic_range: "DV",
            protocol: "https",
          },
          {
            format_id: "flac",
            url: "https://cdn.example/audio",
            vcodec: "none",
            acodec: "flac",
            asr: 96000,
            abr: 2300,
            protocol: "https",
          },
        ],
      },
      context,
    );
    expect(a.tracks[0].height).toBe(4320);
    expect(a.tracks[1].dynamicRange).toBe("DV");
    expect(a.tracks[2].sampleRate).toBe(96000);
    const publicData = JSON.stringify(publicAsset(a));
    expect(publicData).not.toContain("signature");
    expect(publicData).not.toContain("secret");
    expect(publicData).not.toContain("engineId");
    expect(chooseTracks(a, [a.tracks[0].id, a.tracks[2].id])).toHaveLength(2);
    expect(() => chooseTracks(a, [a.tracks[0].id])).toThrow("音频");
    expect(containerFor([a.tracks[0], a.tracks[2]])).toBe("mkv");
    expect(containerFor([a.tracks[1]])).toBe("mkv");
  });
  it("does not silently download playlists or manufacture DRM formats", () => {
    expect(() =>
      fromYtdlp({ _type: "playlist", entries: [] }, context),
    ).toThrow("多项");
    expect(() =>
      fromYtdlp({ formats: [{ url: "https://x/a", has_drm: true }] }, context),
    ).toThrow("DRM");
  });
});
describe("manifest parsing", () => {
  it("requires a selected DASH representation and unchanged configuration in every contiguous Period", () => {
    const period = (id: number, height = 1080, rid = "v") =>
      `<Period id="${id}" start="PT${id * 6}S" duration="PT6S"><AdaptationSet mimeType="video/mp4"><Representation id="${rid}" height="${height}" codecs="avc1.640032"/></AdaptationSet></Period>`;
    const xml = `<MPD mediaPresentationDuration="PT12S">${period(0)}${period(1)}</MPD>`;
    const track = parseManifest(xml, "https://example.com/a.mpd", context)
      .tracks[0];
    expect(splitDashPeriods(xml, track)).toHaveLength(2);
    expect(splitDashPeriods(xml, track)[1].text).toContain(
      'mediaPresentationDuration="PT6S"',
    );
    expect(() =>
      splitDashPeriods(xml.replace(period(1), period(1, 720)), track),
    ).toThrow("发生变化");
    expect(() =>
      splitDashPeriods(xml.replace(period(1), period(1, 1080, "other")), track),
    ).toThrow("每一个");
    expect(() =>
      splitDashPeriods(xml.replace('start="PT6S"', 'start="PT7S"'), track),
    ).toThrow("间隔");
  });
  it("handles quoted CODECS and external audio groups", () => {
    const asset = parseManifest(
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",LANGUAGE="en",URI="audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="aac"\nvideo/index.m3u8\n',
      "https://example.com/master",
      context,
    );
    expect(asset.tracks).toHaveLength(2);
    expect(asset.tracks[0].kind).toBe("video");
    expect(asset.tracks[0].height).toBe(1080);
    expect(asset.tracks[1].url).toBe("https://example.com/audio/index.m3u8");
  });
  it("does not treat ordinary AES-128 as DRM and detects live media", () => {
    const aes =
      '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\na.ts\n';
    expect(
      parseManifest(
        aes + "#EXT-X-ENDLIST",
        "https://example.com/a.m3u8",
        context,
      ).warnings,
    ).toEqual([]);
    expect(
      parseManifest(aes, "https://example.com/a.m3u8", context).warnings[0],
    ).toContain("直播");
    expect(() =>
      parseManifest(
        aes.replace(
          "AES-128,",
          'SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery",',
        ),
        "https://example.com/a",
        context,
      ),
    ).toThrow("DRM");
  });
  it("selects stable DASH representation IDs, rejects protected and entity-bearing XML", () => {
    const xml =
      '<MPD type="static"><Period><AdaptationSet mimeType="video/mp4"><Representation id="v1" width="1920" height="1080" codecs="avc1.640028" bandwidth="2000000"/></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation id="a1" codecs="mp4a.40.2" bandwidth="128000"/></AdaptationSet></Period></MPD>';
    const a = parseManifest(xml, "https://example.com/manifest", context);
    expect(a.tracks.map((t) => t.kind)).toEqual(["video", "audio"]);
    expect(a.tracks[0].selector).toBe("id=^v1$:for=best");
    expect(() =>
      parseManifest(
        xml.replace(
          '<Representation id="v1"',
          '<ContentProtection schemeIdUri="urn:uuid:drm"/><Representation id="v1"',
        ),
        "https://example.com/manifest",
        context,
      ),
    ).toThrow("DRM");
    expect(() =>
      parseManifest(
        "<!DOCTYPE x>" + xml,
        "https://example.com/manifest",
        context,
      ),
    ).toThrow("实体");
  });
});
describe("result verification", () => {
  it("rejects a source with the wrong selected codec, resolution or full platform duration", () => {
    const track = {
      id: "video",
      url: "",
      label: "",
      kind: "video" as const,
      protocol: "http" as const,
      codec: "avc1.640032",
      height: 1080,
    };
    const info = {
      streams: [{ codec_type: "video", codec_name: "h264", height: 1080 }],
      format: { duration: "60" },
    };
    expect(() => verifySelectedTrack(track, info, 60)).not.toThrow();
    expect(() => verifySelectedTrack(track, info, 120)).toThrow("时长");
    expect(() => verifySelectedTrack({ ...track, height: 2160 }, info)).toThrow(
      "分辨率",
    );
    expect(() =>
      verifySelectedTrack({ ...track, codec: "hev1" }, info),
    ).toThrow("编码");
    expect(() =>
      verifySelectedTrack({ ...track, kind: "muxed" }, info, 60, true),
    ).toThrow("不含音频");
    expect(() =>
      verifySelectedTrack({ ...track, dynamicRange: "HDR10" }, info),
    ).toThrow("HDR10");
    expect(() =>
      verifySelectedTrack({ ...track, dynamicRange: "DV" }, info),
    ).toThrow("杜比视界");
  });
  const source = {
    streams: [
      {
        codec_type: "video",
        codec_name: "hevc",
        width: 3840,
        height: 2160,
        color_transfer: "smpte2084",
        side_data_list: [
          { side_data_type: "DOVI configuration record", dv_profile: 8 },
        ],
      },
      {
        codec_type: "audio",
        codec_name: "flac",
        sample_rate: "96000",
        channels: 2,
        bits_per_raw_sample: "24",
      },
    ],
    format: { duration: "6" },
  };
  it("accepts unchanged source parameters", () =>
    expect(() => verifyMedia([source], structuredClone(source))).not.toThrow());
  it("rejects stripped Dolby metadata, downgraded video, missing audio and shortened files", () => {
    const noDV = structuredClone(source);
    noDV.streams[0].side_data_list = [];
    expect(() => verifyMedia([source], noDV)).toThrow("元数据");
    const low = structuredClone(source);
    low.streams[0].width = 1920;
    expect(() => verifyMedia([source], low)).toThrow("width");
    const silent = structuredClone(source);
    silent.streams.pop();
    expect(() => verifyMedia([source], silent)).toThrow("audio");
    const short = structuredClone(source);
    short.format.duration = "2";
    expect(() => verifyMedia([source], short)).toThrow("时长");
  });
});
describe("input and diagnostic boundaries", () => {
  it("rejects non-web URLs and credentials embedded in URLs", () => {
    for (const u of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://name:secret@example.com",
    ])
      expect(() => httpUrl(u)).toThrow();
  });
  it("redacts signed URLs and full credential headers", () => {
    const result = redact(
      "https://example.com/media?token=secret\nAuthorization: Bearer very-secret\nCookie: sid=another-secret",
    );
    expect(result).not.toContain("very-secret");
    expect(result).not.toContain("another-secret");
    expect(result).not.toContain("?token");
  });
  it("sanitizes Windows reserved names and paths", () => {
    expect(safeName("CON")).toBe("video_CON");
    expect(safeName("a/b:c")).toBe("a_b_c");
  });
});
