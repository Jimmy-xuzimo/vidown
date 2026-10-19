import { describe, it, expect } from "vitest";
import { pgcTarget, probePgc } from "../src/core/bilibili-pgc";

const context = { id: "test", profile: "browser" };
const season = {
  code: 0,
  result: {
    title: "电影",
    episodes: [
      { id: 5990057, title: "潮汕话版" },
      { id: 6523988, title: "普通话版" },
    ],
    section: [{ episodes: [{ id: 123, title: "预告片" }] }],
  },
};
const video = {
  id: 126,
  base_url: "https://cdn.example/v.m4s?signature=exact",
  codecs: "hev1.2.4.L153.B0",
  width: 3840,
  height: 2160,
  frame_rate: "60000/1001",
  bandwidth: 9000000,
  backup_url: [
    "https://backup.example/v.m4s?signature=original",
    "file:///secret",
  ],
};
const play = {
  code: 0,
  result: {
    video_info: {
      timelength: 100000,
      dash: {
        video: [video],
        audio: [
          {
            id: 30280,
            codecs: "mp4a.40.2",
            baseUrl: "https://cdn.example/a.m4s",
            bandwidth: 192000,
          },
        ],
      },
    },
  },
};
const get = async (url: string) => (url.includes("season?") ? season : play);

describe("single episode web playback", () => {
  it("recognizes desktop and mobile film/season/episode links with tracking parameters", () => {
    expect(
      pgcTarget("https://m.bilibili.com/bangumi/play/ss231879?theme=movie"),
    ).toEqual({ key: "ss", id: "231879" });
    expect(pgcTarget("https://www.bilibili.com/bangumi/media/md12")).toEqual({
      key: "md",
      id: "12",
    });
    expect(
      pgcTarget("https://bilibili.com.evil.example/bangumi/play/ep12"),
    ).toBeUndefined();
  });
  it("lists voice versions without extracting/downloading the entire season", async () => {
    const called: string[] = [];
    const asset = await probePgc(
      "https://www.bilibili.com/bangumi/play/ss231879",
      context,
      async (u) => {
        called.push(u);
        return season;
      },
    );
    expect(called).toHaveLength(1);
    expect(asset.tracks).toHaveLength(0);
    expect(asset.episodes?.map((e) => e.title)).toEqual([
      "潮汕话版",
      "普通话版",
    ]);
  });
  it("preserves DV separate tracks, rational frame rate and exact signed backup URLs", async () => {
    const asset = await probePgc(
      "https://www.bilibili.com/bangumi/play/ep5990057",
      context,
      get,
    );
    expect(asset.tracks.map((t) => t.kind)).toEqual(["video", "audio"]);
    expect(asset.tracks[0].dynamicRange).toBe("DV");
    expect(asset.tracks[0].fps).toBeCloseTo(59.94, 2);
    expect(asset.tracks[0].fallbacks).toEqual([{ url: video.backup_url[0] }]);
  });
  it("does not represent a preview as the full film", async () => {
    const preview = {
      code: 0,
      result: {
        play_check: { play_detail: "PLAY_PREVIEW" },
        video_info: {
          is_preview: 1,
          timelength: 30000,
          durl: [{ url: "https://cdn.example/preview.mp4" }],
        },
      },
    };
    const asset = await probePgc(
      "https://www.bilibili.com/bangumi/play/ep5990057",
      context,
      async (u) => (u.includes("season?") ? season : preview),
    );
    expect(asset.tracks[0].kind).toBe("muxed");
    expect(asset.warnings.join()).toContain("试看");
    expect(asset.duration).toBe(30);
  });
  it("rejects DRM and reports missing entitlement without inventing tracks", async () => {
    for (const response of [
      { code: -10403 },
      { code: 0, result: { video_info: { is_drm: true } } },
    ]) {
      await expect(
        probePgc(
          "https://www.bilibili.com/bangumi/play/ep5990057",
          context,
          async (u) => (u.includes("season?") ? season : response),
        ),
      ).rejects.toThrow(/权限|DRM/);
    }
  });
});
