import { app, screen, type BrowserWindow, type WebContents } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { BrowserManager } from "./browser";
import { httpUrl, publicUrl } from "../core/safety";
import { completeAddress } from "../shared/address";
import {
  isTelegramWeb,
  telegramMessageId,
  telegramWebUrl,
} from "../shared/telegram";
import { telegramMessageAction } from "./telegram-web";

class NativeDownload extends EventEmitter {
  bytes = 0;
  total = 0;
  resumable = true;
  paused = false;
  path = "";
  constructor(
    readonly meta: any,
    private send: (command: any) => void,
  ) {
    super();
    this.total = meta.total ?? 0;
  }
  getFilename() {
    return this.meta.filename;
  }
  getMimeType() {
    return this.meta.mime;
  }
  getReceivedBytes() {
    return this.bytes;
  }
  getTotalBytes() {
    return this.total;
  }
  canResume() {
    return this.resumable;
  }
  isPaused() {
    return this.paused;
  }
  setSavePath(path: string) {
    this.path = path;
  }
  cancel() {
    this.send({ action: "cancel" });
  }
  pause() {
    this.paused = true;
    this.send({ action: "pause" });
  }
  resume() {
    this.paused = false;
    this.send({ action: "resume" });
  }
}

/** Windows webpage host uses the installed Evergreen WebView2 runtime.
 * Its cookie jar is synchronized only across trusted local process pipes to a
 * separate Electron network session used by the existing transfer bridge.
 * Webpage JS never receives an application API or a host object.
 */
export class WebView2Browser extends BrowserManager {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private actualUrls = new Map<string, string>();
  private nativeIds = new Map<string, number>();
  private nextWc = 1_000_000_000;
  private downloads = new Map<string, NativeDownload>();
  private proxy = "";
  private version = "按需启动";
  private cookieTimer?: NodeJS.Timeout;
  private stoppingHost = false;
  private syncing?: Promise<void>;
  constructor(
    win: BrowserWindow,
    changed: () => void,
    zoom: Record<string, number>,
    saveZoom: (value: Record<string, number>) => void,
  ) {
    super(win, changed, zoom, saveZoom, "persist:vidown-webview2-transport");
  }
  override get backendName() {
    return "Windows WebView2 · " + this.version;
  }
  private request(
    command: string,
    input: Record<string, unknown> = {},
  ): Promise<any> {
    if (!this.child?.stdin.writable)
      return Promise.reject(new Error("系统浏览器进程已退出，请重试"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("系统浏览器响应超时，请重试"));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(
        JSON.stringify({ id, command, ...input }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }
  private ensure(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const executable = app.isPackaged
        ? join(process.resourcesPath, "webview2-host", "Vidown.WebView2.exe")
        : join(app.getAppPath(), "resources/webview2-host/Vidown.WebView2.exe");
      if (!existsSync(executable))
        throw new Error("缺少系统浏览器组件，请重新安装完整软件包");
      const handle = this.win.getNativeWindowHandle();
      const hwnd =
        handle.length === 8
          ? handle.readBigUInt64LE().toString()
          : handle.readUInt32LE().toString();
      const child = spawn(
        executable,
        [hwnd, String(process.pid), join(app.getPath("userData"), "WebView2")],
        { windowsHide: true, stdio: "pipe" },
      );
      this.stoppingHost = false;
      this.child = child;
      const startup = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("系统浏览器启动超时")),
          30000,
        );
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("系统浏览器启动失败，请确认 WebView2 运行时已安装"));
        });
        createInterface({ input: child.stdout }).on("line", (line) => {
          try {
            const message = JSON.parse(line);
            if (message.type === "ready") {
              clearTimeout(timer);
              resolve();
            } else this.receive(message);
          } catch {
            /* Invalid child output never becomes a command. */
          }
        });
      });
      child.stderr.resume();
      child.on("exit", () => {
        if (this.child !== child) return;
        this.child = undefined;
        this.ready = undefined;
        if (this.cookieTimer) clearInterval(this.cookieTimer);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("系统浏览器进程已退出"));
        }
        this.pending.clear();
        for (const item of this.downloads.values())
          item.emit("done", {}, "interrupted");
        this.downloads.clear();
        if (!this.stoppingHost) {
          this.info.clear();
          this.nativeIds.clear();
          this.actualUrls.clear();
          this.candidates.clear();
          this.active = undefined;
        }
        this.changed();
      });
      await startup;
      const result = await this.request("init", { proxy: this.proxy });
      this.version = result.version;
      this.session.setUserAgent(result.userAgent);
      // Recover bounded encrypted session-cookie backups, without replacing newer
      // native cookies or importing the legacy Chromium profile.
      const native: any[] = await this.request("cookies");
      const backups = (await this.session.cookies.get({})).filter(
        (c) =>
          c.session &&
          !native.some(
            (n) =>
              n.name === c.name && n.domain === c.domain && n.path === c.path,
          ),
      );
      if (backups.length)
        await this.request("setCookies", { cookies: backups });
      this.cookieTimer = setInterval(() => {
        if (this.visible) void this.synchronize().catch(() => {});
      }, 2000);
      this.changed();
    })().catch((error) => {
      this.child?.kill();
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }
  private receive(message: any): void {
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      message.error
        ? pending.reject(new Error(message.error))
        : pending.resolve(message.value);
      return;
    }
    const id = message.tabId;
    if (message.type === "tab") {
      const tab = this.info.get(id);
      if (tab) {
        this.actualUrls.set(id, message.url);
        Object.assign(tab, {
          title: message.title || "新标签页",
          url: publicUrl(message.url),
          loading: message.loading,
        });
        void this.applyNativeZoom(id).catch(() => {});
        this.changed();
      }
    } else if (message.type === "capture")
      this.capture(id, message.url, message.mime, message.headers);
    else if (
      message.type === "manifest" &&
      message.text?.length <= 8 * 1024 * 1024
    ) {
      this.manifestBodies.set(message.url, message.text);
      if (this.manifestBodies.size > 100)
        this.manifestBodies.delete(this.manifestBodies.keys().next().value!);
    } else if (message.type === "popup")
      void this.create(message.url).catch(() => {});
    else if (message.type === "download-start") {
      const item = new NativeDownload(message, (input) => {
        void this.request("download-action", {
          downloadId: message.downloadId,
          ...input,
        })
          .then(() => {
            if (input.action === "cancel") {
              item.emit("done", {}, "cancelled");
              this.downloads.delete(message.downloadId);
            }
          })
          .catch(() => item.emit("done", {}, "interrupted"));
      });
      this.downloads.set(message.downloadId, item);
      let prevented = false;
      this.session.emit(
        "will-download",
        {
          preventDefault: () => {
            prevented = true;
          },
        },
        item,
        { id: this.nativeIds.get(id) },
      );
      if (prevented || !item.path) item.cancel();
      else
        void this.request("download-accept", {
          downloadId: message.downloadId,
          path: item.path,
        }).catch(() => item.emit("done", {}, "interrupted"));
    } else if (message.type === "download-progress") {
      const item = this.downloads.get(message.downloadId);
      if (item) {
        item.bytes = message.bytes;
        item.total = message.total ?? 0;
        item.resumable = message.canResume;
        item.emit("updated", {}, "progressing");
      }
    } else if (message.type === "download-state") {
      const item = this.downloads.get(message.downloadId);
      if (!item) return;
      item.resumable = message.canResume;
      if (message.state === "Completed") {
        item.emit("done", {}, "completed");
        this.downloads.delete(message.downloadId);
      } else if (message.state === "Interrupted") {
        if (item.paused && message.canResume)
          item.emit("updated", {}, "interrupted");
        else {
          item.emit("done", {}, "interrupted");
          this.downloads.delete(message.downloadId);
        }
      }
    }
  }
  override async synchronize(): Promise<void> {
    await this.ensure();
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      const cookies: any[] = await this.request("cookies");
      const previous = await this.session.cookies.get({});
      for (const old of previous)
        if (
          !cookies.some(
            (c) =>
              c.name === old.name &&
              c.domain === old.domain &&
              c.path === old.path,
          )
        )
          await this.session.cookies.remove(
            `${old.secure ? "https" : "http"}://${old.domain?.replace(/^\./, "")}${old.path}`,
            old.name,
          );
      for (const c of cookies) {
        const old = previous.find(
          (o) =>
            o.name === c.name && o.domain === c.domain && o.path === c.path,
        );
        if (
          old?.value === c.value &&
          old?.expirationDate === (c.expirationDate ?? undefined)
        )
          continue;
        await this.session.cookies.set({
          url: `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path}`,
          name: c.name,
          value: c.value,
          path: c.path,
          ...(c.domain.startsWith(".") ? { domain: c.domain } : {}),
          secure: c.secure,
          httpOnly: c.httpOnly,
          ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
          sameSite: c.sameSite === "none" ? "no_restriction" : c.sameSite,
        });
      }
    })().finally(() => {
      this.syncing = undefined;
    });
    return this.syncing;
  }
  override currentUrl(id?: string) {
    return this.actualUrls.get(id ?? this.active ?? "");
  }
  override owns(contents: WebContents) {
    return [...this.nativeIds.values()].includes(contents.id);
  }
  async execute(tabId: string, code: string): Promise<any> {
    await this.ensure();
    return this.request("execute", { tabId, code });
  }
  async capturePreview(tabId: string): Promise<string> {
    await this.ensure();
    return this.request("capture", { tabId });
  }
  async geometry(): Promise<any> {
    await this.ensure();
    return this.request("geometry");
  }
  override async create(url = "about:blank"): Promise<string> {
    const target = url === "about:blank" ? url : httpUrl(completeAddress(url));
    await this.ensure();
    const id = randomUUID();
    this.nativeIds.set(id, ++this.nextWc);
    this.actualUrls.set(id, target);
    this.info.set(id, {
      id,
      url: publicUrl(target),
      title: "新标签页",
      loading: true,
      zoomFactor: 1,
      autoFit: true,
    });
    try {
      await this.request("new", { tabId: id, url: target });
    } catch (error) {
      this.info.delete(id);
      this.actualUrls.delete(id);
      this.nativeIds.delete(id);
      throw error;
    }
    this.select(id);
    return id;
  }
  private async applyNativeZoom(id: string) {
    const tab = this.info.get(id);
    if (!tab) return;
    const manual = this.zoomPreferences[new URL(this.currentUrl(id)!).origin];
    const factor = Number.isFinite(manual)
      ? Math.max(0.25, Math.min(2, manual))
      : Math.max(
          0.5,
          Math.min(1, Math.floor((this.bounds.width / 1280) * 100) / 100),
        );
    tab.zoomFactor = factor;
    tab.autoFit = !Number.isFinite(manual);
    await this.request("zoom", { tabId: id, factor });
  }
  override select(id: string) {
    if (!this.info.has(id)) throw new Error("标签页不存在");
    this.active = id;
    void this.request("select", { tabId: id }).catch(() => {});
    this.show();
    this.changed();
  }
  override show() {
    this.visible = true;
    if (!this.child || !this.active) return;
    const dpi = screen.getDisplayMatching(this.win.getBounds()).scaleFactor;
    void this.request("bounds", {
      visible: true,
      ...Object.fromEntries(
        Object.entries(this.bounds).map(([k, v]) => [k, Math.round(v * dpi)]),
      ),
    }).catch(() => {});
    void this.applyNativeZoom(this.active).catch(() => {});
  }
  override hide() {
    this.visible = false;
    if (this.child)
      void this.request("bounds", {
        visible: false,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }).catch(() => {});
  }
  override async action(input: any): Promise<void> {
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
      const [width, height] = this.win.getContentSize(),
        scale = this.win.webContents.getZoomFactor();
      const x = Math.max(0, Math.min(width - 1, Math.round(b.x * scale))),
        y = Math.max(0, Math.min(height - 1, Math.round(b.y * scale)));
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
      if (this.child) await this.request("logout");
      else {
        await this.ensure();
        await this.request("logout");
      }
      this.info.clear();
      this.actualUrls.clear();
      this.nativeIds.clear();
      this.active = undefined;
      this.candidates.clear();
      this.capturedHeaders.clear();
      this.manifestBodies.clear();
      await this.session.clearStorageData();
      this.changed();
      return;
    }
    const id = input.tabId ?? this.active;
    if (!id && input.action === "navigate") {
      await this.create(input.url);
      return;
    }
    if (!id || !this.info.has(id)) throw new Error("请先打开一个标签页");
    await this.ensure();
    if (input.action === "select") {
      this.select(id);
      return;
    }
    if (input.action === "zoom") {
      const origin = new URL(this.currentUrl(id)!).origin;
      if (input.zoom === "fit") delete this.zoomPreferences[origin];
      else {
        if (!Number.isFinite(input.zoom) || input.zoom < 0.25 || input.zoom > 2)
          throw new Error("网页缩放范围为 25%–200%");
        this.zoomPreferences[origin] = input.zoom;
      }
      this.saveZoom({ ...this.zoomPreferences });
      for (const key of this.info.keys()) await this.applyNativeZoom(key);
    } else if (input.action === "close") {
      await this.request("close", { tabId: id });
      this.info.delete(id);
      this.actualUrls.delete(id);
      this.nativeIds.delete(id);
      for (const [key, c] of this.candidates)
        if (c.tabId === id) this.candidates.delete(key);
      if (this.active === id) {
        this.active = undefined;
        const next = this.info.keys().next().value;
        if (next) this.select(next);
        else this.hide();
      }
    } else if (
      ["navigate", "reload", "back", "forward"].includes(input.action)
    ) {
      await this.request(input.action, {
        tabId: id,
        ...(input.action === "navigate"
          ? { url: httpUrl(completeAddress(input.url)) }
          : {}),
      });
    } else throw new Error("无效的浏览器操作");
    this.changed();
  }
  override async configureProxy(proxy: string) {
    if (proxy !== this.proxy && this.downloads.size)
      throw new Error("请先结束网页保存任务，再修改浏览器代理");
    await super.configureProxy(proxy);
    if (proxy === this.proxy) return;
    if (this.child) {
      const tabs = [...this.actualUrls],
        selected = this.active,
        visible = this.visible;
      await this.shutdown();
      this.proxy = proxy;
      await this.ensure();
      for (const [id, url] of tabs)
        await this.request("new", { tabId: id, url });
      if (selected) this.select(selected);
      if (!visible) this.hide();
    }
    this.proxy = proxy;
  }
  override async probeTelegram(
    url: string,
    options: { tabId?: string; mediaUrl?: string } = {},
  ) {
    let id = options.tabId,
      messageId: string | undefined;
    if (!isTelegramWeb(url)) {
      messageId = telegramMessageId(url);
      id = [...this.info.keys()].find((t) =>
        isTelegramWeb(this.currentUrl(t) ?? ""),
      );
      const destination = telegramWebUrl(
        url,
        id ? this.currentUrl(id) : undefined,
      );
      if (id)
        await this.action({ action: "navigate", tabId: id, url: destination });
      else id = await this.create(destination);
    } else if (!id)
      id = [...this.info.keys()].find((t) => {
        try {
          const a = new URL(this.currentUrl(t)!),
            b = new URL(url);
          return (
            a.origin === b.origin &&
            a.pathname === b.pathname &&
            (!b.hash || a.hash === b.hash)
          );
        } catch {
          return false;
        }
      });
    if (!id || !isTelegramWeb(this.currentUrl(id) ?? ""))
      throw new Error("请在内置浏览器登录并播放目标视频后重新解析");
    if (
      options.mediaUrl &&
      new URL(this.currentUrl(id)!).origin !== new URL(url).origin
    )
      throw new Error("资源所属页面已变化，请重新播放后探测");
    if (!options.tabId) this.hide();
    let last: unknown = new Error("请在内置浏览器登录目标网页");
    const end = Date.now() + (messageId ? 20000 : 1500);
    while (Date.now() < end) {
      try {
        const result = await this.execute(
          id,
          `(${telegramMessageAction.toString()})(${JSON.stringify({ messageId, mediaUrl: options.mediaUrl })})`,
        );
        return {
          wc: this.nativeIds.get(id)!,
          messageId,
          mediaUrl: options.mediaUrl,
          fingerprint: result.fingerprint,
          title: result.title,
        };
      } catch (error) {
        last = error;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw last;
  }
  override async saveTelegram(ref: {
    wc: number;
    messageId?: string;
    mediaUrl?: string;
    fingerprint: string;
  }) {
    const id = [...this.nativeIds].find(([, wc]) => wc === ref.wc)?.[0];
    if (!id || !isTelegramWeb(this.currentUrl(id) ?? ""))
      throw new Error("网页已关闭或更换，请重新解析");
    await this.execute(
      id,
      `(${telegramMessageAction.toString()})(${JSON.stringify({ ...ref, save: true })})`,
    );
  }
  override close() {
    void this.shutdown();
  }
  override async shutdown() {
    if (this.cookieTimer) clearInterval(this.cookieTimer);
    const child = this.child;
    if (!child) return;
    this.stoppingHost = true;
    await this.synchronize().catch(() => {});
    await this.request("shutdown").catch(() => {});
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      setTimeout(() => {
        child.kill();
        resolve();
      }, 3000).unref();
    });
  }
}
