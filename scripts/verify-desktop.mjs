import { _electron } from "playwright";
import { resolve, join } from "node:path";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createFixtures } from "./fixtures.ts";
const packaged = process.env.VIDOWN_VERIFY_EXECUTABLE;
const root = resolve(
  packaged ? "work/packaged-verification" : "work/desktop-verification",
);
await mkdir(root, { recursive: true });
const exe = process.platform === "win32" ? ".exe" : "";
const dir = resolve("resources/tools");
const tools = {
  ffmpeg: join(dir, "ffmpeg" + exe),
  ffprobe: join(dir, "ffprobe" + exe),
  m3u8: join(dir, "N_m3u8DL-RE" + exe),
  ytdlp: join(dir, "yt-dlp" + exe),
  runtime: process.execPath,
};
const fixture = await createFixtures(join(root, "fixtures"), tools);
const results = [];
let application;
const watchdog = setTimeout(() => {
  application?.process().kill();
}, 120000);
async function until(check, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Desktop assertion timed out");
}
try {
  const env = {
    ...process.env,
    VIDOWN_TEST_DATA: join(root, "profile-" + randomUUID()),
    VIDOWN_HEADLESS: packaged ? "" : "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({
    ...(packaged
      ? { executablePath: resolve(packaged), args: [] }
      : { args: ["."] }),
    cwd: resolve("."),
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  const initial = await page.evaluate(() => window.vidown.snapshot());
  assert.equal(initial.tasks.length, 0);
  await until(async () => {
    const snap = await page.evaluate(() => window.vidown.snapshot());
    return snap.tools.tdlib === "1.8.67";
  });
  results.push({
    name: "native-tdlib-worker-loads-and-reports-version",
    status: "passed",
  });
  await page.screenshot({ path: join(root, "01-workbench.png") });
  await page.evaluate(
    (directory) => window.vidown.settings({ downloadDir: directory }),
    join(root, "downloads"),
  );
  await page.getByRole("button", { name: "浏览器探测", exact: true }).click();
  await page.evaluate(
    (url) => window.vidown.browser({ action: "new", url }),
    fixture.origin + "/login",
  );
  await until(async () => {
    const snap = await page.evaluate(() => window.vidown.snapshot());
    return (
      snap.candidates.some((c) => c.protocol === "hls") &&
      snap.candidates.some((c) => c.protocol === "http")
    );
  });
  await page.screenshot({ path: join(root, "02-browser-detection.png") });
  const isolation = await application.evaluate(async ({ webContents }) => {
    const remote = webContents
      .getAllWebContents()
      .find((w) => w.getURL().includes("/player"));
    return remote?.executeJavaScript(
      "({appAPI:typeof window.vidown,node:typeof require})",
    );
  });
  assert.deepEqual(isolation, { appAPI: "undefined", node: "undefined" });
  results.push({
    name: "sandboxed-browser-session-and-real-network-capture",
    status: "passed",
  });
  const resource = page
    .locator(".resource")
    .filter({ has: page.getByText("HLS", { exact: true }) })
    .first();
  await resource.getByRole("button", { name: "解析此资源" }).click();
  await page.getByRole("heading", { name: "选择保存规格" }).waitFor();
  assert(await page.getByLabel("视频轨道").inputValue());
  assert(await page.getByLabel("音频轨道").inputValue());
  await page.screenshot({ path: join(root, "03-track-selection.png") });
  await page.getByRole("button", { name: "加入下载队列" }).click();
  const completed = await until(async () => {
    const snap = await page.evaluate(() => window.vidown.snapshot());
    const failed = snap.tasks.find((t) => t.state === "failed");
    if (failed) throw new Error(failed.error);
    return snap.tasks.find((t) => t.state === "completed");
  });
  assert(completed.output?.endsWith(".mp4"));
  assert(
    completed.bytes >= (await stat(completed.output)).size * 0.95,
    "Downloaded byte count must include both tracks",
  );
  results.push({
    name: "ui-browser-cookie-to-worker-hls-audio-merge-verification",
    status: "passed",
    output: completed.output,
  });
  await page.getByRole("button", { name: "下载记录", exact: true }).click();
  await page.getByText("已完成", { exact: true }).waitFor();
  await page.screenshot({ path: join(root, "04-completed-download.png") });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert(fixture.requests.every((r) => r.authorized));
  const snapshot = await page.evaluate(() => window.vidown.snapshot());
  assert(!JSON.stringify(snapshot.candidates).includes("vidown_fixture"));
  results.push({
    name: "renderer-no-runtime-errors-and-no-exposed-request-secrets",
    status: "passed",
  });
} catch (error) {
  results.push({ name: "desktop", status: "failed", error: String(error) });
  if (application) {
    const windows = application.windows();
    if (windows[0])
      await windows[0]
        .screenshot({ path: join(root, "failure.png") })
        .catch(() => {});
  }
  throw error;
} finally {
  clearTimeout(watchdog);
  if (application) await application.close();
  await fixture.close();
  await writeFile(
    join(root, "report.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), packaged: !!packaged, results },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify(results, null, 2));
