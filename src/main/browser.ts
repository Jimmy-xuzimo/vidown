import {
  WebContentsView,
  session,
  type BrowserWindow,
  type Session,
} from "electron";
import { randomUUID } from "node:crypto";
import type { BrowserTab, SourceCandidate, Protocol } from "../shared/types";
import { httpUrl, publicUrl } from "../core/safety";

export class BrowserManager {
  readonly session: Session;
  readonly candidates = new Map<
    string,
    SourceCandidate & { url: string; headers: Record<string, string> }
  >();
  private views = new Map<string, WebContentsView>();
  private info = new Map<string, BrowserTab>();
  private headers = new Map<number, Record<string, string>>();
  private capturedHeaders = new Map<string, Record<string, string>>();
  private manifestBodies = new Map<string, string>();
  private bounds = { x: 270, y: 110, width: 700, height: 560 };
  private visible = false;
  active?: string;
  constructor(
    private win: BrowserWindow,
    private changed: () => void,
  ) {
    this.session = session.fromPartition("persist:vidown-browser");
    this.session.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    this.session.webRequest.onSendHeaders(
      { urls: ["http://*/*", "https://*/*"] },
      (details) => {
        this.headers.set(details.id, details.requestHeaders);
        if (this.headers.size > 10000)
          this.headers.delete(this.headers.keys().next().value!);
      },
    );
    // Electron supports one listener per webRequest event: all capture goes through this dispatcher.
    this.session.webRequest.onResponseStarted(
      { urls: ["http://*/*", "https://*/*"] },
      (details) => {
        const headers = this.headers.get(details.id) ?? {};
        this.headers.delete(details.id);
        const type =
          Object.entries(details.responseHeaders ?? {}).find(
            ([k]) => k.toLowerCase() === "content-type",
          )?.[1]?.[0] ?? "";
        const tab = [...this.views.entries()].find(
          ([, v]) => v.webContents.id === details.webContentsId,
        )?.[0];
        if (tab) this.capture(tab, details.url, type, headers);
      },
    );
    this.session.webRequest.onErrorOccurred((details) =>
      this.headers.delete(details.id),
    );
  }
  list(): BrowserTab[] {
    return [...this.info.values()];
  }
  currentUrl(id?: string): string | undefined {
    return this.views.get(id ?? this.active ?? "")?.webContents.getURL();
  }
  publicCandidates(): SourceCandidate[] {
    return [...this.candidates.values()]
      .slice(-150)
      .reverse()
      .map(({ url, headers, ...candidate }) => candidate);
  }
  headersFor(url: string, pageUrl?: string): Record<string, string> {
    const original = this.capturedHeaders.get(url) ?? {};
    const result: Record<string, string> = {
      "User-Agent": this.session.getUserAgent(),
    };
    for (const [key, value] of Object.entries(original))
      if (
        /^(referer|origin|authorization|accept|accept-language|x-[\w-]+)$/i.test(
          key,
        )
      )
        result[key] = value;
    if (
      !Object.keys(result).some((k) => k.toLowerCase() === "referer") &&
      pageUrl
    )
      result.Referer = pageUrl;
    return result;
  }
  private capture(
    tabId: string,
    url: string,
    type: string,
    headers: Record<string, string>,
  ): void {
    if (!/^https?:/.test(url)) return;
    let protocol: Protocol | undefined;
    if (/mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(url))
      protocol = "hls";
    else if (/dash\+xml/i.test(type) || /\.mpd(?:[?#]|$)/i.test(url))
      protocol = "dash";
    else if (
      /^(video|audio)\//i.test(type) &&
      !/mp2t|iso.segment/i.test(type) &&
      !/\.(ts|m4s)(?:[?#]|$)/i.test(url)
    )
      protocol = "http";
    if (!protocol) return;
    if (Object.keys(headers).length) this.capturedHeaders.set(url, headers);
    const existing = [...this.candidates.values()].find(
      (c) => c.url === url && c.tabId === tabId,
    );
    if (existing) return;
    const candidate = {
      id: randomUUID(),
      tabId,
      pageUrl: publicUrl(this.info.get(tabId)?.url ?? url),
      host: new URL(url).host,
      protocol,
      contentType: type,
      detectedAt: Date.now(),
      url,
      headers,
    };
    this.candidates.set(candidate.id, candidate);
    if (this.candidates.size > 300)
      this.candidates.delete(this.candidates.keys().next().value!);
    this.changed();
  }
  body(url: string): string | undefined {
    return this.manifestBodies.get(url);
  }
  async create(url = "https://www.bilibili.com"): Promise<string> {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    this.views.set(id, view);
    this.info.set(id, { id, url, title: "新标签页", loading: true });
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void this.create(url);
      return { action: "deny" };
    });
    view.webContents.on("will-navigate", (event, url) => {
      try {
        httpUrl(url);
      } catch {
        event.preventDefault();
      }
    });
    view.webContents.on("page-title-updated", (_event, title) => {
      const t = this.info.get(id);
      if (t) t.title = title;
      this.changed();
    });
    const update = () => {
      const t = this.info.get(id);
      if (t) {
        t.url = publicUrl(view.webContents.getURL());
        t.loading = view.webContents.isLoading();
      }
      this.changed();
    };
    view.webContents.on("did-navigate", update);
    view.webContents.on("did-navigate-in-page", update);
    view.webContents.on("did-start-loading", update);
    view.webContents.on("did-stop-loading", update);
    // CDP observes manifest bodies, including extensionless endpoints and frames. No page API is exposed.
    try {
      view.webContents.debugger.attach("1.3");
      void view.webContents.debugger
        .sendCommand("Network.enable")
        .catch(() => {});
      const requests = new Map<string, { url: string; type: string }>();
      view.webContents.debugger.on("message", (_event, method, params) => {
        if (method === "Network.responseReceived") {
          const r = params.response;
          this.capture(id, r.url, r.mimeType, {});
          if (/mpegurl|dash\+xml/i.test(r.mimeType))
            requests.set(params.requestId, { url: r.url, type: r.mimeType });
        }
        if (method === "Network.loadingFinished") {
          const r = requests.get(params.requestId);
          requests.delete(params.requestId);
          if (r && params.encodedDataLength <= 8 * 1024 * 1024)
            void view.webContents.debugger
              .sendCommand("Network.getResponseBody", {
                requestId: params.requestId,
              })
              .then((body) => {
                const text = body.base64Encoded
                  ? Buffer.from(body.body, "base64").toString()
                  : body.body;
                if (text.length <= 8 * 1024 * 1024) {
                  this.manifestBodies.set(r.url, text);
                  if (this.manifestBodies.size > 100)
                    this.manifestBodies.delete(
                      this.manifestBodies.keys().next().value!,
                    );
                }
              })
              .catch(() => {});
        }
        if (method === "Network.loadingFailed")
          requests.delete(params.requestId);
      });
    } catch {
      /* webRequest capture remains available if devtools owns the debugger. */
    }
    this.select(id);
    void view.webContents.loadURL(httpUrl(url)).catch(() => update());
    return id;
  }
  select(id: string): void {
    if (!this.views.has(id)) throw new Error("标签页不存在");
    for (const v of this.views.values())
      this.win.contentView.removeChildView(v);
    this.active = id;
    this.show();
    this.changed();
  }
  show(): void {
    this.visible = true;
    const view = this.active ? this.views.get(this.active) : undefined;
    if (view) {
      this.win.contentView.addChildView(view);
      view.setBounds(this.bounds);
    }
  }
  hide(): void {
    this.visible = false;
    for (const view of this.views.values())
      this.win.contentView.removeChildView(view);
  }
  async action(input: any): Promise<void> {
    if (input.action === "new") {
      await this.create(input.url);
      return;
    }
    if (input.action === "hide") {
      this.hide();
      return;
    }
    if (input.action === "bounds") {
      const b = input.bounds;
      if (
        !b ||
        !["x", "y", "width", "height"].every((k) => Number.isFinite(b[k]))
      )
        return;
      const [width, height] = this.win.getContentSize();
      this.bounds = {
        x: Math.max(0, Math.round(b.x)),
        y: Math.max(0, Math.round(b.y)),
        width: Math.max(1, Math.min(Math.round(b.width), width)),
        height: Math.max(1, Math.min(Math.round(b.height), height)),
      };
      this.show();
      return;
    }
    if (input.action === "logout") {
      this.hide();
      for (const v of this.views.values()) v.webContents.close();
      this.views.clear();
      this.info.clear();
      this.candidates.clear();
      this.headers.clear();
      this.capturedHeaders.clear();
      this.manifestBodies.clear();
      this.active = undefined;
      await this.session.clearStorageData();
      this.changed();
      return;
    }
    const id = input.tabId ?? this.active;
    const view = this.views.get(id);
    if (!view) throw new Error("请先打开一个标签页");
    switch (input.action) {
      case "select":
        this.select(id);
        break;
      case "navigate":
        await view.webContents.loadURL(httpUrl(input.url));
        break;
      case "reload":
        view.webContents.reload();
        break;
      case "back":
        if (view.webContents.navigationHistory.canGoBack())
          view.webContents.navigationHistory.goBack();
        break;
      case "forward":
        if (view.webContents.navigationHistory.canGoForward())
          view.webContents.navigationHistory.goForward();
        break;
      case "close":
        this.win.contentView.removeChildView(view);
        view.webContents.close();
        this.views.delete(id);
        this.info.delete(id);
        for (const [key, c] of this.candidates)
          if (c.tabId === id) this.candidates.delete(key);
        if (this.active === id) {
          this.active = undefined;
          const next = this.views.keys().next().value;
          if (next) this.select(next);
        }
        this.changed();
        break;
    }
  }
  close(): void {
    for (const v of this.views.values())
      if (!v.webContents.isDestroyed()) v.webContents.close();
    this.views.clear();
  }
}
