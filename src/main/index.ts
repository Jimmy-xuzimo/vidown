import {
  app,
  BrowserWindow,
  ipcMain,
  utilityProcess,
  dialog,
  shell,
  safeStorage,
  clipboard,
} from "electron";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { Store } from "../core/store";
import { TransportBridge, limitedBody } from "../core/bridge";
import { chooseTracks, publicAsset } from "../core/formats";
import { isBilibiliPage, addBilibiliMirrors } from "../core/bilibili";
import {
  httpUrl,
  classifyError,
  publicUrl,
  redact,
  digest,
} from "../core/safety";
import { BrowserManager } from "./browser";
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
app.setName("Vidown Preview");
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let win: BrowserWindow,
  store: Store,
  browser: BrowserManager,
  tools: Tools,
  work: string;
const assets = new Map<string, PrivateAsset>();
const plans = new Map<string, DownloadPlan>();
const running = new Map<
  string,
  { bridge: TransportBridge; promise: Promise<unknown>; fileId?: number }
>();
const stopping = new Map<string, "paused" | "cancelled" | "interrupted">();
let shuttingDown = false,
  shutdownComplete = false;
let settings: Settings,
  telegramState = { state: "未配置", detail: undefined as string | undefined };
let engine: Electron.UtilityProcess, telegram: Electron.UtilityProcess;
const engineCalls = new Map<
  string,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    progress?: (data: any) => void;
  }
>();
const telegramCalls = new Map<
  string,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
let clipboardTimer: NodeJS.Timeout | undefined;
let lastClipboard = "";
let updateTimer: NodeJS.Timeout | undefined;
let toolsStatus: Record<string, string> = {};
let snapshotRevision = 0;
function snapshot(): Snapshot {
  return {
    revision: ++snapshotRevision,
    tasks: store.list().map((t) => ({
      ...t,
      resumable: t.resumable && plans.has(t.id),
    })),
    candidates: browser.publicCandidates(),
    tabs: browser.list(),
    activeTab: browser.active,
    settings,
    tools: toolsStatus,
    telegram: telegramState,
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
  action: "probe" | "download",
  payload: any,
  progress?: (data: any) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    engineCalls.set(id, { resolve, reject, progress });
    engine.postMessage({ id, action, payload: { ...payload, tools, work } });
  });
}
function callTelegram(action: string, payload: any = {}): Promise<any> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    telegramCalls.set(id, { resolve, reject });
    telegram.postMessage({ id, action, payload });
  });
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
  const url = httpUrl(
    candidate?.url ?? input.url ?? browser.currentUrl(input.tabId) ?? "",
  );
  if (/^https?:\/\/(?:t\.me|telegram\.me)\//i.test(url)) {
    const media = await callTelegram("probe", { url });
    const asset: PrivateAsset = {
      id: randomUUID(),
      title: media.title,
      pageUrl: publicUrl(url),
      context: { id: randomUUID(), profile: "telegram" },
      duration: media.duration,
      warnings: [],
      tracks: [
        {
          id: randomUUID(),
          kind: media.audio ? "audio" : "muxed",
          protocol: "telegram",
          url: String(media.fileId),
          label: "Telegram 原始媒体",
          width: media.width,
          height: media.height,
        },
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
    .filter((t) => t.state === "queued")
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
    fileId: undefined as number | undefined,
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
      let actual: DownloadPlan = {
        ...plan,
        tracks: plan.tracks.map((t) => ({
          ...t,
          identity: digest(t.url),
          url: t.protocol === "telegram" ? t.url : bridge.register(t.url),
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
      if (plan.tracks.some((t) => t.protocol === "telegram")) {
        const fileId = Number(plan.tracks[0].url);
        placeholder.fileId = fileId;
        const file = await callTelegram("download", { fileId });
        actual = {
          ...actual,
          tracks: actual.tracks.map((t) => ({ ...t, url: file.path })),
        };
      }
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
      resumable: true,
    },
    seal(plan),
  );
  changed();
  schedule();
}
async function taskAction(input: {
  id: string;
  action: string;
}): Promise<void> {
  const t = task(input.id);
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
        engine.postMessage({ id: t.id, action: "abort", payload: {} });
        if (job.fileId) void callTelegram("cancel", { fileId: job.fileId });
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
          "重启后需要重新探测确认账号与源身份；本验证版不自动重用旧会话。",
        );
      patchTask(t.id, { state: "queued", error: undefined });
      schedule();
      return;
    default:
      throw new Error("未知任务操作");
  }
}
async function saveSettings(input: Partial<Settings>): Promise<void> {
  const next = { ...settings, ...input };
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
  await mkdir(resolve(next.downloadDir), { recursive: true });
  next.downloadDir = resolve(next.downloadDir);
  await browser.session.setProxy(
    next.proxy ? { proxyRules: next.proxy } : { mode: "system" },
  );
  await browser.session.closeAllConnections();
  settings = next;
  store.saveSettings({ ...store.settings(), ...settings });
  changed();
  schedule();
  if (clipboardTimer) clearInterval(clipboardTimer);
  if (settings.clipboard) {
    lastClipboard = await clipboard.readText();
    clipboardTimer = setInterval(async () => {
      const text = await clipboard.readText();
      if (text !== lastClipboard) {
        lastClipboard = text;
        if (/^https?:\/\/\S+$/.test(text))
          win.webContents.send("vidown:clipboard", publicUrl(text));
      }
    }, 2000);
  }
}
async function telegramAction(input: any): Promise<any> {
  if (input.action === "init") {
    if (
      !Number.isInteger(input.apiId) ||
      input.apiId <= 0 ||
      !/^[0-9a-f]{32}$/i.test(input.apiHash ?? "")
    )
      throw new Error("请输入你为 Vidown 注册的 Telegram API ID 和 API Hash");
    const key = randomBytes(32).toString("base64");
    const protectedConfig = seal({
      apiId: input.apiId,
      apiHash: input.apiHash,
      key,
    });
    if (!protectedConfig)
      throw new Error("系统安全存储不可用，不能保存 Telegram 会话密钥");
    store.saveSettings({ ...store.settings(), telegram: protectedConfig });
    return callTelegram("init", {
      apiId: input.apiId,
      apiHash: input.apiHash,
      key,
      directory: join(app.getPath("userData"), "telegram"),
    });
  }
  if (!["phone", "code", "password", "logout"].includes(input.action))
    throw new Error("未知 Telegram 操作");
  return callTelegram(input.action, { value: input.value });
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
    stage: "M0 preview",
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
    browser: (input) => browser.action(input),
    settings: saveSettings,
    directory: async () => {
      const result = await dialog.showOpenDialog(win, {
        properties: ["openDirectory", "createDirectory"],
      });
      return result.filePaths[0];
    },
    diagnostics,
    telegram: telegramAction,
  };
  for (const [name, handler] of Object.entries(methods))
    ipcMain.handle("vidown:" + name, async (event, input) => {
      if (shuttingDown) throw new Error("应用正在退出，请重新启动后继续。");
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("拒绝远程页面调用应用接口");
      try {
        return await handler(input);
      } catch (error) {
        throw new Error(classifyError(error));
      }
    });
}
async function boot(): Promise<void> {
  await app.whenReady();
  await mkdir(app.getPath("userData"), { recursive: true });
  work = join(app.getPath("userData"), "work");
  await mkdir(work, { recursive: true });
  // The extractor normally removes these in finally; recover from an interrupted worker too.
  for (const entry of await readdir(work, { withFileTypes: true }))
    if (entry.isFile() && /^[a-f0-9-]{36}\.cookies\.txt$/.test(entry.name))
      await rm(join(work, entry.name), { force: true });
  store = new Store(join(app.getPath("userData"), "vidown.sqlite"));
  const saved = store.settings();
  settings = {
    downloadDir: saved.downloadDir ?? join(app.getPath("videos"), "Vidown"),
    concurrency: saved.concurrency ?? 2,
    proxy: saved.proxy ?? "",
    clipboard: saved.clipboard ?? false,
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
    minWidth: 1100,
    minHeight: 760,
    title: "Vidown · 重建验证版",
    backgroundColor: "#11141c",
    show: !process.env.VIDOWN_HEADLESS,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  browser = new BrowserManager(win, changed);
  engine = utilityProcess.fork(join(__dirname, "worker.cjs"), [], {
    serviceName: "Vidown Media Worker",
  });
  engine.on("message", (message: WorkerResponse) => {
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
  engine.on("exit", () => {
    for (const c of engineCalls.values())
      c.reject(new Error("下载工作进程退出，请重启应用"));
    engineCalls.clear();
  });
  telegram = utilityProcess.fork(join(__dirname, "telegram.cjs"), [], {
    serviceName: "Vidown Telegram Worker",
  });
  telegram.on("message", (message: any) => {
    if (message.event === "auth") {
      telegramState = { state: message.state, detail: message.detail };
      changed();
      return;
    }
    if (message.event === "file") {
      for (const [id, job] of running)
        if (job.fileId === message.fileId)
          patchTask(id, { bytes: message.bytes });
      return;
    }
    const call = telegramCalls.get(message.id);
    if (call) {
      telegramCalls.delete(message.id);
      message.type === "error"
        ? call.reject(new Error(message.data))
        : call.resolve(message.data);
    }
  });
  telegram.on("exit", () => {
    for (const c of telegramCalls.values())
      c.reject(new Error("Telegram 工作进程退出"));
    telegramCalls.clear();
    telegramState = { state: "工作进程退出", detail: undefined };
    changed();
  });
  void callTelegram("version")
    .then((version) => {
      toolsStatus.tdlib = version;
      changed();
    })
    .catch((error) => {
      toolsStatus.tdlib = classifyError(error);
      changed();
    });
  if (saved.telegram) {
    try {
      const config = unseal(saved.telegram);
      void callTelegram("init", {
        ...config,
        directory: join(app.getPath("userData"), "telegram"),
      }).catch((error) => {
        telegramState = { state: "error", detail: classifyError(error) };
        changed();
      });
    } catch {
      telegramState = { state: "需要重新配置", detail: undefined };
    }
  }
  registerIPC();
  await saveSettings(settings);
  if (process.env.ELECTRON_RENDERER_URL)
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(__dirname, "../renderer/index.html"));
  app.on("second-instance", () => {
    win.show();
    win.focus();
  });
  win.on("close", (event) => {
    if (!shutdownComplete) {
      event.preventDefault();
      app.quit();
    }
  });
  win.on("closed", () => {
    browser.close();
  });
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
  for (const [id, job] of running) {
    stopping.set(id, "interrupted");
    engine?.postMessage({ id, action: "abort", payload: {} });
    if (job.fileId) jobs.push(callTelegram("cancel", { fileId: job.fileId }));
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
      telegram?.kill();
      shutdownComplete = true;
      app.quit();
    }
  })();
});
