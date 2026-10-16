import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { digest, httpUrl, redact } from "./safety";

export type SessionFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;
interface Resource {
  url: string;
  params: string[];
  cacheable: boolean;
}
/** A capability-addressed origin bridge. Never accepts a caller-provided destination URL. */
export class TransportBridge {
  lastError?: string;
  private server?: Server;
  private origin = "";
  private token = randomBytes(24).toString("hex");
  private resources = new Map<string, Resource>();
  private controllers = new Set<AbortController>();
  private active = new Set<Promise<unknown>>();
  private locks = new Map<string, Promise<void>>();
  private closed = false;
  constructor(
    private fetcher: SessionFetch,
    private cache: string,
    private headersFor: (url: string) => Record<string, string> = () => ({}),
    private onBytes: (n: number) => void = () => {},
  ) {}
  async start(): Promise<void> {
    await mkdir(this.cache, { recursive: true });
    this.server = createServer((req, res) => {
      const pending = (async () => {
        const controller = new AbortController();
        this.controllers.add(controller);
        let unlock: (() => void) | undefined;
        res.on("close", () => controller.abort());
        try {
          if (this.closed || !["GET", "HEAD"].includes(req.method ?? "")) {
            res.writeHead(405).end();
            return;
          }
          const parts = new URL(req.url ?? "/", "http://localhost").pathname
            .split("/")
            .filter(Boolean);
          const resource =
            parts[0] === this.token ? this.resources.get(parts[1]) : undefined;
          if (!resource || parts.length !== 2 + resource.params.length) {
            res.writeHead(404).end();
            return;
          }
          let target = resource.url;
          for (let i = 0; i < resource.params.length; i++) {
            const value = decodeURIComponent(parts[i + 2]);
            if (!/^[\w.-]+$/.test(value) || value === "." || value === "..")
              throw new Error("Invalid template value");
            target = target.replace(resource.params[i], value);
          }
          const headers = { ...this.headersFor(target) };
          if (req.headers.range) headers.Range = req.headers.range;
          if (req.headers["if-range"])
            headers["If-Range"] = String(req.headers["if-range"]);
          const key = digest(target + "\n" + (req.headers.range ?? ""));
          const previous = this.locks.get(key);
          let release!: () => void;
          const current = new Promise<void>((resolve) => {
            release = resolve;
          });
          this.locks.set(key, current);
          if (previous) await previous;
          unlock = () => {
            release();
            if (this.locks.get(key) === current) this.locks.delete(key);
          };
          const cached = join(this.cache, key);
          // Cache entries are committed only after a complete response. Partial bytes are never trusted.
          try {
            if (req.method === "GET" && resource.cacheable) {
              const meta = JSON.parse(await readFile(cached + ".json", "utf8"));
              const stream = createReadStream(cached);
              res.writeHead(meta.status, meta.headers);
              await pipeline(stream, res);
              return;
            }
          } catch {
            /* Cache miss. */
          }
          let upstream: Response | undefined;
          for (let redirects = 0; redirects <= 8; redirects++) {
            const scoped = { ...this.headersFor(target) };
            if (headers.Range) scoped.Range = headers.Range;
            if (headers["If-Range"]) scoped["If-Range"] = headers["If-Range"];
            upstream = await this.fetcher(target, {
              method: req.method,
              headers: scoped,
              signal: controller.signal,
              redirect: "manual",
            });
            if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
            const location = upstream.headers.get("location");
            await upstream.body?.cancel();
            if (!location || redirects === 8) throw new Error("Redirect limit");
            target = httpUrl(new URL(location, target).href);
          }
          if (!upstream) throw new Error("No response");
          const type = upstream.headers.get("content-type") ?? "";
          const out: Record<string, string> = {};
          for (const h of [
            "content-type",
            "content-length",
            "content-range",
            "accept-ranges",
            "etag",
            "last-modified",
          ]) {
            const v = upstream.headers.get(h);
            if (v) out[h] = v;
          }
          const manifest =
            /mpegurl|dash\+xml/i.test(type) ||
            /\.(m3u8|mpd)(?:[?#]|$)/i.test(target);
          if (upstream.ok && manifest && req.method === "GET") {
            const buffer = await limitedBody(upstream, 8 * 1024 * 1024);
            const text = buffer.toString("utf8");
            const transformed = this.rewrite(text, target);
            out["x-vidown-manifest-sha256"] = digest(text);
            delete out["content-length"];
            delete out.etag;
            res.writeHead(200, out).end(transformed);
            return;
          }
          res.writeHead(upstream.status, out);
          if (req.method === "HEAD" || !upstream.body) {
            res.end();
            return;
          }
          const length = Number(upstream.headers.get("content-length") ?? 0);
          const cacheable =
            resource.cacheable &&
            upstream.ok &&
            length > 0 &&
            length <= 32 * 1024 * 1024 &&
            !/text\/html/.test(type);
          const temporary =
            cached + "." + randomBytes(6).toString("hex") + ".part";
          const file = cacheable
            ? createWriteStream(temporary, { mode: 0o600 })
            : undefined;
          let total = 0;
          const meter = new Transform({
            transform: (chunk, _, callback) => {
              total += chunk.length;
              this.onBytes(chunk.length);
              if (file && !file.write(chunk))
                file.once("drain", () => callback(null, chunk));
              else callback(null, chunk);
            },
          });
          file?.on("error", (error) => meter.destroy(error));
          try {
            await pipeline(Readable.fromWeb(upstream.body as any), meter, res);
            if (file) {
              await new Promise<void>((resolve, reject) => {
                file.once("error", reject);
                file.end(resolve);
              });
              if (total !== length) throw new Error("Incomplete response");
              await rename(temporary, cached);
              await writeFile(
                cached + ".json",
                JSON.stringify({ status: upstream.status, headers: out }),
                { mode: 0o600 },
              );
            }
          } catch (error) {
            file?.destroy();
            await rm(temporary, { force: true }).catch(() => {});
            throw error;
          }
        } catch (error) {
          if (!controller.signal.aborted)
            this.lastError = redact(
              error instanceof Error ? error.message : error,
            );
          if (!res.headersSent)
            res
              .writeHead(502, { "content-type": "text/plain" })
              .end("Media transfer failed; refresh the source or sign in.");
          else res.destroy();
        } finally {
          unlock?.();
          this.controllers.delete(controller);
        }
      })();
      this.active.add(pending);
      void pending.finally(() => this.active.delete(pending));
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Bridge did not bind");
    this.origin = `http://127.0.0.1:${address.port}`;
  }
  register(raw: string, cacheable = false): string {
    const url = httpUrl(raw);
    const id = digest(url).slice(0, 32);
    const params = [
      ...new Set(
        url.match(
          /\$(?:RepresentationID|Number(?:%0\d+d)?|Time|Bandwidth)\$/g,
        ) ?? [],
      ),
    ];
    this.resources.set(id, { url, params, cacheable });
    return `${this.origin}/${this.token}/${id}${params.map((p) => "/" + p).join("")}`;
  }
  rewrite(text: string, base: string): string {
    if (text.trimStart().startsWith("#EXTM3U"))
      return text
        .split(/\r?\n/)
        .map((line) => {
          if (!line.trim()) return line;
          if (line.startsWith("#"))
            return line.replace(
              /URI="([^"]+)"/g,
              (_, uri: string) =>
                `URI="${this.register(new URL(uri, base).href, true)}"`,
            );
          return this.register(new URL(line.trim(), base).href, true);
        })
        .join("\n");
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw new Error("XML entities disallowed");
    const options = {
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: false,
    };
    const doc = new XMLParser(options).parse(text);
    if (!doc.MPD) throw new Error("Invalid MPD");
    const visit = (node: any, parent: string): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const n of node) visit(n, parent);
        return;
      }
      let current = parent;
      if (node.BaseURL !== undefined) {
        const first = Array.isArray(node.BaseURL)
          ? node.BaseURL[0]
          : node.BaseURL;
        const raw = typeof first === "string" ? first : first?.["#text"];
        if (raw) {
          current = new URL(String(raw), parent).href;
          if (current.endsWith("/")) delete node.BaseURL;
          else node.BaseURL = this.register(current, true);
        }
      }
      for (const key of ["@_media", "@_initialization", "@_sourceURL"])
        if (typeof node[key] === "string")
          node[key] = this.register(new URL(node[key], current).href, true);
      for (const [key, value] of Object.entries(node))
        if (!key.startsWith("@_") && key !== "BaseURL") visit(value, current);
    };
    visit(doc.MPD, base);
    return new XMLBuilder({
      ...options,
      suppressBooleanAttributes: false,
    }).build(doc);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const c of this.controllers) c.abort();
    this.server?.closeAllConnections();
    await new Promise<void>((r) =>
      this.server ? this.server.close(() => r()) : r(),
    );
    await Promise.allSettled([...this.active]);
  }
}
export async function limitedBody(
  response: Response,
  limit: number,
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of response.body as any) {
    size += chunk.length;
    if (size > limit) {
      throw new Error("Response exceeds size limit");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
