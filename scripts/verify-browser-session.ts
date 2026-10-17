import { _electron } from "playwright";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createFixtures } from "./fixtures";
import { Store } from "../src/core/store";

const root = resolve("work/browser-session-verification");
const profile = join(root, "profile-" + randomUUID());
await mkdir(root, { recursive: true });
const toolsDir = resolve("resources/tools");
const fixture = await createFixtures(join(root, "fixtures"), {
  ffmpeg: join(toolsDir, "ffmpeg.exe"),
  ffprobe: join(toolsDir, "ffprobe.exe"),
  m3u8: join(toolsDir, "N_m3u8DL-RE.exe"),
  ytdlp: join(toolsDir, "yt-dlp.exe"),
  runtime: process.execPath,
});
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env))
  if (value !== undefined) env[key] = value;
env.VIDOWN_TEST_DATA = profile;
// This suite inspects WebContentsView; use verify:webview2 for the Windows native host.
env.VIDOWN_BROWSER_BACKEND = "chromium";
env.VIDOWN_HEADLESS = process.env.VIDOWN_VERIFY_EXECUTABLE ? "" : "1";
delete env.ELECTRON_RUN_AS_NODE;
const options = {
  ...(process.env.VIDOWN_VERIFY_EXECUTABLE
    ? {
        executablePath: resolve(process.env.VIDOWN_VERIFY_EXECUTABLE),
        args: [],
      }
    : { args: ["."] }),
  env,
  cwd: resolve("."),
};
let app = await _electron.launch(options);
let page = await app.firstWindow();
const results: { name: string; status: string }[] = [];
async function until<T>(
  check: () => Promise<T | undefined | false>,
  timeout = 45000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Browser/session assertion timed out");
}
async function browserReady() {
  return until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).tabs.find(
      (t) => t.url.includes("/player") && !t.loading,
    ),
  );
}
try {
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  await page.getByRole("button", { name: "浏览器探测", exact: true }).click();
  await page.evaluate(
    (url) => window.vidown.browser({ action: "new", url }),
    fixture.origin + "/login",
  );
  await browserReady();
  for (const [width, height, zoom] of [
    [1000, 640, 1],
    [1400, 900, 1],
    [1920, 1000, 1],
    [1280, 800, 1.25],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, height, zoom }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setContentSize(width, height);
        win.webContents.setZoomFactor(zoom);
      },
      { width, height, zoom },
    );
    await until(async () => {
      const rect = await page.locator(".browser-surface").evaluate((node) => {
        const r = node.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          outerScroll: document.documentElement.scrollHeight - innerHeight,
          outerWidth: document.documentElement.scrollWidth - innerWidth,
        };
      });
      const native = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const view = win.contentView.children.find((v: any) =>
          v.webContents?.getURL().includes("/player"),
        );
        return view?.getBounds();
      });
      return (
        native &&
        rect.height > 100 &&
        rect.outerScroll <= 1 &&
        rect.outerWidth <= 1 &&
        Math.abs(native.x - rect.x * zoom) <= 1 &&
        Math.abs(native.y - rect.y * zoom) <= 1 &&
        Math.abs(native.width - rect.width * zoom) <= 1 &&
        Math.abs(native.height - rect.height * zoom) <= 1
      );
    });
  }
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setZoomFactor(1);
    win.setContentSize(1280, 800);
  });
  await page.getByLabel("网页缩放", { exact: true }).selectOption("0.75");
  await until(async () => (await browserReady()).zoomFactor === 0.75);
  const before = await page.locator(".browser-surface").boundingBox();
  await page.getByRole("button", { name: "收起资源栏" }).click();
  await until(
    async () =>
      (await page.locator(".browser-surface").boundingBox())!.width >
      before!.width + 100,
  );
  await page.getByRole("button", { name: "显示资源栏" }).click();
  await page.screenshot({ path: join(root, "browser-fit.png") });
  results.push({
    name: "responsive-native-view-fits-window-and-ui-zoom-with-webpage-zoom-controls",
    status: "passed",
  });
  const remote = app.windows().find((p) => p.url().includes("/player"))!;
  await remote.evaluate(async () => {
    localStorage.setItem("session-fixture", "retained");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("session-fixture", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("values");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("values", "readwrite");
        tx.objectStore("values").put("retained", "key");
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
    });
  });
  const nativeStorage = await app.evaluate(
    ({ session }) =>
      session.fromPartition("persist:vidown-browser").storagePath,
  );
  assert(nativeStorage);
  await app.close();
  const database = new Store(join(profile, "vidown.sqlite"));
  const saved = database.settings().browserSession;
  assert.equal(typeof saved, "string");
  assert(!saved.includes("vidown_fixture") && !saved.includes("allowed"));
  database.close();
  // Remove only this isolated fixture's Chromium cookie database, proving the encrypted session-cookie backup restores login.
  assert(!relative(profile, nativeStorage!).startsWith(".."));
  for (const part of ["Cookies", "Network/Cookies"])
    for (const suffix of ["", "-journal", "-wal", "-shm"])
      await rm(join(nativeStorage!, part + suffix), { force: true });
  app = await _electron.launch(options);
  page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.vidown.snapshot())).tabs.length,
    0,
  );
  await page.evaluate(
    (downloadDir) => window.vidown.settings({ downloadDir }),
    join(root, "downloads"),
  );
  await page
    .getByLabel("视频链接", { exact: true })
    .fill(fixture.origin + "/auth/master.m3u8");
  await page.getByRole("button", { name: "探测资源", exact: true }).click();
  await page.getByRole("heading", { name: "选择保存规格" }).waitFor();
  await page.getByRole("button", { name: "加入下载队列", exact: true }).click();
  await until(async () => {
    const task = (await page.evaluate(() => window.vidown.snapshot())).tasks[0];
    if (task?.state === "failed") throw new Error(task.error);
    return task?.state === "completed";
  });
  assert(fixture.requests.every((r) => r.authorized));
  results.push({
    name: "encrypted-session-cookie-survives-restart-and-workbench-downloads-without-reopening-login-page",
    status: "passed",
  });
  await page.getByRole("button", { name: "浏览器探测", exact: true }).click();
  await page.evaluate(
    (url) => window.vidown.browser({ action: "new", url }),
    fixture.origin + "/player",
  );
  assert.equal((await browserReady()).zoomFactor, 0.75);
  const restoredRemote = app
    .windows()
    .find((p) => p.url().includes("/player"))!;
  assert.deepEqual(
    await restoredRemote.evaluate(async () => {
      const idb = await new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open("session-fixture", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = request.result
            .transaction("values")
            .objectStore("values")
            .get("key");
          result.onsuccess = () => {
            request.result.close();
            resolve(result.result);
          };
        };
      });
      return [localStorage.getItem("session-fixture"), idb];
    }),
    ["retained", "retained"],
  );
  results.push({
    name: "site-zoom-local-storage-and-indexeddb-survive-restart",
    status: "passed",
  });
  await page.evaluate(() => window.vidown.browser({ action: "logout" }));
  await app.close();
  app = await _electron.launch(options);
  page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  await assert.rejects(
    page.evaluate(
      (url) => window.vidown.probe({ url }),
      fixture.origin + "/auth/master.m3u8",
    ),
    /403/,
  );
  results.push({
    name: "explicit-clear-login-removes-native-cookies-and-encrypted-restart-backup",
    status: "passed",
  });
} finally {
  await app.close().catch(() => {});
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
