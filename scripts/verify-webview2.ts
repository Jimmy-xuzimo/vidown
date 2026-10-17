import { _electron, type ElectronApplication } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createFixtures } from "./fixtures";
import { digest } from "../src/core/safety";

const root = resolve("work/webview2-verification");
await mkdir(root, { recursive: true });
const profile = join(root, "profile-" + randomUUID());
const dir = resolve("resources/tools");
const fixture = await createFixtures(join(root, "fixtures"), {
  ffmpeg: join(dir, "ffmpeg.exe"),
  ffprobe: join(dir, "ffprobe.exe"),
  m3u8: join(dir, "N_m3u8DL-RE.exe"),
  ytdlp: join(dir, "yt-dlp.exe"),
  runtime: process.execPath,
});
const env: NodeJS.ProcessEnv = {
  ...process.env,
  VIDOWN_TEST_DATA: profile,
  VIDOWN_HEADLESS: "",
  VIDOWN_BROWSER_BACKEND: "webview2",
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  _electron.launch({
    ...(process.env.VIDOWN_VERIFY_EXECUTABLE
      ? {
          executablePath: resolve(process.env.VIDOWN_VERIFY_EXECUTABLE),
          args: [],
        }
      : { args: ["."] }),
    cwd: resolve("."),
    env: env as Record<string, string>,
  });
let app: ElectronApplication | undefined;
let originalClipboard: string | undefined;
const results: { name: string; status: string }[] = [];
async function until(check: () => Promise<boolean>, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("WebView2 assertion timed out");
}
try {
  app = await launch();
  let page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  const initial = await page.evaluate(() => window.vidown.snapshot());
  assert.equal(initial.settings.density, "compact");
  assert.equal(initial.settings.clipboard, true);
  assert.match(initial.tools.browser, /Windows WebView2/);
  assert.equal(await page.getByLabel("界面密度", { exact: true }).count(), 0);
  assert(
    !/Telegram|YouTube|B 站|B站|X 登录/i.test(
      await page.locator("body").innerText(),
    ),
  );
  if (process.env.VIDOWN_VERIFY_SKIP_CLIPBOARD === "1") {
    await page.evaluate(() => window.vidown.settings({ clipboard: false }));
    results.push({
      name: "os-clipboard-check-explicitly-skipped-in-environment-that-replaces-clipboard-content",
      status: "skipped",
    });
  } else {
    originalClipboard = await app.evaluate(
      async ({ clipboard }) => await clipboard.readText(),
    );
    const copied =
      "https://example.test/watch?quality=original&signature=controlled-test#part-2";
    await app.evaluate(
      async ({ clipboard }, text) => await clipboard.writeText(text),
      copied,
    );
    try {
      await until(
        async () =>
          (await page.getByLabel("视频链接", { exact: true }).inputValue()) ===
          copied,
        5000,
      );
    } catch {
      const clipboardMatches = await app.evaluate(
        async ({ clipboard }, expected) =>
          (await clipboard.readText()) === expected,
        copied,
      );
      const clipboardEnabled = (
        await page.evaluate(() => window.vidown.snapshot())
      ).settings.clipboard;
      throw new Error(
        JSON.stringify({
          check: "clipboard-autofill",
          clipboardMatches,
          clipboardEnabled,
        }),
      );
    }
    assert.equal(
      (await page.evaluate(() => window.vidown.snapshot())).tasks.length,
      0,
    );
    await page.evaluate(() => window.vidown.settings({ clipboard: false }));
    await app.evaluate(
      async ({ clipboard }) =>
        await clipboard.writeText("https://ignored.example.test/"),
    );
    await page.waitForTimeout(900);
    assert.equal(
      await page.getByLabel("视频链接", { exact: true }).inputValue(),
      copied,
    );
    results.push({
      name: "generic-ui-fixed-compact-and-clipboard-autofill-preserves-query-and-fragment-without-starting-download",
      status: "passed",
    });
  }
  await page.evaluate(
    (path) => window.vidown.settings({ downloadDir: path }),
    join(root, "downloads"),
  );
  await page.getByRole("button", { name: "浏览器探测", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: /导入.*Cookie|导入 cookies\.txt/ })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "新标签页", exact: true }).click();
  await until(
    async () =>
      (await page.evaluate(() => window.vidown.snapshot())).tabs.length === 1,
  );
  await page.getByRole("button", { name: "新标签页", exact: true }).waitFor();
  await until(
    async () =>
      !(await page
        .getByRole("button", { name: "新标签页", exact: true })
        .isDisabled()),
  );
  await page.getByRole("region", { name: "新标签页", exact: true }).waitFor();
  await until(
    async () =>
      !(
        await app!.evaluate(async () =>
          (globalThis as any).__vidownBrowser.geometry(),
        )
      ).visible,
  );
  assert.equal(
    await page.locator(".browser-welcome h2").innerText(),
    "把精彩，完整保存。",
  );
  await page.screenshot({
    path: join(root, "welcome-1.0.0.png"),
    animations: "disabled",
  });
  results.push({
    name: "soft-local-welcome-page-and-native-blank-surface-hidden",
    status: "passed",
  });
  await page.evaluate(
    (url) => window.vidown.browser({ action: "new", url }),
    fixture.origin + "/login",
  );
  await until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).candidates.some(
      (c) => c.protocol === "hls",
    ),
  );
  let tab = (await page.evaluate(() => window.vidown.snapshot())).activeTab!;
  const isolation = await app.evaluate(
    async (_, id) =>
      (globalThis as any).__vidownBrowser.execute(
        id,
        "({appAPI:typeof window.vidown,node:typeof require,agent:navigator.userAgent})",
      ),
    tab,
  );
  assert.equal(isolation.appAPI, "undefined");
  assert.equal(isolation.node, "undefined");
  assert.match(isolation.agent, /Edg/);
  const geometry = await app.evaluate(async () =>
    (globalThis as any).__vidownBrowser.geometry(),
  );
  const parent = await app.evaluate(({ BrowserWindow }) => {
    const h = BrowserWindow.getAllWindows()[0].getNativeWindowHandle();
    return h.readBigUInt64LE().toString();
  });
  assert.equal(geometry.parent, parent);
  assert(geometry.visible && geometry.width > 100 && geometry.height > 100);
  const preview = await app.evaluate(
    async (_, id) => (globalThis as any).__vidownBrowser.capturePreview(id),
    tab,
  );
  await writeFile(
    join(root, "native-page.png"),
    Buffer.from(preview, "base64"),
  );
  for (const size of [
    [900, 600],
    [1000, 640],
    [1400, 900],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, factor) =>
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor),
      size[0] === 1000 ? 1.25 : 1,
    );
    await app.evaluate(
      ({ BrowserWindow }, [width, height]) =>
        BrowserWindow.getAllWindows()[0].setContentSize(width, height),
      size,
    );
    await until(async () => {
      const rect = await page.locator(".browser-surface").boundingBox();
      const native = await app!.evaluate(async ({ screen, BrowserWindow }) => ({
        bounds: await (globalThis as any).__vidownBrowser.geometry(),
        dpi: screen.getDisplayMatching(
          BrowserWindow.getAllWindows()[0].getBounds(),
        ).scaleFactor,
        zoom: BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
        contentOrigin: screen.dipToScreenPoint({
          x: BrowserWindow.getAllWindows()[0].getContentBounds().x,
          y: BrowserWindow.getAllWindows()[0].getContentBounds().y,
        }),
      }));
      return (
        !!rect &&
        native.bounds.visible &&
        Math.abs(
          native.bounds.screenX -
            (native.contentOrigin.x + rect.x * native.dpi * native.zoom),
        ) <= 2 &&
        Math.abs(
          native.bounds.screenY -
            (native.contentOrigin.y + rect.y * native.dpi * native.zoom),
        ) <= 2 &&
        Math.abs(native.bounds.width - rect.width * native.dpi * native.zoom) <=
          2 &&
        Math.abs(
          native.bounds.height - rect.height * native.dpi * native.zoom,
        ) <= 2
      );
    });
  }
  const chrome = await page.locator(".browser-tools").boundingBox();
  const surface = await page.locator(".browser-surface").boundingBox();
  assert(chrome && surface && chrome.y + chrome.height <= surface.y + 1);
  assert.equal(
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()),
    null,
  );
  await page.getByLabel("网页缩放", { exact: true }).selectOption("0.75");
  await until(
    async () =>
      (await page.evaluate(() => window.vidown.snapshot())).tabs.find(
        (t) => t.id === tab,
      )?.zoomFactor === 0.75,
  );
  await page.getByRole("button", { name: "下载工作台", exact: true }).click();
  await until(
    async () =>
      !(
        await app!.evaluate(async () =>
          (globalThis as any).__vidownBrowser.geometry(),
        )
      ).visible,
  );
  results.push({
    name: "native-screen-origin-and-size-align-at-900px-and-ui-125-percent-with-visible-toolbar-and-page-75-percent",
    status: "passed",
  });
  await app.evaluate(
    async (_, id) =>
      (globalThis as any).__vidownBrowser.execute(
        id,
        "localStorage.setItem('persistence','native'); new Promise((resolve,reject)=>{const r=indexedDB.open('controlled-native',1);r.onupgradeneeded=()=>r.result.createObjectStore('store');r.onsuccess=()=>{r.result.close();resolve(true)};r.onerror=reject;})",
      ),
    tab,
  );
  results.push({
    name: "actual-system-webview2-embedded-child-window-network-detection-and-no-page-application-api",
    status: "passed",
  });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.vidown.snapshot())).tabs.length,
    0,
  );
  const asset = await page.evaluate(
    (url) => window.vidown.probe({ url }),
    fixture.origin + "/auth/master.m3u8",
  );
  assert(
    asset.tracks.some((t) => t.kind === "video") &&
      asset.tracks.some((t) => t.kind === "audio"),
  );
  await page.evaluate(
    ({ assetId, trackIds }) =>
      window.vidown.download({ assetId, trackIds, output: "source" }),
    {
      assetId: asset.id,
      trackIds: asset.tracks
        .filter((t) => t.kind === "video" || t.kind === "audio")
        .map((t) => t.id),
    },
  );
  await until(async () => {
    const s = await page.evaluate(() => window.vidown.snapshot());
    const f = s.tasks.find((t) => t.state === "failed");
    if (f) throw new Error(f.error);
    return s.tasks.some((t) => t.state === "completed");
  });
  results.push({
    name: "native-login-cookie-survives-restart-and-workbench-authenticated-hls-download-merge-and-verification",
    status: "passed",
  });
  await page.getByRole("button", { name: "浏览器探测", exact: true }).click();
  await page.evaluate(
    (url) => window.vidown.browser({ action: "new", url }),
    fixture.origin + "/player",
  );
  await until(
    async () =>
      !(await page.evaluate(() => window.vidown.snapshot())).tabs.some(
        (t) => t.loading,
      ),
  );
  tab = (await page.evaluate(() => window.vidown.snapshot())).activeTab!;
  const persisted = await app.evaluate(
    async (_, id) =>
      (globalThis as any).__vidownBrowser.execute(
        id,
        "({local:localStorage.getItem('persistence'),databases:indexedDB.databases().then(d=>d.map(x=>x.name))})",
      ),
    tab,
  );
  assert.equal(persisted.local, "native");
  const databases = await app.evaluate(
    async (_, id) =>
      (globalThis as any).__vidownBrowser.execute(
        id,
        "indexedDB.databases().then(d=>d.map(x=>x.name))",
      ),
    tab,
  );
  assert(databases.includes("controlled-native"));
  const source = await readFile(join(fixture.root, "direct.mp4"));
  await app.evaluate(
    async (_, input) =>
      (globalThis as any).__vidownBrowser.execute(
        input.tab,
        `(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(input.base64)}),c=>c.charCodeAt(0));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));a.download='native-blob.mp4';a.click();})()`,
      ),
    { tab, base64: source.toString("base64") },
  );
  await until(async () => {
    const s = await page.evaluate(() => window.vidown.snapshot());
    const f = s.tasks.find(
      (t) => t.title.includes("native-blob") && t.state === "failed",
    );
    if (f) throw new Error(f.error);
    return s.tasks.some(
      (t) => t.title.includes("native-blob") && t.state === "completed",
    );
  });
  const saved = (
    await page.evaluate(() => window.vidown.snapshot())
  ).tasks.find(
    (t) => t.title.includes("native-blob") && t.state === "completed",
  )!;
  assert.equal(digest(await readFile(saved.output!)), digest(source));
  results.push({
    name: "native-localstorage-indexeddb-persistence-and-real-blob-download-through-native-task-with-identical-file-hash",
    status: "passed",
  });
  await page.evaluate(() => window.vidown.browser({ action: "logout" }));
  await assert.rejects(
    page.evaluate(
      (url) => window.vidown.probe({ url }),
      fixture.origin + "/auth/master.m3u8",
    ),
    /403/,
  );
  results.push({
    name: "clear-login-removes-native-profile-cookie-and-transfer-session-authorization",
    status: "passed",
  });
} finally {
  if (app && originalClipboard !== undefined)
    await app
      .evaluate(
        async ({ clipboard }, text) => await clipboard.writeText(text),
        originalClipboard,
      )
      .catch(() => {});
  await app?.close().catch(() => {});
  await fixture.close();
  await writeFile(
    join(root, "report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        packaged: !!process.env.VIDOWN_VERIFY_EXECUTABLE,
        results,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify(results, null, 2));
