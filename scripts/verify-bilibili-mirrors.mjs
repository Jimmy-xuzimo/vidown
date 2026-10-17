import { _electron } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const root = resolve("work/bilibili-mirror-verification");
await mkdir(root, { recursive: true });
const url = "https://www.bilibili.com/video/BV1NGZtBwELa/";
const env = {
  ...process.env,
  VIDOWN_TEST_DATA: resolve("work/platform-verification/profile"),
  VIDOWN_HEADLESS: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: resolve("release/win-unpacked/Vidown.exe"),
  args: [],
  env,
});
const page = await app.firstWindow();
let previousSettings;
try {
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  previousSettings = (await page.evaluate(() => window.vidown.snapshot()))
    .settings;
  const asset = await page.evaluate((url) => window.vidown.probe({ url }), url);
  const audio = asset.tracks.find(
    (t) => t.kind === "audio" && /ec-3|eac3/.test(t.codec ?? ""),
  );
  assert(audio, "Logged-in Dolby audio is unavailable");
  const source = await app.evaluate(async ({ session }, url) => {
    const s = session.fromPartition("persist:vidown-browser");
    const text = await (await s.fetch(url, { credentials: "include" })).text();
    const match = text.match(
      /window\.__playinfo__\s*=\s*(\{.+?\})\s*;?\s*<\/script>/s,
    );
    if (!match) throw new Error("No inline play info");
    const audio = JSON.parse(match[1]).data.dash.dolby.audio[0];
    let primaryOrigin;
    const info = {
      blockedPrimaryRequests: 0,
      backupRequests: 0,
      availableBackups: (audio.backupUrl ?? audio.backup_url ?? []).length,
    };
    globalThis.__vidownMirrorTest = info;
    s.webRequest.onBeforeRequest(
      { urls: ["https://*/*"] },
      (details, callback) => {
        const target = new URL(details.url);
        if (/\.m4s$/.test(target.pathname)) {
          primaryOrigin ??= target.origin;
          if (target.origin === primaryOrigin) {
            info.blockedPrimaryRequests++;
            callback({ cancel: true });
            return;
          }
          info.backupRequests++;
        }
        callback({ cancel: false });
      },
    );
    return { availableBackups: info.availableBackups };
  }, url);
  assert(source.availableBackups > 0);
  await page.evaluate(
    (directory) => window.vidown.settings({ downloadDir: directory }),
    join(root, "downloads"),
  );
  const before = new Set(
    (await page.evaluate(() => window.vidown.snapshot())).tasks.map(
      (t) => t.id,
    ),
  );
  await page.evaluate((input) => window.vidown.download(input), {
    assetId: asset.id,
    trackIds: [audio.id],
    output: "source",
  });
  let task;
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    task = (await page.evaluate(() => window.vidown.snapshot())).tasks.find(
      (t) => !before.has(t.id),
    );
    if (task?.state === "failed") throw new Error(task.error);
    if (task?.state === "completed") break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal(task?.state, "completed", "Mirror download did not complete");
  const counts = await app.evaluate(() => globalThis.__vidownMirrorTest);
  assert(counts.blockedPrimaryRequests > 0 && counts.backupRequests > 0);
  const report = {
    generatedAt: new Date().toISOString(),
    page: url,
    status: "passed",
    scope:
      "Packaged application, existing local login, complete Dolby audio-only track; deliberate cancellation of primary CDN requests forces a real registered backup. No browser credentials or source URLs exported.",
    ...counts,
    selectedTrack: audio,
    task,
  };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app
    .evaluate(({ session }) =>
      session
        .fromPartition("persist:vidown-browser")
        .webRequest.onBeforeRequest(null),
    )
    .catch(() => {});
  if (previousSettings)
    await page
      .evaluate(
        (settings) => window.vidown.settings(settings),
        previousSettings,
      )
      .catch(() => {});
  await app.close();
}
