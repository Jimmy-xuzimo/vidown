import { _electron, type ElectronApplication } from "playwright";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { Store } from "../src/core/store";

const root = resolve("work/interface-verification");
const profile = join(root, "profile-" + randomUUID());
await mkdir(profile, { recursive: true });
const keep = join(root, "keep-" + randomUUID() + ".mp4");
const trash = join(root, "trash-" + randomUUID() + ".mp4");
const directory = join(root, "must-not-trash-" + randomUUID());
await Promise.all([
  writeFile(keep, "controlled-existing-file"),
  writeFile(trash, "controlled-existing-file"),
  mkdir(directory),
]);
const database = new Store(join(profile, "vidown.sqlite"));
for (const [id, output, state] of [
  ["keep", keep, "completed"],
  ["trash", trash, "completed"],
  ["directory", directory, "completed"],
  ["cancelled", undefined, "cancelled"],
  ["paused", undefined, "paused"],
] as const)
  database.put(
    {
      id,
      title: "Controlled " + id,
      output,
      state,
      updatedAt: Date.now(),
      resumable: false,
    },
    "controlled-private-plan",
  );
database.close();
const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    `<title>${request.url?.includes("long") ? "这是一个非常非常长的视频标题，标签必须恒定高度，始终展示开头并在末尾省略，不能换行也不能挤掉关闭按钮" : "Short title"}</title><h1>Controlled browser page</h1>`,
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  VIDOWN_TEST_DATA: profile,
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
    env: env as Record<string, string>,
    cwd: resolve("."),
  });
let app: ElectronApplication | undefined;
const results: { name: string; status: string; [key: string]: unknown }[] = [];
const exists = async (file: string) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};
async function until(check: () => Promise<boolean>, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error("Interface assertion timed out");
}
try {
  app = await launch();
  let page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  assert.equal(
    await page.getByText("M0 · 关键链路验证版", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByText("让每一步下载都有依据。", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.locator(".sidebar-bottom small").innerText(),
    "v" + (await page.evaluate(() => window.vidown.snapshot())).version,
  );
  assert.equal(
    await app.evaluate(({ app }) =>
      app.getAppMetrics().some((p) => p.name === "Vidown Media Worker"),
    ),
    false,
  );
  results.push({
    name: "clean-branding-real-package-version-and-no-idle-media-worker",
    status: "passed",
  });
  await page.getByRole("button", { name: "设置与账号", exact: true }).click();
  await page.getByLabel("颜色模式", { exact: true }).selectOption("dark");
  await page
    .getByRole("button", { name: "青玉 自然绿调", exact: true })
    .click();
  await until(
    async () =>
      (await page.locator("html").getAttribute("data-theme")) === "jade",
  );
  await page.screenshot({
    path: join(root, "01-dark-jade-settings.png"),
    animations: "disabled",
  });
  await page.getByLabel("颜色模式", { exact: true }).selectOption("light");
  await page
    .getByRole("button", { name: "海蓝 清澈蓝调", exact: true })
    .click();
  await until(
    async () =>
      (await page.locator("html").getAttribute("data-theme")) === "ocean" &&
      (await page.locator("html").getAttribute("data-mode")) === "light",
  );
  await page.screenshot({
    path: join(root, "02-light-ocean-settings.png"),
    animations: "disabled",
  });
  await page.getByLabel("界面密度", { exact: true }).selectOption("compact");
  await page.getByRole("switch", { name: "界面动效", exact: true }).uncheck();
  await page.getByRole("switch", { name: "鼠标微光", exact: true }).uncheck();
  await until(
    async () =>
      !(await page.evaluate(() => window.vidown.snapshot())).settings.hoverGlow,
  );
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  const persisted = (await page.evaluate(() => window.vidown.snapshot()))
    .settings;
  assert.deepEqual(
    [
      persisted.colorMode,
      persisted.theme,
      persisted.density,
      persisted.animations,
      persisted.hoverGlow,
    ],
    ["light", "ocean", "compact", false, false],
  );
  results.push({
    name: "mode-palette-density-and-effects-persist-after-restart",
    status: "passed",
  });

  await page.getByRole("button", { name: "浏览器探测", exact: true }).click();
  await page.getByRole("button", { name: "新标签页", exact: true }).click();
  await page
    .getByLabel("浏览器地址", { exact: true })
    .fill(`127.0.0.1:${port}/long`);
  await page.getByRole("button", { name: "访问", exact: true }).click();
  await until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).tabs.some((t) =>
      t.title.startsWith("这是一个"),
    ),
  );
  const firstHeight = (await page
    .locator(".browser-tab.selected")
    .boundingBox())!.height;
  await page.getByRole("button", { name: "新标签页", exact: true }).click();
  await page
    .getByLabel("浏览器地址", { exact: true })
    .fill(`127.0.0.1:${port}/short`);
  await page.getByRole("button", { name: "访问", exact: true }).click();
  await until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).tabs.some(
      (t) => t.title === "Short title",
    ),
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1000, 740),
  );
  const layout = await page.locator(".browser-tabs").evaluate((node) => {
    const tabs = [...node.querySelectorAll<HTMLElement>(".browser-tab")];
    const last = tabs.at(-1)!.getBoundingClientRect();
    const plus = node.querySelector(".new-tab")!.getBoundingClientRect();
    return {
      heights: tabs.map((t) => t.getBoundingClientRect().height),
      nowrap: getComputedStyle(tabs[0].querySelector(".tab-title")!).whiteSpace,
      ellipsis: getComputedStyle(tabs[0].querySelector(".tab-title")!)
        .textOverflow,
      clipped:
        tabs[0].querySelector(".tab-title")!.scrollWidth >
        tabs[0].querySelector(".tab-title")!.clientWidth,
      plusAfter: plus.x >= last.right,
    };
  });
  assert(layout.heights.every((h) => h === firstHeight && h === 38));
  assert.equal(layout.nowrap, "nowrap");
  assert.equal(layout.ellipsis, "ellipsis");
  assert(layout.clipped && layout.plusAfter);
  assert(
    (await page.evaluate(() => window.vidown.snapshot())).tabs.every((t) =>
      t.url.startsWith(`http://127.0.0.1:${port}/`),
    ),
  );
  await page.screenshot({ path: join(root, "03-fixed-browser-tabs.png") });
  results.push({
    name: "bare-address-completion-fixed-38px-tabs-single-line-leading-title-ellipsis-and-adjacent-plus",
    status: "passed",
  });

  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1400, 940),
  );
  await page.getByRole("button", { name: "下载记录", exact: true }).click();
  await page
    .getByRole("button", { name: "删除记录：Controlled keep", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("同时删除下载文件（移至回收站）", { exact: true })
      .isChecked(),
    false,
  );
  await page.getByRole("button", { name: "取消", exact: true }).last().click();
  assert(
    (await page.evaluate(() => window.vidown.snapshot())).tasks.some(
      (t) => t.id === "keep",
    ),
  );
  await page
    .getByRole("button", { name: "删除记录：Controlled keep", exact: true })
    .click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await until(
    async () =>
      !(await page.evaluate(() => window.vidown.snapshot())).tasks.some(
        (t) => t.id === "keep",
      ),
  );
  assert(await exists(keep));
  results.push({
    name: "single-delete-confirmation-default-retains-file-and-cancel-keeps-record",
    status: "passed",
  });
  await page
    .getByRole("button", { name: "删除记录：Controlled trash", exact: true })
    .click();
  await page
    .getByLabel("同时删除下载文件（移至回收站）", { exact: true })
    .check();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await until(
    async () =>
      !(await page.evaluate(() => window.vidown.snapshot())).tasks.some(
        (t) => t.id === "trash",
      ),
  );
  assert.equal(await exists(trash), false);
  results.push({
    name: "explicit-file-deletion-moves-real-controlled-file-to-windows-recycle-bin",
    status: "passed",
  });
  const blocked = await page.evaluate(() =>
    window.vidown.history({ ids: ["paused", "directory"], deleteFiles: true }),
  );
  assert.equal(blocked.removed, 0);
  assert.equal(blocked.failed.length, 2);
  assert(await exists(directory));
  await page.getByRole("button", { name: "一键清除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await until(
    async () =>
      (await page.evaluate(() => window.vidown.snapshot())).tasks.length === 1,
  );
  assert.equal(
    (await page.evaluate(() => window.vidown.snapshot())).tasks[0].id,
    "paused",
  );
  results.push({
    name: "clear-history-preserves-paused-work-and-refuses-to-trash-directories",
    status: "passed",
  });

  await page.getByRole("button", { name: "设置与账号", exact: true }).click();
  await page.getByRole("switch", { name: "鼠标微光", exact: true }).check();
  await until(
    async () =>
      (await page.evaluate(() => window.vidown.snapshot())).settings.hoverGlow,
  );
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window);
    (window as any).testFrames = 0;
    window.requestAnimationFrame = (cb) => {
      (window as any).testFrames++;
      return original(cb);
    };
  });
  await page.mouse.move(30, 30);
  await page.waitForTimeout(200);
  const target = await page
    .getByRole("button", { name: "玫瑰 温暖粉调", exact: true })
    .boundingBox();
  await page.mouse.move(target!.x + 15, target!.y + 15);
  await page.waitForTimeout(100);
  assert((await page.locator(".pointer-lit").count()) > 0);
  const frames = await page.evaluate(() => (window as any).testFrames);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => (window as any).testFrames), frames);
  await page.getByRole("switch", { name: "鼠标微光", exact: true }).uncheck();
  await until(async () => (await page.locator(".pointer-lit").count()) === 0);
  const noGlowFrames = await page.evaluate(() => (window as any).testFrames);
  await page.mouse.move(target!.x + 20, target!.y + 20);
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => (window as any).testFrames),
    noGlowFrames,
  );
  results.push({
    name: "hover-light-is-event-driven-no-idle-animation-frames-and-toggle-removes-listeners",
    status: "passed",
  });
} finally {
  await app?.close().catch(() => {});
  await new Promise<void>((r) => server.close(() => r()));
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
