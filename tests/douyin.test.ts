import { describe, expect, it } from "vitest";
import {
  douyinVideoId,
  isDouyinPage,
  isDouyinDetailResponse,
} from "../src/shared/douyin";
import { fromDouyinData } from "../src/core/douyin";
import { publicAsset } from "../src/core/formats";

const id = "7666811827413601586";
const context = { id: "controlled", profile: "browser" };
const detail = () => ({
  aweme_id: id,
  desc: "Controlled media",
  video: {
    duration: 6000,
    width: 640,
    height: 360,
    play_addr: {
      url_list: ["https://cdn.example/original.mp4?sign=private"],
      width: 640,
      height: 360,
    },
    bit_rate: [
      {
        is_h265: 1,
        bit_rate: 5000000,
        play_addr: {
          width: 3840,
          height: 2160,
          url_list: [
            "https://cdn.example/4k.mp4?sign=private",
            "https://mirror.example/4k.mp4?sign=other",
          ],
        },
      },
    ],
  },
});

describe("browser-backed video detail extraction", () => {
  it("keeps exact long IDs for modal, video and share links and rejects host lookalikes", () => {
    expect(
      douyinVideoId(`https://www.douyin.com/jingxuan?modal_id=${id}`),
    ).toBe(id);
    expect(douyinVideoId(`https://www.douyin.com/video/${id}`)).toBe(id);
    expect(douyinVideoId(`https://www.iesdouyin.com/share/video/${id}/`)).toBe(
      id,
    );
    expect(isDouyinPage("https://v.douyin.com/abc/")).toBe(true);
    expect(
      isDouyinPage(`https://www.douyin.com.evil.example/video/${id}`),
    ).toBe(false);
    expect(isDouyinPage("https://name:password@www.douyin.com/")).toBe(false);
    expect(
      isDouyinDetailResponse(
        "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=" + id,
      ),
    ).toBe(true);
    expect(
      isDouyinDetailResponse(
        "https://www.douyin.com/aweme/v1/web/comment/list/",
      ),
    ).toBe(false);
  });
  it("preserves source sizes, bitrates and backups while keeping signed URLs private", () => {
    const asset = fromDouyinData({ aweme_detail: detail() }, id, context)!;
    expect(asset.tracks).toHaveLength(2);
    expect(asset.tracks[0]).toMatchObject({
      kind: "muxed",
      height: 2160,
      width: 3840,
      codec: "hevc",
      bitrate: 5000000,
    });
    expect(asset.tracks[0].fallbacks).toHaveLength(1);
    expect(asset.duration).toBe(6);
    expect(asset.pageUrl).toBe(`https://www.douyin.com/video/${id}`);
    expect(JSON.stringify(publicAsset(asset))).not.toContain("sign=");
    expect(JSON.stringify(publicAsset(asset))).not.toContain("mirror.example");
    expect(asset.tracks[1].audioCodec).toBeUndefined();
  });
  it("selects the exact requested video and never chooses a preloaded neighbour", () => {
    expect(
      fromDouyinData(
        { aweme_list: [{ ...detail(), aweme_id: "7666811827413601587" }] },
        id,
        context,
      ),
    ).toBeUndefined();
    expect(
      fromDouyinData(
        {
          aweme_list: [
            { ...detail(), aweme_id: "7666811827413601587" },
            detail(),
          ],
        },
        id,
        context,
      )?.title,
    ).toBe("Controlled media");
    expect(
      fromDouyinData({ ...detail(), aweme_id: Number(id) }, id, context),
    ).toBeUndefined();
  });
  it("accepts browser hydration camelCase without inventing audio or dynamic range", () => {
    const asset = fromDouyinData(
      {
        loaderData: {
          detail: {
            awemeId: id,
            video: {
              duration: 6000,
              bitRateList: [
                {
                  bitRate: 900000,
                  playAddr: {
                    urlList: ["https://cdn.example/file.mp4"],
                    width: 640,
                    height: 360,
                  },
                },
              ],
            },
          },
        },
      },
      id,
      context,
    )!;
    expect(asset.tracks[0].height).toBe(360);
    expect(asset.tracks[0].codec).toBeUndefined();
    expect(asset.tracks[0].dynamicRange).toBeUndefined();
    expect(asset.tracks[0].sampleRate).toBeUndefined();
  });
  it("refuses protected content, photo posts and unsafe media addresses", () => {
    const protectedMedia = detail();
    (protectedMedia.video as any).is_drm = true;
    expect(() => fromDouyinData(protectedMedia, id, context)).toThrow(/受保护/);
    expect(
      fromDouyinData({ aweme_id: id, images: [{}] }, id, context),
    ).toBeUndefined();
    expect(
      fromDouyinData(
        {
          aweme_id: id,
          video: {
            play_addr: {
              url_list: [
                "javascript:alert(1)",
                "https://user:secret@cdn.example/file",
              ],
            },
          },
        },
        id,
        context,
      ),
    ).toBeUndefined();
  });
});
