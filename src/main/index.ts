import {
  app,
  BrowserWindow,
  ipcMain,
  utilityProcess,
  dialog,
  shell,
  safeStorage,
  clipboard,
  nativeTheme,
  Menu,
} from "electron";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  lstat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Store } from "../core/store";
import { TransportBridge, limitedBody } from "../core/bridge";
import { chooseTracks, publicAsset } from "../core/formats";
import { isBilibiliPage, addBilibiliMirrors } from "../core/bilibili";
import { pgcTarget, probePgc } from "../core/bilibili-pgc";
import {
  httpUrl,
  classifyError,
  publicUrl,
  redact,
  digest,
} from "../core/safety";
import { BrowserManager } from "./browser";
import { WebView2Browser } from "./webview2";
import { SessionKeeper } from "./session";
import { WebDownloads } from "./web-downloads";
import { isTelegramLink, isTelegramWeb } from "../shared/telegram";
import { completeAddress } from "../shared/address";
import { isDouyinPage } from "../shared/douyin";
import { canRemoveHistory } from "../shared/history";
import type { Tools } from "../core/engine";
import type {
  PrivateAsset,
  DownloadPlan,
  TaskRecord,
  Snapshot,
  Settings,
  DesktopAPI,
  WorkerResponse,
} from "../shared/types";

if (process.env.VIDOWN_TEST_DATA)
  app.setPath("userData", resolve(process.env.VIDOWN_TEST_DATA));
else
  // Keep existing accounts and downloads when changing the displayed product name.
  app.setPath("userData", join(app.getPath("appData"), "Vidown Preview"));
app.setName("Vidown");
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let win: BrowserWindow,
  store: Store,
  browser: BrowserManager,
  tools: Tools,
  work: string;
let sessionKeeper: SessionKeeper;
let webDownloads: WebDownloads;
const assets = new Map<string, PrivateAsset>();
const plans = new Map<string, DownloadPlan>();
const running = new Map<
  string,
  { bridge: TransportBridge; promise: Promise<unknown> }
>();
const stopping = new Map<string, "paused" | "cancelled" | "interrupted">();
let shuttingDown = false,
  shutdownComplete = false;
let settings: Settings;
let engine: Electron.UtilityProcess | undefined;
let initialization: Promise<void> = Promise.resolve();
const bootStart = performance.now();
const startup: Snapshot["startup"] = {};
const engineCalls = new Map<
  string,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    progress?: (data: any) => void;
  }
>();
let clipboardTimer: NodeJS.Timeout | undefined;
let lastClipboard = "";
let updateTimer: NodeJS.Timeout | undefined;
let toolsStatus: Record<string, string> = {};
let snapshotRevision = 0;
function snapshot(): Snapshot {
  return {
    version: app.getVersion(),
    startup: { ...startup },
    revision: ++snapshotRevision,
    tasks: store.list().map((t) => ({
      ...t,
      resumable: webDownloads?.has(t.id)
        ? webDownloads.resumable(t.id)
        : t.resumable && plans.has(t.id),
    })),
    candidates: browser.publicCandidates(),
    tabs: browser.list(),
    activeTab: browser.active,
    settings,
    tools: { ...toolsStatus, browser: browser.backendName },
  };
}
function changed(): void {
  if (updateTimer) return;
  updateTimer = setTimeout(() => {
    updateTimer = undefined;
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send("vidown:update", snapshot());
  }, 150);
}
function task(id: string): TaskRecord {
  const found = store.get(id);
  if (!found) throw new Error("任务不存在");
  return found;
}
function patchTask(id: string, patch: Partial<TaskRecord>): void {
  store.put({ ...task(id), ...patch, updatedAt: Date.now() });
  changed();
}
function callWorker(
  id: string,
  action: "probe" | "download" | "verify-file",
  payload: any,
  progress?: (data: any) => void,
): Promise<any> {
  const worker = ensureEngine();
  return new Promise((resolve, reject) => {
    engineCalls.set(id, { resolve, reject, progress });
    worker.postMessage({ id, action, payload: { ...payload, tools, work } });
  });
}
function ensureEngine(): Electron.UtilityProcess {
  if (engine) return engine;
  const worker = utilityProcess.fork(join(__dirname, "worker.cjs"), [], {
    serviceName: "Vidown Media Worker",
  });
  engine = worker;
  worker.on("message", (message: WorkerResponse) => {
    const call = engineCalls.get(message.id);
    if (!call) return;
    if (message.type === "progress") call.progress?.(message.data);
    else {
      engineCalls.delete(message.id);
      message.type === "error"
        ? call.reject(new Error(message.data))
        : call.resolve(message.data);
    }
  });
  worker.on("exit", () => {
    if (engine === worker) engine = undefined;
    for (const c of engineCalls.values())
      c.reject(new Error("下载工作进程退出，请重试"));
    engineCalls.clear();
  });
  return worker;
}
function secureStorageAvailable(): boolean {
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" ||
      safeStorage.getSelectedStorageBackend() !== "basic_text")
  );
}
function seal(value: unknown): string | undefined {
  if (!secureStorageAvailable()) return;
  return safeStorage.encryptString(JSON.stringify(value)).toString("base64");
}
function unseal(value: string): any {
  return JSON.parse(safeStorage.decryptString(Buffer.from(value, "base64")));
}
async function cookies(): Promise<string> {
  await browser.synchronize();
  const all = await browser.session.cookies.get({});
  return (
    "# Netscape HTTP Cookie File\n" +
    all
      .map((c) =>
        [
          c.httpOnly ? "#HttpOnly_" + c.domain : c.domain,
          (c.domain ?? "").startsWith(".") ? "TRUE" : "FALSE",
          c.path,
          c.secure ? "TRUE" : "FALSE",
          Math.floor(c.expirationDate ?? 0),
          c.name,
          c.value,
        ].join("\t"),
      )
      .join("\n") +
    "\n"
  );
}
async function bridgeFor(
  id: string,
  pageUrl: string,
  onBytes?: (n: number) => void,
): Promise<TransportBridge> {
  const bridge = new TransportBridge(
    (url, init) =>
      browser.session.fetch(url, {
        ...init,
        credentials: "include",
        referrerPolicy: "unsafe-url",
      }),
    join(work, id, "cache"),
    (url) => browser.headersFor(url, pageUrl),
    onBytes,
  );
  await bridge.start();
  return bridge;
}
async function probeInput(input: {
  url?: string;
  candidateId?: string;
  tabId?: string;
}): Promise<any> {
  const candidate = input.candidateId
    ? browser.candidates.get(input.candidateId)
    : undefined;
  if (input.candidateId && !candidate)
    throw new Error("资源已失效，请重新播放以探测");
  let url = httpUrl(
    candidate?.url ??
      (input.url
        ? completeAddress(input.url)
        : (browser.currentUrl(input.tabId) ?? "")),
  );
  await browser.synchronize();
  if (!candidate && new URL(url).hostname === "b23.tv") {
    const response = await browser.session.fetch(url, {
      credentials: "include",
      signal: AbortSignal.timeout(25000),
    });
    url = httpUrl(response.url);
    await response.body?.cancel();
  }
  if (!candidate && pgcTarget(url)) {
    const context = { id: randomUUID(), profile: "browser" };
    const asset = await probePgc(url, context, async (endpoint) => {
      const response = await browser.session.fetch(endpoint, {
        credentials: "include",
        headers: browser.headersFor(endpoint, "https://www.bilibili.com/"),
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok)
        throw new Error(
          `影片请求返回 HTTP ${response.status}，请在浏览器确认登录和访问权限`,
        );
      return JSON.parse(
        (await limitedBody(response, 8 * 1024 * 1024)).toString("utf8"),
      );
    });
    assets.set(asset.id, asset);
    if (assets.size > 100) assets.delete(assets.keys().next().value!);
    return publicAsset(asset);
  }
  if (!candidate && isDouyinPage(url)) {
    const asset = await browser.probeDouyin(url, input.tabId);
    await browser.synchronize();
    assets.set(asset.id, asset);
    if (assets.size > 100) assets.delete(assets.keys().next().value!);
    return publicAsset(asset);
  }
  const telegramPage =
    candidate && isTelegramWeb(candidate.pageUrl)
      ? browser.currentUrl(candidate.tabId)
      : undefined;
  if (
    candidate &&
    isTelegramWeb(candidate.pageUrl) &&
    !isTelegramWeb(telegramPage ?? "")
  )
    throw new Error("资源所属页面已关闭或更换，请重新播放后探测");
  if (telegramPage || isTelegramLink(url)) {
    const ref = await browser.probeTelegram(telegramPage ?? url, {
      tabId: candidate?.tabId ?? input.tabId,
      mediaUrl: candidate?.url,
    });
    const asset: PrivateAsset = {
      id: randomUUID(),
      title: ref.title,
      pageUrl: publicUrl(telegramPage ?? url),
      context: { id: randomUUID(), profile: "browser" },
      tracks: [
        {
          id: randomUUID(),
          kind: "muxed",
          protocol: "browser",
          url: "browser-message",
          selector: JSON.stringify(ref),
          label: "网页原始媒体 · 保存后确认参数",
        },
      ],
      warnings: [
        "使用已登录网页的原始下载操作；预览清晰度不代表原文件规格。网页准备文件期间字节进度可能不可用。",
      ],
    };
    assets.set(asset.id, asset);
    return publicAsset(asset);
  }
  const id = randomUUID(),
    context = { id, profile: "browser" };
  const payload: any = {
    url,
    context,
    headers: browser.headersFor(url, candidate?.pageUrl ?? url),
    cookies: await cookies(),
    proxy: settings.proxy,
  };
  let temporary: TransportBridge | undefined;
  if (
    candidate?.protocol === "hls" ||
    candidate?.protocol === "dash" ||
    /\.(m3u8|mpd)(?:[?#]|$)/i.test(url)
  ) {
    let text = browser.body(url);
    if (!text) {
      const response = await browser.session.fetch(url, {
        headers: payload.headers,
        credentials: "include",
        referrerPolicy: "unsafe-url",
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`清单请求返回 ${response.status}`);
      text = (await limitedBody(response, 8 * 1024 * 1024)).toString("utf8");
    }
    payload.manifestText = text;
  } else if (
    candidate ||
    /\.(mp4|m4a|webm|mp3|flac|mkv)(?:[?#]|$)/i.test(url)
  ) {
    temporary = await bridgeFor(id, candidate?.pageUrl ?? url);
    payload.bridgeUrl = temporary.register(url);
  }
  try {
    const asset: PrivateAsset = await callWorker(id, "probe", {
      input: payload,
    });
    if (isBilibiliPage(url)) {
      try {
        const response = await browser.session.fetch(url, {
          credentials: "include",
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        addBilibiliMirrors(
          asset,
          (await limitedBody(response, 8 * 1024 * 1024)).toString("utf8"),
        );
      } catch {
        asset.warnings.push(
          "备用 CDN 信息未能补充；仍可使用提取器返回的主地址。",
        );
      }
    }
    assets.set(asset.id, asset);
    if (assets.size > 100) assets.delete(assets.keys().next().value!);
    return publicAsset(asset);
  } finally {
    await temporary?.close();
  }
}
function schedule(): void {
  if (shuttingDown) return;
  const active = running.size;
  if (active >= settings.concurrency) return;
  for (const t of store
    .list()
    .filter((t) => t.state === "queued" && t.source !== "browser")
    .reverse()
    .slice(0, settings.concurrency - active))
    void run(t.id);
}
async function run(id: string): Promise<void> {
  const plan = plans.get(id);
  if (!plan) {
    patchTask(id, {
      state: "failed",
      resumable: false,
      error: "会话或计划已丢失，请重新探测",
    });
    return;
  }
  // Reserve a slot before awaiting bridge startup, preventing concurrent queue pumps from over-scheduling.
  const placeholder = {
    bridge: undefined as unknown as TransportBridge,
    promise: Promise.resolve() as Promise<unknown>,
  };
  running.set(id, placeholder);
  let receivedBytes = 0,
    lastBytes = 0,
    lastTime = Date.now(),
    lastUpdate = 0;
  const promise = (async () => {
    try {
      const bridge = await bridgeFor(id, plan.asset.pageUrl, (n) => {
        receivedBytes += n;
        const now = Date.now();
        if (
          now - lastUpdate >= 500 &&
          !stopping.has(id) &&
          task(id).state === "downloading"
        ) {
          patchTask(id, {
            networkBytes: receivedBytes,
            speed: Math.round(
              ((receivedBytes - lastBytes) * 1000) /
                Math.max(1, now - lastTime),
            ),
          });
          lastUpdate = now;
          lastTime = now;
          lastBytes = receivedBytes;
        }
      });
      placeholder.bridge = bridge;
      const actual: DownloadPlan = {
        ...plan,
        tracks: plan.tracks.map((t) => ({
          ...t,
          identity: digest(t.url),
          url: bridge.register(t.url),
          fallbacks: t.fallbacks?.map((source) => ({
            identity: digest(source.url),
            url: bridge.register(source.url),
          })),
        })),
      };
      patchTask(id, {
        state: "downloading",
        error: undefined,
        progress: undefined,
        networkBytes: 0,
        speed: undefined,
      });
      if (stopping.has(id)) throw new Error("操作已中断");
      const output = await callWorker(
        id,
        "download",
        { plan: actual },
        (event) => {
          if (!stopping.has(id))
            patchTask(id, {
              state: event.state ?? task(id).state,
              bytes: event.bytes ?? task(id).bytes,
              progress: event.progress,
              speed:
                event.state && event.state !== "downloading"
                  ? undefined
                  : task(id).speed,
            });
        },
      );
      patchTask(id, {
        state: stopping.get(id) ?? "completed",
        output,
        error: undefined,
        progress: 100,
        networkBytes: receivedBytes,
        speed: undefined,
      });
    } catch (error) {
      patchTask(id, {
        state: stopping.get(id) ?? "failed",
        error: stopping.has(id)
          ? undefined
          : classifyError(
              `${error instanceof Error ? error.message : error}${placeholder.bridge?.lastError ? `；传输详情：${placeholder.bridge.lastError}` : ""}`,
            ),
        resumable: true,
        networkBytes: receivedBytes,
        speed: undefined,
      });
    } finally {
      await placeholder.bridge?.close();
      running.delete(id);
      stopping.delete(id);
      schedule();
    }
  })();
  placeholder.promise = promise;
  await promise;
}
async function download(input: {
  assetId: string;
  trackIds: string[];
  output: "source" | "compatible";
}): Promise<void> {
  const asset = assets.get(input.assetId);
  if (!asset) throw new Error("探测结果已过期，请重新探测");
  if (!["source", "compatible"].includes(input.output))
    throw new Error("未知输出策略");
  const tracks = chooseTracks(asset, input.trackIds);
  if (tracks.some((t) => t.protocol === "browser") && input.output !== "source")
    throw new Error("网页媒体使用原文件保存，请选择保留源规格");
  const id = randomUUID();
  const plan: DownloadPlan = {
    id,
    asset,
    tracks,
    output: input.output,
    directory: settings.downloadDir,
  };
  plans.set(id, plan);
  store.put(
    {
      id,
      title: asset.title,
      state: "queued",
      updatedAt: Date.now(),
      resumable: tracks[0].protocol !== "browser",
      source: tracks[0].protocol === "browser" ? "browser" : undefined,
      pausable: tracks[0].protocol !== "browser",
    },
    seal(plan),
  );
  changed();
  if (tracks[0].protocol === "browser") {
    const ref = JSON.parse(tracks[0].selector!);
    try {
      await webDownloads.capture(id, ref.wc, () => browser.saveTelegram(ref));
    } catch (error) {
      patchTask(id, {
        state: "failed",
        error: classifyError(error),
        resumable: false,
      });
      throw error;
    }
    return;
  }
  schedule();
}
async function taskAction(input: {
  id: string;
  action: string;
}): Promise<void> {
  const t = task(input.id);
  if (input.action !== "open" && webDownloads.has(t.id)) {
    webDownloads.action(t.id, input.action);
    return;
  }
  const job = running.get(t.id);
  switch (input.action) {
    case "open":
      if (t.state === "completed" && t.output) shell.showItemInFolder(t.output);
      return;
    case "pause":
    case "cancel": {
      const desired = input.action === "pause" ? "paused" : "cancelled";
      if (job) {
        stopping.set(t.id, desired);
        engine?.postMessage({ id: t.id, action: "abort", payload: {} });
        await job.bridge?.close();
        await job.promise;
      } else if (
        ["queued", "paused", "interrupted", "failed"].includes(t.state)
      )
        patchTask(t.id, { state: desired });
      return;
    }
    case "resume":
    case "retry":
      if (job) throw new Error("任务仍在停止中，请稍后重试");
      if (!["paused", "failed", "interrupted"].includes(t.state))
        throw new Error(
          "只有暂停、失败或中断的任务可以重试；已完成或取消请新建任务。",
        );
      if (!plans.has(t.id))
        throw new Error(
          "重启后需要重新探测确认账号与源身份；当前版本不自动重用旧会话。",
        );
      patchTask(t.id, { state: "queued", error: undefined });
      schedule();
      return;
    default:
      throw new Error("未知任务操作");
  }
}
let settingsQueue = Promise.resolve();
let settingsInitialized = false;
function saveSettings(input: Partial<Settings>): Promise<void> {
  const pending = settingsQueue.then(() => applySettings(input));
  settingsQueue = pending.catch(() => {});
  return pending;
}
async function applySettings(input: Partial<Settings>): Promise<void> {
  const next = { ...settings, ...input, density: "compact" as const };
  if (
    !Number.isInteger(next.concurrency) ||
    next.concurrency < 1 ||
    next.concurrency > 4
  )
    throw new Error("并发任务数应为 1–4");
  if (
    typeof next.downloadDir !== "string" ||
    !next.downloadDir.trim() ||
    typeof next.proxy !== "string" ||
    typeof next.clipboard !== "boolean"
  )
    throw new Error("无效设置");
  if (next.proxy && !/^(https?|socks5):\/\/[^\s]+$/.test(next.proxy))
    throw new Error("代理格式应为 http:// 或 socks5://");
  if (
    !["system", "dark", "light"].includes(next.colorMode) ||
    !["iris", "ocean", "jade", "rose"].includes(next.theme) ||
    typeof next.animations !== "boolean"
  )
    throw new Error("无效的外观设置");
  if (!settingsInitialized || next.downloadDir !== settings.downloadDir)
    await mkdir(resolve(next.downloadDir), { recursive: true });
  next.downloadDir = resolve(next.downloadDir);
  if (!settingsInitialized || next.proxy !== settings.proxy) {
    await browser.configureProxy(next.proxy);
    if (settingsInitialized) await browser.session.closeAllConnections();
  }
  const clipboardChanged =
    !settingsInitialized || next.clipboard !== settings.clipboard;
  settings = next;
  settingsInitialized = true;
  nativeTheme.themeSource = settings.colorMode;
  const { hoverGlow: _removed, ...retained } = store.settings();
  store.saveSettings({
    ...retained,
    ...settings,
    clipboardAutofillVersion: 1,
  });
  changed();
  schedule();
  if (clipboardChanged && clipboardTimer) clearInterval(clipboardTimer);
  if (clipboardChanged && settings.clipboard) {
    lastClipboard = "";
    const readClipboard = async () => {
      if (!settings.clipboard || shuttingDown) return;
      const text = (await clipboard.readText()).trim();
      if (!settings.clipboard || shuttingDown) return;
      if (text !== lastClipboard) {
        lastClipboard = text;
        if (
          /^(?:https?:\/\/|(?:[\p{L}\d-]+\.)+[\p{L}]{2,}(?:[/:?#]|$)|localhost[:/?#]|127\.)/iu.test(
            text,
          )
        ) {
          try {
            const url = completeAddress(text);
            if (!win.isDestroyed())
              win.webContents.send("vidown:clipboard", url);
          } catch {
            /* Non-web clipboard content is ignored. */
          }
        }
      }
    };
    clipboardTimer = setInterval(readClipboard, 600);
    win.webContents.once("did-finish-load", () =>
      setTimeout(() => void readClipboard(), 150),
    );
  }
}
let historyBusy = false;
let dataClearing = false;
let pendingActions = 0;
async function clearData(input: { browser: boolean; history: boolean }) {
  if (
    !input ||
    typeof input.browser !== "boolean" ||
    typeof input.history !== "boolean" ||
    (!input.browser && !input.history)
  )
    throw new Error("请选择需要清除的数据");
  if (dataClearing || pendingActions || historyBusy)
    throw new Error("正在处理其他操作，请稍后清理");
  if (
    input.browser &&
    (running.size || store.list().some((t) => !canRemoveHistory(t)))
  )
    throw new Error(
      "请先完成或取消下载任务（包括等待和暂停的任务），再清除浏览器数据",
    );
  dataClearing = true;
  try {
    if (input.browser) {
      await browser.clearData();
      await sessionKeeper.clear();
      assets.clear();
      plans.clear();
      store.forgetPlans();
    }
    const result = input.history
      ? await removeHistory({ deleteFiles: false })
      : { removed: 0, failed: [] };
    if (result.failed.length)
      throw new Error(`部分记录未清除：${result.failed[0].error}`);
    return { removed: result.removed };
  } finally {
    dataClearing = false;
    changed();
  }
}
async function removeHistory(input: { ids?: string[]; deleteFiles: boolean }) {
  if (
    !input ||
    typeof input.deleteFiles !== "boolean" ||
    (input.ids !== undefined &&
      (!Array.isArray(input.ids) ||
        input.ids.length > 10000 ||
        input.ids.some((id) => typeof id !== "string")))
  )
    throw new Error("无效的历史删除请求");
  if (historyBusy) throw new Error("正在清理记录，请稍候");
  historyBusy = true;
  const result: { removed: number; failed: { id: string; error: string }[] } = {
    removed: 0,
    failed: [],
  };
  try {
    const ids = input.ids
      ? [...new Set(input.ids)]
      : store
          .list()
          .filter(canRemoveHistory)
          .map((t) => t.id);
    for (const id of ids) {
      try {
        const t = task(id);
        if (!canRemoveHistory(t) || running.has(id) || webDownloads.busy(id))
          throw new Error("任务仍在执行或暂停，请先完成或取消后再删除记录");
        if (input.deleteFiles && t.output) {
          try {
            const info = await lstat(t.output);
            if (!info.isFile() || info.isSymbolicLink())
              throw new Error("成品路径不是普通文件，记录已保留");
            await shell.trashItem(t.output);
          } catch (error: any) {
            if (error.code !== "ENOENT") throw error;
          }
        }
        store.remove(id);
        plans.delete(id);
        result.removed++;
      } catch (error) {
        result.failed.push({ id, error: classifyError(error) });
      }
    }
    changed();
    return result;
  } finally {
    historyBusy = false;
  }
}
async function diagnostics(): Promise<string | undefined> {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: "Vidown-diagnostics.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return;
  const report = {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    tools: toolsStatus,
    tasks: store.list().map(({ id, sequence, state, error }) => ({
      id,
      sequence,
      state,
      error: redact(error ?? ""),
      phases: store
        .events(id)
        .map(({ sequence, state }) => ({ sequence, state })),
    })),
    stage: "Windows desktop",
    accountTests: "pending",
  };
  await writeFile(result.filePath, JSON.stringify(report, null, 2));
  return result.filePath;
}
function registerIPC(): void {
  const methods: Record<string, (input: any) => any> = {
    snapshot: () => snapshot(),
    probe: probeInput,
    download,
    task: taskAction,
    history: removeHistory,
    clearData,
    browser: async (input) => {
      if (input.action === "logout") {
        await clearData({ browser: true, history: false });
      } else await browser.action(input);
    },
    settings: saveSettings,
    directory: async () => {
      const result = await dialog.showOpenDialog(win, {
        properties: ["openDirectory", "createDirectory"],
      });
      return result.filePaths[0];
    },
    diagnostics,
  };
  for (const [name, handler] of Object.entries(methods))
    ipcMain.handle("vidown:" + name, async (event, input) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("拒绝远程页面调用应用接口");
      if (shuttingDown) {
        // Resize/visibility callbacks may arrive while the window is closing.
        // They cannot start work and must not reject an unawaited UI update.
        if (name === "browser" && ["hide", "bounds"].includes(input?.action))
          return;
        throw new Error("应用正在退出，请重新启动后继续。");
      }
      try {
        if (name !== "snapshot") await initialization;
        const passive =
          name === "snapshot" ||
          (name === "browser" && input?.action === "hide");
        if (!passive && dataClearing)
          throw new Error("正在清除本地数据，请稍候");
        const tracked =
          !passive &&
          name !== "clearData" &&
          !(name === "browser" && input?.action === "logout");
        if (tracked) pendingActions++;
        try {
          return await handler(input);
        } finally {
          if (tracked) pendingActions--;
        }
      } catch (error) {
        throw new Error(classifyError(error));
      }
    });
}
async function boot(): Promise<void> {
  await app.whenReady();
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  if (process.platform === "win32") app.setAppUserModelId("top.xuzimo.vidown");
  await mkdir(app.getPath("userData"), { recursive: true });
  work = join(app.getPath("userData"), "work");
  await mkdir(work, { recursive: true });
  // The extractor normally removes these in finally; recover from an interrupted worker too.
  for (const entry of await readdir(work, { withFileTypes: true }))
    if (
      entry.isFile() &&
      /^[a-f0-9-]{36}\.(cookies\.txt|cookie-info\.json)$/.test(entry.name)
    )
      await rm(join(work, entry.name), { force: true });
  store = new Store(join(app.getPath("userData"), "vidown.sqlite"));
  const saved = store.settings();
  settings = {
    downloadDir: saved.downloadDir ?? join(app.getPath("videos"), "Vidown"),
    concurrency: saved.concurrency ?? 2,
    proxy: saved.proxy ?? "",
    clipboard:
      saved.clipboardAutofillVersion === 1 ? (saved.clipboard ?? true) : true,
    colorMode: saved.colorMode ?? "system",
    theme: saved.theme ?? "iris",
    animations: saved.animations ?? true,
    density: "compact",
  };
  const dir = app.isPackaged
    ? join(process.resourcesPath, "tools")
    : resolve("resources/tools");
  const exe = process.platform === "win32" ? ".exe" : "";
  tools = {
    ytdlp: join(dir, "yt-dlp" + exe),
    m3u8: join(dir, "N_m3u8DL-RE" + exe),
    ffmpeg: join(dir, "ffmpeg" + exe),
    ffprobe: join(dir, "ffprobe" + exe),
    runtime: process.execPath,
  };
  for (const [key, path] of Object.entries(tools))
    toolsStatus[key] = existsSync(path)
      ? "已就绪"
      : "未安装：运行 npm run tools:prepare";
  try {
    toolsStatus.receipts = JSON.stringify(
      JSON.parse(
        await readFile(join(dir, "tools.lock.json"), "utf8"),
      ).receipts.map((r: any) => ({ name: r.name, version: r.version })),
    );
  } catch {}
  toolsStatus.credentials = secureStorageAvailable()
    ? "系统安全存储可用"
    : "安全存储不可用：本次会话不持久化敏感计划";
  win = new BrowserWindow({
    width: 1400,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    title: "Vidown",
    icon: app.isPackaged
      ? join(
          process.resourcesPath,
          process.platform === "win32" ? "icon.ico" : "icon.png",
        )
      : join(
          app.getAppPath(),
          process.platform === "win32"
            ? "assets/icon.ico"
            : "assets/icon_512.png",
        ),
    backgroundColor:
      settings.colorMode === "light" ||
      (settings.colorMode === "system" && !nativeTheme.shouldUseDarkColors)
        ? "#f5f6fa"
        : "#10131b",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once("ready-to-show", () => {
    if (!process.env.VIDOWN_HEADLESS) win.show();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  const BrowserHost =
    process.platform === "win32" &&
    process.env.VIDOWN_BROWSER_BACKEND !== "chromium"
      ? WebView2Browser
      : BrowserManager;
  browser = new BrowserHost(
    win,
    changed,
    saved.browserZoom ?? {},
    (browserZoom) => store.saveSettings({ ...store.settings(), browserZoom }),
  );
  if (process.env.VIDOWN_TEST_DATA)
    (globalThis as any).__vidownBrowser = browser;
  sessionKeeper = new SessionKeeper(
    browser.session,
    () => store.settings().browserSession,
    (browserSession) =>
      store.saveSettings({ ...store.settings(), browserSession }),
    seal,
    unseal,
  );
  webDownloads = new WebDownloads(
    browser.session,
    (wc) => browser.owns(wc),
    store,
    work,
    () => settings.downloadDir,
    changed,
    (id, file) => callWorker(id, "verify-file", { file }),
    (id) => engine?.postMessage({ id, action: "abort", payload: {} }),
  );
  registerIPC();
  app.on("second-instance", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  win.on("close", (event) => {
    if (!shutdownComplete) {
      event.preventDefault();
      app.quit();
    }
  });
  win.on("closed", () => browser.close());
  initialization = (async () => {
    await sessionKeeper.restore();
    await saveSettings(settings);
    startup.readyMs = Math.round(performance.now() - bootStart);
    changed();
  })();
  // Keep early initialization failures handled while the local shell loads.
  void initialization.catch(() => {});
  // Display the local shell while sessions initialize. Remote navigation and all
  // mutations wait for initialization; downloads spawn their worker on demand.
  if (process.env.ELECTRON_RENDERER_URL)
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(__dirname, "../renderer/index.html"));
  startup.shellMs = Math.round(performance.now() - bootStart);
  changed();
  await initialization;
}
if (single)
  void boot().catch((error) => {
    console.error(classifyError(error));
    app.exit(1);
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  if (clipboardTimer) clearInterval(clipboardTimer);
  if (updateTimer) clearTimeout(updateTimer);
  for (const id of engineCalls.keys())
    engine?.postMessage({ id, action: "abort", payload: {} });
  const jobs: Promise<unknown>[] = [];
  if (webDownloads) jobs.push(webDownloads.close());
  for (const [id, job] of running) {
    stopping.set(id, "interrupted");
    engine?.postMessage({ id, action: "abort", payload: {} });
    if (job.bridge) jobs.push(job.bridge.close());
    jobs.push(job.promise);
  }
  // Let download components receive abort and exit before terminating their parent.
  void (async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.allSettled(jobs),
        new Promise<void>((r) => {
          timer = setTimeout(r, 8000);
        }),
      ]);
      const end = Date.now() + 2000;
      while (engineCalls.size && Date.now() < end)
        await new Promise((r) => setTimeout(r, 25));
    } finally {
      if (timer) clearTimeout(timer);
      engine?.kill();
      await initialization.catch(() => {});
      if (browser) await browser.shutdown().catch(() => {});
      if (sessionKeeper) await sessionKeeper.close().catch(() => {});
      shutdownComplete = true;
      app.quit();
    }
  })();
});
