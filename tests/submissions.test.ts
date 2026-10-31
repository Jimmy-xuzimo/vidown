import { it, expect, vi } from "vitest";
import { Submissions } from "../src/core/submissions";
import { automaticTracks } from "../src/core/formats";
import { mediaLinks } from "../src/shared/links";
import type {
  MediaAsset,
  PrivateAsset,
  PrivateTrack,
} from "../src/shared/types";

const asset = (id: string): MediaAsset => ({
  id,
  title: id,
  pageUrl: `https://example.org/${id}`,
  tracks: [],
  warnings: [],
});
const settle = async (queue: Submissions) => {
  await vi.waitFor(() => expect(queue.busy).toBe(false));
};
it("deduplicates input without dropping content parameters or permitting local/credential URLs", () => {
  expect(
    mediaLinks(
      "https://example.org/v?p=1\nhttps://example.org/v?p=2\nhttps://example.org/v?p=1",
    ),
  ).toHaveLength(2);
  expect(() => mediaLinks("file:///etc/passwd")).toThrow();
  expect(mediaLinks("分享：(https://example.org/watch?a=(b))")).toEqual([
    "https://example.org/watch?a=(b)",
  ]);
  expect(() => mediaLinks("https://user:password@example.org")).toThrow();
  expect(() =>
    mediaLinks(Array(51).fill("https://example.org").join("\n")),
  ).toThrow();
});
it("bounds parallel probes, isolates failures and retries only the failed link", async () => {
  let active = 0,
    peak = 0,
    fail = true;
  const probe = vi.fn(async (url: string) => {
    active++;
    peak = Math.max(active, peak);
    await new Promise((r) => setTimeout(r, 8));
    active--;
    if (url.endsWith("bad") && fail) throw Error("unavailable");
    return asset(url);
  });
  const enqueue = vi.fn(async (a: MediaAsset) => a.id);
  const queue = new Submissions({
    probe,
    enqueue,
    browser: () => false,
    error: String,
    changed: () => {},
  });
  const urls = ["https://e.org/a", "https://e.org/bad", "https://e.org/b"];
  queue.submit("request", urls);
  queue.submit("request", urls);
  expect(() => queue.submit("request", [urls[0]])).toThrow();
  await settle(queue);
  expect(peak).toBe(2);
  expect(queue.list().map((i) => i.state)).toEqual([
    "queued",
    "failed",
    "queued",
  ]);
  expect(enqueue).toHaveBeenCalledTimes(2);
  fail = false;
  queue.action(queue.list()[1].id, "retry");
  await settle(queue);
  expect(probe).toHaveBeenCalledTimes(4);
  expect(enqueue).toHaveBeenCalledTimes(3);
});
it("serializes browser-assisted probes while allowing ordinary extraction", async () => {
  let active = 0,
    peak = 0;
  const queue = new Submissions({
    probe: async (url) => {
      if (url.includes("web")) {
        active++;
        peak = Math.max(peak, active);
      }
      await new Promise((r) => setTimeout(r, 8));
      if (url.includes("web")) active--;
      return asset(url);
    },
    enqueue: async () => undefined,
    browser: (url) => url.includes("web"),
    error: String,
    changed: () => {},
  });
  queue.submit("a", [
    "https://e.org/web1",
    "https://e.org/web2",
    "https://e.org/plain",
  ]);
  await settle(queue);
  expect(peak).toBe(1);
  expect(queue.list().every((i) => i.state === "selection")).toBe(true);
  const first = queue.list()[0];
  expect(queue.pin(first.asset!.id)).toBe(true);
  queue.complete(first.asset!.id, "task");
  expect(queue.list()[0]).toMatchObject({
    state: "queued",
    taskId: "task",
    asset: undefined,
  });
});
it("cancels in-flight probes without enqueueing late results", async () => {
  let release!: (a: MediaAsset) => void;
  const enqueue = vi.fn(async () => "task");
  const queue = new Submissions({
    probe: () => new Promise((r) => (release = r)),
    enqueue,
    browser: () => false,
    error: String,
    changed: () => {},
  });
  queue.submit("a", ["https://e.org/v"]);
  expect(() => queue.clear()).toThrow();
  queue.action(queue.list()[0].id, "cancel");
  release(asset("v"));
  await settle(queue);
  expect(queue.list()[0].state).toBe("cancelled");
  expect(enqueue).not.toHaveBeenCalled();
});
const track = (
  id: string,
  kind: PrivateTrack["kind"],
  extra: Partial<PrivateTrack> = {},
): PrivateTrack => ({
  id,
  kind,
  label: id,
  protocol: "hls",
  url: `https://e.org/${id}`,
  ...extra,
});
const privateAsset = (
  tracks: PrivateTrack[],
  extra: Partial<PrivateAsset> = {},
): PrivateAsset => ({
  ...asset("sample"),
  tracks,
  context: { id: "ctx", profile: "browser" },
  ...extra,
});
it("auto-selects highest source video with matching HLS audio group", () => {
  const a = privateAsset([
    track("low", "video", { height: 720 }),
    track("high", "video", { height: 2160, selector: "audio-group:b" }),
    track("wrong", "audio", { bitrate: 900, selector: "audio-group:a" }),
    track("right", "audio", { bitrate: 200, selector: "audio-group:b" }),
  ]);
  expect(automaticTracks(a)?.map((t) => t.id)).toEqual(["high", "right"]);
});
it("retains explicit choices for warnings, episodes, multiple languages and browser saves", () => {
  expect(
    automaticTracks(
      privateAsset([track("v", "muxed")], { warnings: ["试看"] }),
    ),
  ).toBeUndefined();
  expect(
    automaticTracks(
      privateAsset([], {
        episodes: [{ title: "episode", url: "https://e.org/1" }],
      }),
    ),
  ).toBeUndefined();
  expect(
    automaticTracks(
      privateAsset([
        track("v", "video"),
        track("a", "audio", { language: "en" }),
        track("b", "audio", { language: "zh" }),
      ]),
    ),
  ).toBeUndefined();
  expect(
    automaticTracks(
      privateAsset([track("v", "muxed", { protocol: "browser" })]),
    ),
  ).toBeUndefined();
  expect(
    automaticTracks(
      privateAsset([track("v", "muxed"), track("a", "audio")]),
    )?.map((t) => t.id),
  ).toEqual(["v"]);
});
