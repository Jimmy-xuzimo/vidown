import {
  WebContentsView,
  session,
  type BrowserWindow,
  type Session,
} from "electron";
import { randomUUID } from "node:crypto";
import type { BrowserTab, SourceCandidate, Protocol } from "../shared/types";
import { httpUrl, publicUrl } from "../core/safety";
import {
  telegramWebUrl,
  telegramMessageId,
  isTelegramWeb,
} from "../shared/telegram";
import { telegramMessageAction } from "./telegram-web";
import { completeAddress } from "../shared/address";

export class BrowserManager {
  readonly session: Session;
  readonly candidates = new Map<
    string,
    SourceCandidate & { url: string; headers: Record<string, string> }
  >();
  private views = new Map<string, WebContentsView>();
  protected info = new Map<string, BrowserTab>();
  protected headers = new Map<number, Record<string, string>>();
  protected capturedHeaders = new Map<string, Record<string, string>>();
  protected manifestBodies = new Map<string, string>();
  protected bounds = { x: 270, y: 110, width: 700, height: 560 };
  protected visible = false;
  protected clearingData = false;
  active?: string;
  constructor(
    protected win: BrowserWindow,
    protected changed: () => void,
    protected zoomPreferences: Record<string, number> = {},
    protected saveZoom: (value: Record<string, number>) => void = () => {},
    partition = "persist:vidown-browser",
  ) {
    this.session = session.fromPartition(partition);
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
  get backendName(): string {
    return "Chromium";
  }
  async synchronize(): Promise<void> {}
  async clearData(): Promise<void> {
    if (this.clearingData) throw new Error("正在清除浏览器数据，请稍候");
    this.clearingData = true;
    try {
      await this.action({ action: "logout" });
    } finally {
      this.clearingData = false;
    }
  }
  protected async clearSessionData(): Promise<void> {
    await this.session.closeAllConnections();
    await this.session.clearStorageData();
    await this.session.clearCache();
    await this.session.clearCodeCaches({});
    await this.session.clearAuthCache();
    await this.session.clearHostResolverCache();
    await this.session.cookies.flushStore();
    this.zoomPreferences = {};
    this.saveZoom({});
  }
  async configureProxy(proxy: string): Promise<void> {
    await this.session.setProxy(
      proxy ? { proxyRules: proxy } : { mode: "system" },
    );
  }
  async shutdown(): Promise<void> {
    this.close();
  }
  currentUrl(id?: string): string | undefined {
    return this.views.get(id ?? this.active ?? "")?.webContents.getURL();
  }
  owns(contents: Electron.WebContents): boolean {
    return [...this.views.values()].some((v) => v.webContents === contents);
  }
  async probeTelegram(
    url: string,
    options: { tabId?: string; mediaUrl?: string } = {},
  ): Promise<{
    wc: number;
    messageId?: string;
    mediaUrl?: string;
    fingerprint: string;
    title: string;
  }> {
    let view: WebContentsView | undefined;
    let messageId: string | undefined;
    if (isTelegramWeb(url)) {
      // Internal stream URLs require the existing renderer/service worker client.
      // Never navigate to them, export session keys or replay them as HTTP files.
      const requested = new URL(url);
      const matching = [...this.views.keys()].filter((id) => {
        try {
          const current = new URL(this.currentUrl(id)!);
          return (
            current.origin === requested.origin &&
            current.pathname === requested.pathname &&
            (!requested.hash || current.hash === requested.hash)
          );
        } catch {
          return false;
        }
      });
      const id =
        options.tabId ??
        (matching.includes(this.active!) ? this.active : matching[0]);
      view = this.views.get(id ?? "");
      if (!view || !isTelegramWeb(view.webContents.getURL()))
        throw new Error(
          "请先在内置浏览器打开目标网页并播放目标视频，再提取当前页面",
        );
      if (
        options.mediaUrl &&
        new URL(view.webContents.getURL()).origin !== new URL(url).origin
      )
        throw new Error("资源所属页面已变化，请重新播放后探测");
    } else {
      messageId = telegramMessageId(url);
      const entries = [...this.views.entries()];
      const entry =
        entries.find(
          ([id, v]) =>
            id === this.active && isTelegramWeb(v.webContents.getURL()),
        ) ?? entries.find(([, v]) => isTelegramWeb(v.webContents.getURL()));
      const destination = telegramWebUrl(url, entry?.[1].webContents.getURL());
      if (entry) {
        view = entry[1];
        // Full navigation lets either client process its own public deep link.
        await view.webContents.loadURL(destination);
      } else {
        const id = await this.create(destination);
        view = this.views.get(id);
      }
    }
    if (!view) throw new Error("浏览器标签已关闭，请重新解析");
    if (!options.tabId) this.hide();
    const end = Date.now() + (messageId ? 20000 : 1500);
    let last = "请先在内置浏览器登录目标网页";
    while (Date.now() < end) {
      try {
        if (
          view.webContents.isDestroyed() ||
          !isTelegramWeb(view.webContents.getURL())
        )
          throw new Error("页面已离开");
        const result = await view.webContents.executeJavaScript(
          `(${telegramMessageAction.toString()})(${JSON.stringify({ messageId, mediaUrl: options.mediaUrl })})`,
          true,
        );
        return {
          wc: view.webContents.id,
          messageId,
          mediaUrl: options.mediaUrl,
          fingerprint: result.fingerprint,
          title: result.title,
        };
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(last);
  }
  async saveTelegram(ref: {
    wc: number;
    messageId?: string;
    mediaUrl?: string;
    fingerprint: string;
  }): Promise<void> {
    const view = [...this.views.values()].find(
      (v) => v.webContents.id === ref.wc,
    );
    if (!view || !isTelegramWeb(view.webContents.getURL()))
      throw new Error("网页已关闭或更换，请重新解析");
    await view.webContents.executeJavaScript(
      `(${telegramMessageAction.toString()})(${JSON.stringify({ messageId: ref.messageId, mediaUrl: ref.mediaUrl, fingerprint: ref.fingerprint, save: true })})`,
      true,
    );
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
  protected capture(
    tabId: string,
    url: string,
    type: string,
    headers: Record<string, string>,
  ): void {
    if (this.clearingData || !this.info.has(tabId) || !/^https?:/.test(url))
      return;
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
  private applyZoom(id: string): void {
    const view = this.views.get(id),
      tab = this.info.get(id);
    if (!view || !tab || view.webContents.isDestroyed()) return;
    let manual: number | undefined;
    try {
      manual = this.zoomPreferences[new URL(view.webContents.getURL()).origin];
    } catch {}
    const factor = Number.isFinite(manual)
      ? Math.max(0.25, Math.min(2, manual!))
      : Math.max(
          0.5,
          Math.min(1, Math.floor((this.bounds.width / 1280) * 100) / 100),
        );
    view.webContents.setZoomFactor(factor);
    tab.zoomFactor = factor;
    tab.autoFit = !Number.isFinite(manual);
  }
  private zoom(id: string, value: number | "fit"): void {
    const view = this.views.get(id);
    if (!view) throw new Error("请先打开一个标签页");
    const origin = new URL(view.webContents.getURL()).origin;
    if (value === "fit") delete this.zoomPreferences[origin];
    else {
      if (!Number.isFinite(value) || value < 0.25 || value > 2)
        throw new Error("网页缩放范围为 25%–200%");
      this.zoomPreferences[origin] = value;
    }
    this.saveZoom({ ...this.zoomPreferences });
    for (const other of this.views.keys()) this.applyZoom(other);
    this.changed();
  }
  async create(url = "about:blank"): Promise<string> {
    if (this.clearingData) throw new Error("正在清除浏览器数据，请稍候");
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
    this.info.set(id, {
      id,
      url,
      title: "新标签页",
      loading: true,
      zoomFactor: 1,
      autoFit: true,
    });
    view.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !(input.control || input.meta)) return;
      if (!["+", "=", "-", "0"].includes(input.key)) return;
      event.preventDefault();
      const value =
        input.key === "0"
          ? 1
          : Math.max(
              0.25,
              Math.min(
                2,
                Math.round(
                  (view.webContents.getZoomFactor() +
                    (input.key === "-" ? -0.1 : 0.1)) *
                    100,
                ) / 100,
              ),
            );
      this.zoom(id, value);
    });
    view.webContents.on("zoom-changed", (_event, direction) => {
      this.zoom(
        id,
        Math.max(
          0.25,
          Math.min(
            2,
            Math.round(
              (view.webContents.getZoomFactor() +
                (direction === "in" ? 0.1 : -0.1)) *
                100,
            ) / 100,
          ),
        ),
      );
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void this.create(url).catch(() => {});
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
      this.applyZoom(id);
      if (this.visible && this.active === id) this.show();
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
                if (
                  !this.clearingData &&
                  this.info.has(id) &&
                  text.length <= 8 * 1024 * 1024
                ) {
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
    void view.webContents
      .loadURL(url === "about:blank" ? url : httpUrl(completeAddress(url)))
      .catch(() => update());
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
    if (view && this.info.get(this.active!)?.url === "about:blank")
      this.win.contentView.removeChildView(view);
    if (view && this.info.get(this.active!)?.url !== "about:blank") {
      this.win.contentView.addChildView(view);
      view.setBounds(this.bounds);
      this.applyZoom(this.active!);
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
      const scale = this.win.webContents.getZoomFactor();
      const x = Math.max(0, Math.min(width - 1, Math.round(b.x * scale)));
      const y = Math.max(0, Math.min(height - 1, Math.round(b.y * scale)));
      this.bounds = {
        x,
        y,
        width: Math.max(1, Math.min(Math.round(b.width * scale), width - x)),
        height: Math.max(1, Math.min(Math.round(b.height * scale), height - y)),
      };
      this.show();
      this.changed();
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
      await this.clearSessionData();
      this.changed();
      return;
    }
    const id = input.tabId ?? this.active;
    const view = this.views.get(id);
    if (!view && input.action === "navigate" && !input.tabId) {
      await this.create(input.url);
      return;
    }
    if (!view) throw new Error("请先打开一个标签页");
    switch (input.action) {
      case "zoom":
        this.zoom(id, input.zoom);
        break;
      case "select":
        this.select(id);
        break;
      case "navigate":
        await view.webContents.loadURL(httpUrl(completeAddress(input.url)));
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
