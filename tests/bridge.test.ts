import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransportBridge } from "../src/core/bridge";
describe("session transport bridge", () => {
  it("aborts a stalled response and never commits its partial bytes as a complete segment", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "video/mp2t",
        "content-length": "100",
      });
      res.write("x");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const dir = await mkdtemp(join(tmpdir(), "vidown-stall-"));
    const bridge = new TransportBridge(
      fetch,
      dir,
      () => ({}),
      () => {},
      { stallTimeoutMs: 100 },
    );
    try {
      await bridge.start();
      const url = bridge.register(
        `http://127.0.0.1:${(server.address() as any).port}/segment.ts`,
        true,
      );
      await expect(
        fetch(url).then((response) => response.arrayBuffer()),
      ).rejects.toThrow();
      await bridge.close();
      expect(bridge.lastError).toContain("停滞超时");
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await bridge.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("rechecks direct resources instead of serving stale segment cache", async () => {
    let generation = 0;
    const server = createServer((_req, res) =>
      res
        .writeHead(200, { "content-type": "video/mp4", "content-length": "1" })
        .end(String(++generation)),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const dir = await mkdtemp(join(tmpdir(), "vidown-direct-"));
    const bridge = new TransportBridge(fetch, dir);
    try {
      await bridge.start();
      const url = bridge.register(
        `http://127.0.0.1:${(server.address() as any).port}/direct.mp4`,
      );
      expect(await (await fetch(url)).text()).toBe("1");
      expect(await (await fetch(url)).text()).toBe("2");
    } finally {
      await bridge.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("rewrites manifests, templates, init and range requests while keeping upstream credentials scoped", async () => {
    const requests: { url: string; cookie?: string; range?: string }[] = [];
    const server = createServer((req, res) => {
      requests.push({
        url: req.url!,
        cookie: req.headers.cookie,
        range: req.headers.range,
      });
      if (req.headers.cookie !== "fixture=allowed") {
        res.writeHead(403).end();
        return;
      }
      if (req.url === "/master")
        res
          .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
          .end(
            '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST',
          );
      else
        res
          .writeHead(req.headers.range ? 206 : 200, {
            "content-type": "video/mp2t",
            "content-length": "4",
            ...(req.headers.range ? { "content-range": "bytes 0-3/4" } : {}),
          })
          .end("data");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    const dir = await mkdtemp(join(tmpdir(), "vidown-bridge-"));
    const bridge = new TransportBridge(
      fetch,
      dir,
      (url): Record<string, string> =>
        new URL(url).origin === origin ? { Cookie: "fixture=allowed" } : {},
    );
    try {
      await bridge.start();
      const entry = bridge.register(origin + "/master");
      const text = await (await fetch(entry)).text();
      expect(text).not.toContain(origin);
      expect(text).toContain("#EXT-X-KEY");
      const segment = text.split("\n").find((l) => l.startsWith("http"))!;
      expect(
        await (
          await fetch(segment, { headers: { Range: "bytes=0-3" } })
        ).text(),
      ).toBe("data");
      expect(requests.at(-1)?.range).toBe("bytes=0-3");
      const cachedCount = requests.length;
      expect(
        await (
          await fetch(segment, { headers: { Range: "bytes=0-3" } })
        ).text(),
      ).toBe("data");
      expect(requests).toHaveLength(cachedCount);
      const forbidden = new URL(entry);
      forbidden.pathname = forbidden.pathname.replace(
        /\/[a-f0-9]+\//,
        "/wrong/",
      );
      expect((await fetch(forbidden)).status).toBe(404);
      const xml = bridge.rewrite(
        '<MPD><Period><AdaptationSet><Representation id="v"><BaseURL>video/</BaseURL><SegmentTemplate media="chunk-$Number%05d$.m4s" initialization="init.mp4"/></Representation></AdaptationSet></Period></MPD>',
        origin + "/manifest.mpd",
      );
      expect(xml).not.toContain(origin);
      const template = xml.match(/media="([^"]+)"/)![1];
      await fetch(template.replace("$Number%05d$", "00001"));
      expect(requests.at(-1)?.url).toBe("/video/chunk-00001.m4s");
    } finally {
      await bridge.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("does not forward authorization across redirect destinations", async () => {
    let leaked = false;
    const destination = createServer((req, res) => {
      leaked = !!req.headers.authorization;
      res.end("safe");
    });
    await new Promise<void>((r) => destination.listen(0, "127.0.0.1", r));
    const second = `http://127.0.0.1:${(destination.address() as any).port}`;
    const source = createServer((_req, res) =>
      res.writeHead(302, { location: second + "/resource" }).end(),
    );
    await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
    const first = `http://127.0.0.1:${(source.address() as any).port}`;
    const dir = await mkdtemp(join(tmpdir(), "vidown-redirect-"));
    const b = new TransportBridge(fetch, dir, (url): Record<string, string> =>
      new URL(url).origin === first
        ? { Authorization: "test-private-token" }
        : {},
    );
    try {
      await b.start();
      expect(await (await fetch(b.register(first + "/start"))).text()).toBe(
        "safe",
      );
      expect(leaked).toBe(false);
    } finally {
      await b.close();
      source.closeAllConnections();
      destination.closeAllConnections();
      await Promise.all([
        new Promise<void>((r) => source.close(() => r())),
        new Promise<void>((r) => destination.close(() => r())),
      ]);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
