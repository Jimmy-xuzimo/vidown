import { listenLoopback } from "../src/core/loopback";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, stat, copyFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { createCipheriv, randomBytes } from "node:crypto";
import { command } from "../src/core/process";
import type { Tools } from "../src/core/engine";
export async function createFixtures(directory: string, tools: Tools) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  for (const dir of ["video", "audio", "fmp4", "range", "aes", "dash"])
    await mkdir(join(root, dir), { recursive: true });
  const video = [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24",
    "-t",
    "6",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "24",
    "-sc_threshold",
    "0",
    "-an",
  ];
  const hls = ["-hls_time", "1", "-hls_playlist_type", "vod"];
  const ff = async (args: string[], cwd = root) =>
    command(
      tools.ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args],
      { timeout: 120000, cwd },
    );
  await ff([
    ...video,
    ...hls,
    "-hls_segment_filename",
    join(root, "video", "seg-%03d.ts"),
    join(root, "video", "index.m3u8"),
  ]);
  await ff([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "6",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-vn",
    ...hls,
    "-hls_segment_filename",
    join(root, "audio", "seg-%03d.ts"),
    join(root, "audio", "index.m3u8"),
  ]);
  await ff(
    [
      ...video,
      ...hls,
      "-hls_segment_type",
      "fmp4",
      "-hls_segment_filename",
      join(root, "fmp4", "seg-%03d.m4s"),
      join(root, "fmp4", "index.m3u8"),
    ],
    join(root, "fmp4"),
  );
  await ff([
    ...video,
    ...hls,
    "-hls_flags",
    "single_file",
    "-hls_segment_filename",
    join(root, "range", "stream.ts"),
    join(root, "range", "index.m3u8"),
  ]);
  await ff([...video, join(root, "direct.mp4")]);
  // Synthetic 1.25 s HEVC Main10/HDR10 test pattern, generated from lavfi.
  // Keep the encoded fixture fixed; production remuxing does not need an HEVC encoder.
  await copyFile(resolve("tests/fixtures/hdr10.mp4"), join(root, "hdr10.mp4"));
  await ff([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=1000:sample_rate=96000",
    "-t",
    "1.25",
    "-ac",
    "2",
    "-c:a",
    "flac",
    "-sample_fmt",
    "s32",
    join(root, "hires.flac"),
  ]);
  await ff(
    [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "6",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "24",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-f",
      "dash",
      "-seg_duration",
      "1",
      "-use_template",
      "1",
      "-use_timeline",
      "1",
      "-init_seg_name",
      "init-$RepresentationID$.m4s",
      "-media_seg_name",
      "chunk-$RepresentationID$-$Number%05d$.m4s",
      join(root, "dash", "manifest.mpd"),
    ],
    join(root, "dash"),
  );
  await writeFile(
    join(root, "master.m3u8"),
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Test AAC",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=640x360,CODECS="avc1.42c01e,mp4a.40.2",AUDIO="audio"\nvideo/index.m3u8\n',
  );
  const keyA = randomBytes(16),
    keyB = randomBytes(16);
  await writeFile(join(root, "aes", "key-a.bin"), keyA);
  await writeFile(join(root, "aes", "key-b.bin"), keyB);
  const lines = (
    await readFile(join(root, "video", "index.m3u8"), "utf8")
  ).split(/\r?\n/);
  const encrypted: string[] = [];
  let index = 0;
  for (const line of lines) {
    if (line && !line.startsWith("#")) {
      const iv = Buffer.alloc(16);
      iv.writeUInt32BE(index, 12);
      const key = index % 2 ? keyB : keyA;
      const cipher = createCipheriv("aes-128-cbc", key, iv);
      await writeFile(
        join(root, "aes", line),
        Buffer.concat([
          cipher.update(await readFile(join(root, "video", line))),
          cipher.final(),
        ]),
      );
      encrypted.push(
        `#EXT-X-KEY:METHOD=AES-128,URI="key-${index % 2 ? "b" : "a"}.bin",IV=0x${iv.toString("hex")}`,
        line,
      );
      index++;
    } else encrypted.push(line);
  }
  await writeFile(join(root, "aes", "index.m3u8"), encrypted.join("\n"));
  let requests: {
    path: string;
    range?: string;
    authorized: boolean;
    completed?: boolean;
  }[] = [];
  let slow = false;
  let slowSegments = false;
  let generation = 1;
  let manifestChanged = false;
  let origin = "",
    mediaOrigin = "";
  let pageIsolation: { appAPI: string | null; node: string | null } | undefined;
  const server = createServer(async (req, res) => {
    try {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/isolation") {
        pageIsolation = {
          appAPI: url.searchParams.get("appAPI"),
          node: url.searchParams.get("node"),
        };
        res.writeHead(204).end();
        return;
      }
      if (url.pathname === "/login") {
        res
          .writeHead(302, {
            "set-cookie":
              "vidown_fixture=allowed; HttpOnly; SameSite=Lax; Path=/",
            location: "/player",
          })
          .end();
        return;
      }
      if (url.pathname === "/player") {
        res
          .writeHead(200, { "content-type": "text/html" })
          .end(
            `<!doctype html><title>Vidown session fixture</title><h1>Vidown session fixture</h1><video controls src="${mediaOrigin}/auth/direct.mp4"></video><script>fetch("${mediaOrigin}/auth/master.m3u8",{credentials:"include"});fetch('/isolation?appAPI='+encodeURIComponent(typeof window.vidown)+'&node='+encodeURIComponent(typeof require));</script>`,
          );
        return;
      }
      const allowed = (req.headers.cookie ?? "").includes(
        "vidown_fixture=allowed",
      );
      const record = {
        path: url.pathname,
        range: req.headers.range,
        authorized: allowed,
        completed: false,
      };
      requests.push(record);
      res.once("finish", () => {
        record.completed = true;
      });
      if (!allowed) {
        res.writeHead(403).end("Fixture login required");
        return;
      }
      const relative = decodeURIComponent(
        url.pathname.replace(/^\/auth\//, ""),
      );
      const path = resolve(root, relative);
      if (!path.startsWith(root + requireSeparator())) {
        res.writeHead(404).end();
        return;
      }
      let data = await readFile(path);
      if (manifestChanged && path.endsWith(".m3u8"))
        data = Buffer.concat([
          data,
          Buffer.from("\n#source-generation-changed\n"),
        ]);
      const etag = `"fixture-${generation}-${data.length}"`;
      const type: Record<string, string> = {
        ".m3u8": "application/vnd.apple.mpegurl",
        ".mpd": "application/dash+xml",
        ".ts": "video/mp2t",
        ".m4s": "video/iso.segment",
        ".mp4": "video/mp4",
        ".flac": "audio/flac",
        ".bin": "application/octet-stream",
      };
      let start = 0,
        end = data.length - 1,
        partial = false;
      if (
        req.headers.range &&
        (!req.headers["if-range"] || req.headers["if-range"] === etag)
      ) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        if (!range) {
          res.writeHead(416).end();
          return;
        }
        start = Number(range[1]);
        end = range[2] ? Math.min(Number(range[2]), end) : end;
        partial = true;
      }
      if (start > end) {
        res.writeHead(416, { "content-range": `bytes */${data.length}` }).end();
        return;
      }
      res.writeHead(partial ? 206 : 200, {
        "content-type": type[extname(path)] ?? "application/octet-stream",
        "content-length": String(end - start + 1),
        "accept-ranges": "bytes",
        etag,
        ...(partial
          ? { "content-range": `bytes ${start}-${end}/${data.length}` }
          : {}),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      if (slow && relative === "direct.mp4") {
        let position = start;
        const timer = setInterval(() => {
          if (res.destroyed) {
            clearInterval(timer);
            return;
          }
          const next = Math.min(position + 4096, end + 1);
          res.write(data.subarray(position, next));
          position = next;
          if (position > end) {
            clearInterval(timer);
            res.end();
          }
        }, 25);
        res.on("close", () => clearInterval(timer));
      } else if (slowSegments && relative.endsWith(".ts")) {
        const timer = setTimeout(() => {
          if (!res.destroyed) res.end(data.subarray(start, end + 1));
        }, 350);
        res.once("close", () => clearTimeout(timer));
      } else res.end(data.subarray(start, end + 1));
    } catch {
      if (!res.headersSent) res.writeHead(404).end();
      else res.destroy();
    }
  });
  await listenLoopback(server);
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const mediaServer = createServer(server.listeners("request")[0] as any);
  await listenLoopback(mediaServer);
  mediaOrigin = `http://127.0.0.1:${(mediaServer.address() as any).port}`;
  return {
    origin,
    root,
    get pageIsolation() {
      return pageIsolation;
    },
    get requests() {
      return requests;
    },
    reset() {
      requests = [];
    },
    setSlow(value: boolean) {
      slow = value;
    },
    setSlowSegments(value: boolean) {
      slowSegments = value;
    },
    changeSource() {
      generation++;
    },
    changeManifest() {
      manifestChanged = true;
    },
    async close() {
      server.closeAllConnections();
      mediaServer.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await new Promise<void>((r) => mediaServer.close(() => r()));
    },
  };
}
function requireSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}
