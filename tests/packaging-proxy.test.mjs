import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { listenLoopback } from "../src/core/loopback";

const run = promisify(execFile);
const child = fileURLToPath(
  new URL("./fixtures/packaging-proxy.cjs", import.meta.url),
);

describe("packaging downloader proxy compatibility", () => {
  it("excludes the vulnerable formatting dependency from the entire locked build chain", async () => {
    const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
    const packages = Object.keys(lock.packages);
    expect(
      packages.some((name) => /(^|\/)node_modules\/sprintf-js$/.test(name)),
    ).toBe(false);
    expect(
      packages.some((name) => /(^|\/)node_modules\/roarr$/.test(name)),
    ).toBe(false);
    expect(lock.packages["node_modules/global-agent"].version).toBe("4.1.3");
  });

  it("preserves real artifact downloads through an authenticated proxy and NO_PROXY bypass", async () => {
    const root = await mkdtemp(join(tmpdir(), "vidown-proxy-test-"));
    let originRequests = 0;
    const observed = [];
    const origin = createServer((_req, res) => {
      originRequests++;
      res.end("controlled-packaging-download");
    });
    const proxy = createServer((req, res) => {
      const target = new URL(req.url);
      if (target.origin !== `http://127.0.0.1:${origin.address().port}`) {
        res.writeHead(403);
        res.end();
        return;
      }
      observed.push({
        url: req.url,
        authorization: req.headers["proxy-authorization"],
      });
      // Do not forward proxy credentials to the origin.
      const headers = { ...req.headers };
      delete headers["proxy-authorization"];
      const forward = request(
        {
          hostname: "127.0.0.1",
          port: origin.address().port,
          path: target.pathname + target.search,
          method: req.method,
          headers,
          agent: false,
        },
        (upstream) => {
          res.writeHead(upstream.statusCode, upstream.headers);
          upstream.pipe(res);
        },
      );
      forward.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(forward);
    });
    try {
      await Promise.all([listenLoopback(origin), listenLoopback(proxy)]);
      const url = `http://127.0.0.1:${origin.address().port}/artifact?label=${encodeURIComponent("%.1000f")}`;
      const proxyUrl = `http://fixture:password@127.0.0.1:${proxy.address().port}`;
      const env = { ...process.env };
      for (const key of Object.keys(env))
        if (
          /proxy|^GLOBAL_AGENT_|^ELECTRON_GET_|^ROARR_|^NODE_OPTIONS$/i.test(
            key,
          )
        )
          delete env[key];
      Object.assign(env, {
        GLOBAL_AGENT_HTTP_PROXY: proxyUrl,
        GLOBAL_AGENT_HTTPS_PROXY: proxyUrl,
        GLOBAL_AGENT_NO_PROXY: "",
        ELECTRON_GET_NO_PROGRESS: "1",
      });
      await run(process.execPath, [child, url, join(root, "proxied.bin")], {
        env,
        timeout: 10000,
      });
      expect(observed).toEqual([
        {
          url,
          authorization: `Basic ${Buffer.from("fixture:password").toString("base64")}`,
        },
      ]);
      expect(originRequests).toBe(1);
      await run(process.execPath, [child, url, join(root, "direct.bin")], {
        env: { ...env, GLOBAL_AGENT_NO_PROXY: "127.0.0.1" },
        timeout: 10000,
      });
      expect(observed).toHaveLength(1);
      expect(originRequests).toBe(2);
    } finally {
      for (const server of [proxy, origin]) {
        server.closeAllConnections();
        const closed = once(server, "close");
        server.close();
        await closed;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
