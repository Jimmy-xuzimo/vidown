import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
import { listenLoopback } from "../src/core/loopback";

const directory = resolve("site");
const root = resolve("work/site-verification");
await mkdir(root, { recursive: true });
const server = createServer(async (req, res) => {
  const path = resolve(
    directory,
    "." +
      new URL(req.url ?? "/", "http://localhost").pathname.replace(
        /\/$/,
        "/index.html",
      ),
  );
  if (!path.startsWith(directory + "/") && !path.startsWith(directory + "\\")) {
    res.writeHead(403).end();
    return;
  }
  try {
    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, {
      "content-type": mime[extname(path)] ?? "application/octet-stream",
    });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await listenLoopback(server);
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results: { name: string; status: string }[] = [];
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}`);
  });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1 }).waitFor();
    assert.equal(await page.locator("h1").count(), 1);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    // Force lazy images into view before checking their real decoded dimensions.
    for (const image of await page.locator("img").all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((img: HTMLImageElement) => {
        img.loading = "eager";
      });
      await page.waitForFunction(
        (img) =>
          img instanceof HTMLImageElement &&
          img.complete &&
          img.naturalWidth > 0,
        await image.elementHandle(),
      );
      await image
        .evaluate((img: HTMLImageElement) => img.decode())
        .catch(async () => {
          throw new Error(
            "Image decode failed: " + (await image.getAttribute("src")),
          );
        });
      assert(
        await image.evaluate((img: HTMLImageElement) => img.naturalWidth > 0),
      );
    }
    for (const link of await page.locator('a[href^="#"]').all()) {
      const id = await link.getAttribute("href");
      if (id && id !== "#") assert((await page.locator(id).count()) > 0);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(root, `website-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    results.push({
      name: `responsive-${width}px-no-overflow-valid-images-and-section-links`,
      status: "passed",
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".primary")
      .first()
      .evaluate((node) => getComputedStyle(node).transitionDuration),
    "0s",
  );
  assert.deepEqual(errors, []);
  results.push({
    name: "reduced-motion-and-no-browser-runtime-or-resource-errors",
    status: "passed",
  });
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  const report = {
    generatedAt: new Date().toISOString(),
    scope:
      "Local static website in headless system Edge; not proof of GitHub Pages deployment",
    results,
  };
  await writeFile(
    resolve(root, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
