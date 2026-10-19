import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, webkit } from "playwright";

// Local QA uses the same /vidown/ base path as Pages. Pass --url for deployed QA.
const root = resolve("site");
const out = resolve("work/site-history-qa");
await mkdir(out, { recursive: true });
let server;
const arg = process.argv.indexOf("--url");
let url = arg >= 0 ? process.argv[arg + 1] : undefined;
if (arg >= 0 && !url) throw Error("--url requires the website URL");
if (!url) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const relative = path.replace(/^\/vidown\//, "") || "index.html";
    const file = resolve(root, relative);
    if (
      !path.startsWith("/vidown/") ||
      (!file.startsWith(root + "/") && !file.startsWith(root + "\\"))
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/vidown/`;
}
let browser;
try {
  const useWebKit = process.argv.includes("--webkit");
  browser = await (useWebKit ? webkit : chromium).launch({
    channel: !useWebKit && process.platform === "win32" ? "msedge" : undefined,
  });
  const page = await browser.newPage({
    reducedMotion: "reduce",
    locale: "zh-CN",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  assert.equal(
    (await page.goto(url, { waitUntil: "networkidle" })).status(),
    200,
  );
  const cases = [];
  // SVG paths must render identically across Apple/Windows emoji font choices.
  assert.equal(await page.locator("svg.icon-arrow-outward").count(), 29);
  assert.equal(await page.locator("svg.icon-arrow-right").count(), 1);
  assert.equal(
    await page
      .locator("body")
      .innerText()
      .then((text) => /[↗→]/u.test(text)),
    false,
  );
  assert.equal(
    await page
      .locator("svg.icon-arrow")
      .evaluateAll((icons) =>
        icons.every(
          (icon) =>
            icon.getAttribute("aria-hidden") === "true" &&
            icon.getAttribute("focusable") === "false" &&
            icon.querySelector("path") &&
            icon.getAttribute("stroke") === "currentColor",
        ),
      ),
    true,
  );
  const viewports = [
    [320, 568],
    [360, 640],
    [390, 844],
    [430, 932],
    [568, 320],
    [667, 375],
    [844, 390],
    [932, 430],
    [768, 1024],
    [1024, 768],
    [800, 1280],
    [1280, 800],
    [1024, 1366],
    [1366, 1024],
    [1280, 720],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ];
  const order = [
    "0.1.0-preview.6",
    "1.0.6",
    "0.1.0-preview.5",
    "0.1.0-preview.4",
    "1.0.5",
    "1.0.4",
    "1.0.3",
    "1.0.2",
  ];
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"]) {
      if ((await page.getAttribute("html", "data-theme")) !== theme)
        await page.locator("#theme").click();
      assert.equal(await page.getAttribute("html", "data-theme"), theme);
      for (const language of ["zh-CN", "en"]) {
        if ((await page.getAttribute("html", "lang")) !== language)
          await page.locator("#language").click();
        await page.evaluate(() =>
          window.scrollTo({ top: 0, behavior: "instant" }),
        );
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const label = `${width}x${height}/${theme}/${language}`;
        const overflow = async () =>
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            `Overflow: ${label}`,
          );
        await overflow();
        const hero = await page.locator(".hero").evaluate((el) => {
          const image = el.querySelector(".hero-preview img");
          const img = image.getBoundingClientRect();
          const title = el.querySelector("h1").getBoundingClientRect();
          const action = el
            .querySelector(".hero-actions")
            .getBoundingClientRect();
          return {
            imageLoaded: image.complete && image.naturalWidth > 0,
            imageVisible: Math.max(
              0,
              Math.min(innerHeight, img.bottom) - Math.max(0, img.top),
            ),
            titleBottom: title.bottom,
            actionBottom: action.bottom,
            imageRatio: img.width / img.height,
            viewportHeight: innerHeight,
          };
        });
        assert(hero.imageLoaded, `Missing screenshot: ${label}`);
        assert(
          hero.imageVisible >= 64,
          `Screenshot absent from first viewport: ${label} ${JSON.stringify(hero)}`,
        );
        assert(
          hero.titleBottom <= height,
          `Slogan outside first viewport: ${label}`,
        );
        assert(
          hero.actionBottom <= height,
          `Actions outside first viewport: ${label}`,
        );
        assert(
          Math.abs(hero.imageRatio - 1384 / 901) < 0.02,
          `Distorted screenshot: ${label}`,
        );
        assert.equal(
          await page
            .locator("[data-i18n]")
            .evaluateAll((els) =>
              els.some(
                (el) =>
                  !el.textContent.trim() ||
                  el.textContent.includes("undefined"),
              ),
            ),
          false,
        );
        const history = page.locator("#history");
        assert.equal(await history.locator("details.release-entry").count(), 8);
        assert.equal(
          await history.locator("details[open]").count(),
          0,
          `History must start collapsed: ${label}`,
        );
        assert.deepEqual(
          await history.locator(".release-version").allTextContents(),
          order,
        );
        assert.equal(
          await history.locator('[data-platform="desktop"]').count(),
          5,
        );
        assert.equal(
          await history.locator('[data-platform="android"]').count(),
          3,
        );
        for (const entry of await history.locator("details").all()) {
          assert.equal(await entry.locator(".release-body").isVisible(), false);
          await entry.locator("summary").click();
          assert.equal(await entry.getAttribute("open"), "");
          assert.equal(await entry.locator(".release-body").isVisible(), true);
          await overflow();
          await entry.locator("summary").click();
        }
        const timeline = await history
          .locator(".history-timeline")
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            return {
              axis: parseFloat(getComputedStyle(el, "::before").left),
              width: r.width,
              cards: [...el.querySelectorAll(".release-entry")].map((card) => {
                const c = card.getBoundingClientRect();
                return { left: c.left - r.left, right: c.right - r.left };
              }),
            };
          });
        if (width > 640) {
          assert(Math.abs(timeline.axis - timeline.width / 2) < 1);
          timeline.cards.forEach((card, i) =>
            assert(
              i % 2 ? card.left > timeline.axis : card.right < timeline.axis,
              `Card crossed timeline: ${label}/${i}`,
            ),
          );
        } else {
          assert.equal(timeline.axis, 4);
          assert(timeline.cards.every((card) => card.left > timeline.axis));
        }
        if (width < 801) {
          await page.locator("#menu").click();
          await page.locator('#mobile-nav a[href="#history"]').click();
          assert.equal(
            await page.locator("#menu").getAttribute("aria-expanded"),
            "false",
          );
        }
        if (
          [320, 390, 568, 844, 768, 1024, 1280, 1440].includes(width) &&
          language === "zh-CN"
        ) {
          await page.evaluate(() =>
            window.scrollTo({ top: 0, behavior: "instant" }),
          );
          await page.mouse.move(0, 0);
          await page.screenshot({
            path: resolve(out, `hero-${width}x${height}-${theme}.png`),
          });
          await history.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(
              out,
              `history-viewport-${width}x${height}-${theme}.png`,
            ),
          });
          await history.screenshot({
            path: resolve(out, `timeline-${width}x${height}-${theme}.png`),
          });
        }
        cases.push({ width, height, theme, language, hero });
      }
    }
  }
  const skip = page.locator(".skip");
  await skip.focus();
  assert.equal(
    await skip.evaluate((el) => getComputedStyle(el).clipPath),
    "none",
  );
  assert((await skip.boundingBox()).y >= 0);
  await skip.press("Enter");
  assert.equal(await page.evaluate(() => location.hash), "#main");
  const summary = page.locator("#history details summary").first();
  await summary.focus();
  await summary.press("Enter");
  assert.equal(await page.locator("#history details[open]").count(), 1);
  await summary.press("Space");
  assert.equal(await page.locator("#history details[open]").count(), 0);
  const lastTab = page.locator('[role="tab"]').last();
  await lastTab.focus();
  await lastTab.press("Home");
  assert.equal(
    await page.locator('[role="tab"]').first().getAttribute("aria-selected"),
    "true",
  );
  await page.locator('[role="tab"]').first().press("ArrowRight");
  assert.equal(await page.locator("#panel-browser").isVisible(), true);
  const releaseLinks = await page
    .locator("#history .release-link")
    .evaluateAll((els) => els.map((el) => el.href));
  const apk = await page
    .locator(".android-actions a")
    .first()
    .getAttribute("href");
  assert.equal(
    apk,
    "https://github.com/Jimmy-xuzimo/vidown/releases/download/android-v0.1.0-preview.6/Vidown-Android-0.1.0-preview.6.apk",
  );
  const noJS = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 900 },
  });
  await noJS.goto(url);
  assert.equal(await noJS.locator("#history .release-entry").count(), 8);
  await noJS.locator("#history details summary").first().click();
  await noJS
    .locator("#history details[open] .release-body")
    .waitFor({ state: "visible" });
  assert.equal(
    await noJS.locator("#history details[open] .release-body").isVisible(),
    true,
  );
  assert.deepEqual(errors, []);
  const remoteStatus = [];
  if (arg >= 0) {
    for (const target of [...releaseLinks, apk]) {
      const response = await page.request.head(target);
      assert.equal(
        response.status(),
        200,
        `Unavailable public link: ${target}`,
      );
      remoteStatus.push({ url: target, status: response.status() });
    }
  }
  const result = {
    passed: true,
    browser: useWebKit ? "webkit" : "chromium",
    vectorArrows: true,
    url,
    cases,
    noJavaScript: true,
    keyboard: true,
    firstViewport: true,
    timelineInitiallyCollapsed: true,
    releaseLinks,
    apk,
    remoteStatus,
  };
  await writeFile(
    resolve(out, "summary.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    `Website passed ${cases.length} viewport/theme/language combinations, first-screen visibility, timeline, keyboard and no-JavaScript checks.`,
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
