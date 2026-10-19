import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

const root = resolve("site");
const out = resolve("work/site-motion-qa");
await mkdir(out, { recursive: true });
const arg = process.argv.indexOf("--url");
let url = arg < 0 ? undefined : process.argv[arg + 1];
if (arg >= 0 && !url) throw Error("--url requires a URL");
let server;
if (!url) {
  const types = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".webp": "image/webp",
  };
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = resolve(
      root,
      pathname.replace(/^\/vidown\//, "") || "index.html",
    );
    if (
      !pathname.startsWith("/vidown/") ||
      !file.startsWith(root + (process.platform === "win32" ? "\\" : "/"))
    ) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.setHeader(
        "Content-Type",
        types[extname(file)] || "application/octet-stream",
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${server.address().port}/vidown/`;
}
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : undefined,
});
const errors = [];
const checks = [];
async function open(options = {}, preference) {
  const page = await browser.newPage({
    locale: "zh-CN",
    colorScheme: "light",
    reducedMotion: "no-preference",
    ...options,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  if (preference)
    await page.addInitScript(
      (value) => localStorage.setItem("vidown-site-theme", value),
      preference,
    );
  await page.goto(url, { waitUntil: "networkidle" });
  await idle(page);
  return page;
}
async function idle(page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" && a.playState !== "pending"),
  );
}
async function theme(page, expected) {
  await page.waitForFunction(
    (value) => document.documentElement.dataset.theme === value,
    expected,
  );
  await idle(page);
}
try {
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [768, 1024],
    [1440, 900],
  ]) {
    const page = await open({ viewport: { width, height } });
    assert.equal(
      await page.locator("html").getAttribute("data-preference"),
      "system",
    );
    await page.locator("#theme").click();
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .some((a) => a.effect?.pseudoElement === "::view-transition-new(root)"),
    );
    const ripple = await page.evaluate(() => {
      const animation = document
        .getAnimations()
        .find((a) => a.effect?.pseudoElement === "::view-transition-new(root)");
      const bounds = document.querySelector("#theme").getBoundingClientRect();
      return {
        frames: animation.effect.getKeyframes().map((f) => f.clipPath),
        duration: animation.effect.getTiming().duration,
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      };
    });
    assert.equal(ripple.duration, 520);
    assert(ripple.frames[0].includes(`${ripple.x}px ${ripple.y}px`));
    assert(ripple.frames[0].startsWith("circle(0px"));
    await page.screenshot({
      path: resolve(out, `theme-reveal-${width}x${height}.png`),
    });
    await theme(page, "dark");
    await page.waitForFunction(
      () => !document.documentElement.hasAttribute("data-theme-transition"),
    );
    await page.locator("#theme").click();
    await theme(page, "light");
    // Rapid input must preserve click parity and finish without a stuck snapshot.
    await page.evaluate(() => {
      for (let i = 0; i < 7; i++) document.querySelector("#theme").click();
    });
    await theme(page, "dark");
    await page.reload({ waitUntil: "networkidle" });
    await idle(page);
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.locator("#theme").focus();
    await page.keyboard.press("Enter");
    await theme(page, "light");
    // Scrolling starts finite compositor-friendly reveals and leaves no loop.
    await page
      .locator("#history")
      .evaluate((el) =>
        window.scrollTo({ top: el.offsetTop - 80, behavior: "instant" }),
      );
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .some((a) =>
          a.effect
            ?.getKeyframes()
            .some((f) => f.transform?.includes("translateY")),
        ),
    );
    await idle(page);
    const entry = page.locator("#history details").first();
    await entry.locator("summary").click();
    await idle(page);
    assert(await entry.locator(".release-body").isVisible());
    await entry.locator("summary").click();
    await idle(page);
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector("#history details"),
          "::details-content",
        ).contentVisibility === "hidden",
    );
    assert.equal(await entry.locator(".release-body").isVisible(), false);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    checks.push({
      width,
      height,
      ripple,
      oneClick: true,
      rapidClicks: true,
      persisted: true,
      keyboard: true,
      revealAndIdle: true,
      disclosure: true,
    });
    await page.close();
  }
  // Every legacy preference must toggle the visible palette in one click.
  for (const preference of ["system", "light", "dark"]) {
    const page = await open({ reducedMotion: "reduce" }, preference);
    const before = await page.locator("html").getAttribute("data-theme");
    await page.locator("#theme").click();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      before === "dark" ? "light" : "dark",
    );
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await page.close();
  }
  const system = await open({ reducedMotion: "reduce" });
  await system.emulateMedia({ colorScheme: "dark" });
  await theme(system, "dark");
  await system.locator("#theme").click();
  await theme(system, "light");
  await system.emulateMedia({ colorScheme: "light" });
  await system.emulateMedia({ colorScheme: "dark" });
  assert.equal(
    await system.locator("html").getAttribute("data-theme"),
    "light",
  );
  await system.close();
  // Native transition unavailable: still switch once, with a short opacity fade.
  const fallback = await browser.newPage({ reducedMotion: "no-preference" });
  fallback.on("pageerror", (error) => errors.push(error.message));
  await fallback.addInitScript(() => {
    document.startViewTransition = undefined;
  });
  await fallback.goto(url, { waitUntil: "networkidle" });
  await idle(fallback);
  const beforeFallback = await fallback
    .locator("html")
    .getAttribute("data-theme");
  await fallback.locator("#theme").click();
  await theme(fallback, beforeFallback === "dark" ? "light" : "dark");
  await fallback.close();
  const interrupted = await open();
  const beforeInterrupted = await interrupted
    .locator("html")
    .getAttribute("data-theme");
  await interrupted.locator("#theme").click();
  await interrupted.emulateMedia({ reducedMotion: "reduce" });
  await theme(interrupted, beforeInterrupted === "dark" ? "light" : "dark");
  assert.equal(
    await interrupted.evaluate(() => document.getAnimations().length),
    0,
  );
  await interrupted.close();
  const contrast = await open({ forcedColors: "active" });
  const beforeContrast = await contrast
    .locator("html")
    .getAttribute("data-theme");
  await contrast.locator("#theme").click();
  await theme(contrast, beforeContrast === "dark" ? "light" : "dark");
  assert.equal(
    await contrast.evaluate(
      () =>
        document.getAnimations().filter((a) => a.effect?.pseudoElement).length,
    ),
    0,
  );
  await contrast.close();
  const performancePage = await open({ viewport: { width: 390, height: 844 } });
  const cdp = await performancePage.context().newCDPSession(performancePage);
  await cdp.send("Performance.enable");
  const metricsBefore = await cdp.send("Performance.getMetrics");
  await performancePage.waitForTimeout(600);
  const metricsAfter = await cdp.send("Performance.getMetrics");
  const metricDelta = (name) =>
    metricsAfter.metrics.find((m) => m.name === name).value -
    metricsBefore.metrics.find((m) => m.name === name).value;
  const idleMetrics = {
    sampleMs: 600,
    taskMs: metricDelta("TaskDuration") * 1000,
    scriptMs: metricDelta("ScriptDuration") * 1000,
    layoutCount: metricDelta("LayoutCount"),
  };
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const throttledFrames = await performancePage.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        const start = performance.now();
        let previous = start;
        document.querySelector("#theme").click();
        function frame(now) {
          samples.push(now - previous);
          previous = now;
          if (now - start < 900) requestAnimationFrame(frame);
          else {
            samples.sort((a, b) => a - b);
            resolve({
              cpuThrottle: 4,
              sampleMs: now - start,
              frames: samples.length,
              medianFrameMs: samples[Math.floor(samples.length / 2)],
              p95FrameMs: samples[Math.floor(samples.length * 0.95)],
            });
          }
        }
        requestAnimationFrame(frame);
      }),
  );
  await idle(performancePage);
  assert.equal(
    await performancePage.evaluate(() => document.getAnimations().length),
    0,
  );
  await performancePage.close();
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    url,
    browser: await browser.version(),
    checks,
    legacyPreferences: true,
    reducedMotion: true,
    followsSystemUntilExplicitChoice: true,
    fallback: true,
    interrupted: true,
    forcedColors: true,
    errors,
    idleMetrics,
    throttledFrames,
  };
  await writeFile(
    resolve(out, "summary.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    "Website motion passed: four viewports, single-click themes, radial origin, rapid input, keyboard, persistence, reveals, idle, reduced motion and fallback.",
  );
} finally {
  await browser.close();
  if (server) await new Promise((done) => server.close(done));
}
