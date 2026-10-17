import { _electron, type ElectronApplication } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { Store } from "../src/core/store";

const backend =
  process.env.VIDOWN_BROWSER_BACKEND ||
  (process.platform === "win32" ? "webview2" : "chromium");
const root = resolve(`work/data-cleanup-${backend}`);
// CacheStorage appends several hash directories; keep Windows fixture paths short.
const profile = join(tmpdir(), "vidown-cleanup-" + randomUUID());
await mkdir(profile, { recursive: true });
const file = join(profile, "keep.mp4");
await writeFile(file, "controlled-file-must-survive-record-cleanup");
const db = new Store(join(profile, "vidown.sqlite"));
for (const state of ["completed", "paused"] as const)
  db.put(
    {
      id: state,
      state,
      title: "Controlled " + state,
      output: state === "completed" ? file : undefined,
      updatedAt: Date.now(),
      resumable: false,
    },
    "controlled-sealed-plan",
  );
db.close();
let cacheRequests = 0;
const server = createServer((req, res) => {
  if (req.url === "/cached") {
    cacheRequests++;
    res
      .writeHead(200, {
        "cache-control": "max-age=86400",
        "content-type": "text/plain",
      })
      .end("controlled-cache");
    return;
  }
  res
    .writeHead(200, {
      "content-type": "text/html",
      ...(req.url === "/login"
        ? {
            "set-cookie": [
              "cleanup_session=controlled; HttpOnly; Path=/; SameSite=Lax",
              "cleanup_persistent=controlled; Max-Age=86400; Path=/; SameSite=Lax",
            ],
          }
        : {}),
    })
    .end(
      "<!doctype html><title>Controlled cleanup fixture</title><h1>Controlled fixture</h1>",
    );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
const env: NodeJS.ProcessEnv = {
  ...process.env,
  VIDOWN_TEST_DATA: profile,
  VIDOWN_BROWSER_BACKEND: backend,
  VIDOWN_HEADLESS: "",
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
const results: { name: string; status: string }[] = [];
async function until(check: () => Promise<boolean>, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Data cleanup assertion timed out");
}
const seed = `async()=>{
  localStorage.setItem('cleanup','retained'); sessionStorage.setItem('cleanup','retained');
  await new Promise((resolve,reject)=>{const r=indexedDB.open('cleanup',1); r.onupgradeneeded=()=>r.result.createObjectStore('data'); r.onerror=()=>reject(r.error); r.onsuccess=()=>{r.result.close();resolve(true)};});
  const cache=await caches.open('cleanup'); await cache.put('/cache-storage',new Response('retained'));
  await fetch('/cached',{cache:'force-cache'}); return true;
}`;
const inspect = `async()=>({local:localStorage.getItem('cleanup'),session:sessionStorage.getItem('cleanup'),dbs:(await indexedDB.databases()).map(d=>d.name),caches:await caches.keys()})`;
async function remote(id: string, code: string): Promise<any> {
  const result = await app!.evaluate(
    async (_, { id, code }) => {
      const browser = (globalThis as any).__vidownBrowser;
      const script = `(async()=>{try{return {ok:true,value:await (${code})()}}catch(e){return {ok:false,error:String(e)}}})()`;
      if (typeof browser.execute === "function")
        return browser.execute(id, script);
      const view = browser.views.get(id);
      if (!view) throw new Error("Controlled tab missing");
      return view.webContents.executeJavaScript(script);
    },
    { id, code },
  );
  if (!result?.ok)
    throw new Error(result?.error || "Controlled page execution failed");
  return result.value;
}
try {
  app = await launch();
  let page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  await page.evaluate(() =>
    window.vidown.settings({ clipboard: false, theme: "ocean" }),
  );
  const originalSettings = (await page.evaluate(() => window.vidown.snapshot()))
    .settings;
  for (const origin of origins) {
    await page.evaluate(
      (url) => window.vidown.browser({ action: "new", url }),
      origin + "/login",
    );
    const id = (await page.evaluate(() => window.vidown.snapshot())).activeTab!;
    await until(async () =>
      (await page.evaluate(() => window.vidown.snapshot())).tabs.some(
        (t) => t.id === id && !t.loading,
      ),
    );
    assert.equal(await remote(id, seed), true);
    await remote(
      id,
      "async()=>fetch('/cached',{cache:'force-cache'}).then(r=>r.text())",
    );
  }
  assert.equal(cacheRequests, 2);
  await assert.rejects(
    page.evaluate(() =>
      window.vidown.clearData({ browser: false, history: false }),
    ),
    /请选择/,
  );
  await assert.rejects(
    page.evaluate(() =>
      window.vidown.clearData({ browser: true, history: true }),
    ),
    /请先完成或取消/,
  );
  assert.equal(
    (await page.evaluate(() => window.vidown.snapshot())).tasks.length,
    2,
  );
  results.push({
    name: "reject-empty-selection-and-browser-cleanup-with-paused-tasks-without-mutating-data",
    status: "passed",
  });
  await page.getByRole("button", { name: "设置与账号", exact: true }).click();
  await page.getByRole("button", { name: "清除所选数据", exact: true }).click();
  await page
    .getByRole("dialog", { name: "清除所选本地数据？" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.vidown.snapshot())).tabs.length,
    2,
  );
  await page.evaluate(() =>
    window.vidown.clearData({ browser: false, history: true }),
  );
  assert.deepEqual(
    (await page.evaluate(() => window.vidown.snapshot())).tasks.map(
      (t) => t.id,
    ),
    ["paused"],
  );
  let id = (await page.evaluate(() => window.vidown.snapshot())).activeTab!;
  assert.equal((await remote(id, inspect)).local, "retained");
  assert.equal(
    await readFile(file, "utf8"),
    "controlled-file-must-survive-record-cleanup",
  );
  results.push({
    name: "confirmation-cancel-and-history-only-cleanup-preserve-browser-paused-task-and-files",
    status: "passed",
  });
  await page.evaluate(() =>
    window.vidown.task({ id: "paused", action: "cancel" }),
  );
  // Repeated synchronization exercises the in-flight native-cookie snapshot drain.
  await app.evaluate(async () => {
    await (globalThis as any).__vidownBrowser.synchronize();
  });
  await app.evaluate(async (_, url) => {
    const browser = (globalThis as any).__vidownBrowser;
    const original = browser.clearSessionData.bind(browser);
    browser.clearSessionData = async () => {
      let blocked = false;
      try {
        await browser.create(url);
      } catch {
        blocked = true;
      }
      if (!blocked) throw new Error("Navigation was permitted during cleanup");
      await original();
    };
  }, origins[0] + "/login");
  await page.getByRole("checkbox", { name: "下载记录", exact: true }).uncheck();
  await page.getByRole("button", { name: "清除所选数据", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认清除", exact: true })
    .click();
  await until(async () => !(await page.getByRole("dialog").isVisible()));
  let snapshot = await page.evaluate(() => window.vidown.snapshot());
  await app.evaluate(
    async (_, input) => {
      const browser = (globalThis as any).__vidownBrowser;
      browser.capture(
        input.id,
        input.origin + "/late.m3u8",
        "application/vnd.apple.mpegurl",
        {},
      );
      if (typeof browser.receive === "function") {
        browser.receive({
          type: "manifest",
          tabId: input.id,
          url: input.origin + "/late.m3u8",
          text: "#EXTM3U",
        });
        browser.receive({
          type: "popup",
          tabId: input.id,
          url: input.origin + "/login",
        });
      }
      if (browser.manifestBodies.size !== 0)
        throw new Error("Stale manifest survived cleanup");
    },
    { id, origin: origins[0] },
  );
  snapshot = await page.evaluate(() => window.vidown.snapshot());
  assert.equal(snapshot.tabs.length, 0);
  assert.equal(snapshot.candidates.length, 0);
  assert.equal(snapshot.tasks.length, 1);
  assert.deepEqual(snapshot.settings, originalSettings);
  assert.equal(
    await app.evaluate(
      async () =>
        (await (globalThis as any).__vidownBrowser.session.cookies.get({}))
          .length,
    ),
    0,
  );
  assert.equal(
    await app.evaluate(async () =>
      (globalThis as any).__vidownBrowser.session.getCacheSize(),
    ),
    0,
  );
  await page.screenshot({
    path: join(root, "settings.png"),
    animations: "disabled",
  });
  results.push({
    name: "settings-ui-browser-only-cleanup-closes-tabs-clears-cookies-cache-and-candidates-preserves-records-and-preferences",
    status: "passed",
  });
  await app.close();
  const inspected = new Store(join(profile, "vidown.sqlite"));
  assert.equal(inspected.sealed("paused"), undefined);
  assert.equal(inspected.settings().browserSession, undefined);
  assert.deepEqual(inspected.settings().browserZoom, {});
  inspected.close();
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  for (const origin of origins) {
    await page.evaluate(
      (url) => window.vidown.browser({ action: "new", url }),
      origin + "/check",
    );
    id = (await page.evaluate(() => window.vidown.snapshot())).activeTab!;
    await until(async () =>
      (await page.evaluate(() => window.vidown.snapshot())).tabs.some(
        (t) => t.id === id && !t.loading,
      ),
    );
    assert.deepEqual(await remote(id, inspect), {
      local: null,
      session: null,
      dbs: [],
      caches: [],
    });
    await remote(
      id,
      "async()=>fetch('/cached',{cache:'force-cache'}).then(r=>r.text())",
    );
  }
  assert.equal(cacheRequests, 4);
  await app.evaluate(async () => {
    await (globalThis as any).__vidownBrowser.synchronize();
  });
  assert.equal(
    await app.evaluate(
      async () =>
        (await (globalThis as any).__vidownBrowser.session.cookies.get({}))
          .length,
    ),
    0,
  );
  results.push({
    name: "restart-does-not-restore-cookies-or-sealed-plans-both-site-storage-indexeddb-cache-storage-and-http-cache-are-empty",
    status: "passed",
  });
  await page.evaluate(
    (url) => window.vidown.browser({ action: "new", url }),
    origins[0] + "/login",
  );
  id = (await page.evaluate(() => window.vidown.snapshot())).activeTab!;
  await until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).tabs.some(
      (t) => t.id === id && !t.loading,
    ),
  );
  await remote(id, seed);
  assert.deepEqual(
    await page.evaluate(() =>
      window.vidown.clearData({ browser: true, history: true }),
    ),
    { removed: 1 },
  );
  snapshot = await page.evaluate(() => window.vidown.snapshot());
  assert.equal(snapshot.tasks.length, 0);
  assert.equal(snapshot.tabs.length, 0);
  assert.equal(
    await readFile(file, "utf8"),
    "controlled-file-must-survive-record-cleanup",
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.vidown.clearData({ browser: true, history: true }),
    ),
    { removed: 0 },
  );
  results.push({
    name: "combined-cleanup-and-repeated-cleanup-preserve-downloaded-file",
    status: "passed",
  });
  assert.deepEqual(pageErrors, []);
} catch (error) {
  results.push({ name: "data-cleanup", status: "failed" });
  throw error;
} finally {
  await app?.close().catch(() => {});
  await new Promise<void>((r) => server.close(() => r()));
  await writeFile(
    join(root, "report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        backend,
        packaged: !!process.env.VIDOWN_VERIFY_EXECUTABLE,
        results,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify(results, null, 2));
