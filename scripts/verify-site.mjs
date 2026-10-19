import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

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
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
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
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      for (
        let i = 0;
        i < 3 && (await page.getAttribute("html", "data-preference")) !== theme;
        i++
      )
        await page.locator("#theme").click();
      assert.equal(await page.getAttribute("html", "data-theme"), theme);
      for (const language of ["zh-CN", "en"]) {
        if ((await page.getAttribute("html", "lang")) !== language)
          await page.locator("#language").click();
        const history = page.locator("#history");
        await history.scrollIntoViewIfNeeded();
        assert.equal(await history.locator(".release-entry").count(), 6);
        assert.deepEqual(
          await history.locator(".release-version").allTextContents(),
          [
            "1.0.5",
            "1.0.4",
            "1.0.3",
            "1.0.2",
            "0.1.0-preview.5",
            "0.1.0-preview.4",
          ],
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `Overflow: ${width}/${theme}/${language}`,
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
        assert.match(
          await page
            .locator('meta[name="description"]')
            .getAttribute("content"),
          /Android/,
        );
        for (const entry of await history.locator("details").all()) {
          await entry.locator("summary").click();
          assert.equal(await entry.getAttribute("open"), "");
          assert.equal(await entry.locator(".release-body").isVisible(), true);
          await entry.locator("summary").click();
        }
        if (width < 801) {
          await page.locator("#menu").click();
          await page.locator('#mobile-nav a[href="#history"]').click();
          assert.equal(
            await page.locator("#menu").getAttribute("aria-expanded"),
            "false",
          );
        }
        if ([390, 1440].includes(width) && language === "zh-CN")
          await history.screenshot({
            path: resolve(out, `history-${width}-${theme}.png`),
          });
        cases.push({ width, theme, language });
      }
    }
  }
  const releaseLinks = await page
    .locator("#history .release-link")
    .evaluateAll((els) => els.map((el) => el.href));
  const apk = await page
    .locator(".android-actions a")
    .first()
    .getAttribute("href");
  assert.equal(
    apk,
    "https://github.com/Jimmy-xuzimo/vidown/releases/download/android-v0.1.0-preview.5/Vidown-Android-0.1.0-preview.5.apk",
  );
  const noJS = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 900 },
  });
  await noJS.goto(url);
  assert.equal(await noJS.locator("#history .release-entry").count(), 6);
  await noJS.locator("#history details summary").first().click();
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
    url,
    cases,
    noJavaScript: true,
    releaseLinks,
    apk,
    remoteStatus,
  };
  await writeFile(
    resolve(out, "summary.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    `Website passed ${cases.length} layout/theme/language combinations and no-JavaScript history checks.`,
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
