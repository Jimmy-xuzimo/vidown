import { _electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

// Explicit public-network acceptance. Isolated profile; no real account credentials.
const root = resolve(
  process.env.VIDOWN_SITE_REPORT || "work/sites-verification",
);
await mkdir(root, { recursive: true });
const env: NodeJS.ProcessEnv = {
  ...process.env,
  VIDOWN_TEST_DATA: join(root, "profile-" + randomUUID()),
  VIDOWN_HEADLESS: "1",
  VIDOWN_BROWSER_BACKEND: process.env.VIDOWN_BROWSER_BACKEND || "webview2",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  args: ["."],
  cwd: resolve("."),
  env: env as Record<string, string>,
});
const checks: any[] = [];
try {
  const page = await app.firstWindow();
  await page.evaluate(
    (downloadDir) => window.vidown.settings({ downloadDir, clipboard: false }),
    join(root, "downloads"),
  );
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  await page
    .getByLabel("视频链接", { exact: true })
    .fill("https://www.bilibili.com/bangumi/play/ss231879?theme=movie");
  await page.getByRole("button", { name: "探测资源", exact: true }).click();
  await page
    .getByRole("button", { name: "潮汕话版", exact: true })
    .waitFor({ timeout: 60000 });
  assert(
    await page
      .getByRole("button", { name: "普通话版", exact: true })
      .isVisible(),
  );
  await page.screenshot({ path: join(root, "film-versions.png") });
  checks.push({
    site: "Bilibili film",
    check: "season voice selection UI",
    passed: true,
  });
  await page.getByRole("button", { name: "潮汕话版", exact: true }).click();
  await page
    .getByLabel("视频轨道", { exact: true })
    .waitFor({ timeout: 60000 });
  checks.push({
    site: "Bilibili film",
    check: "single episode formats",
    passed: true,
    options: await page
      .getByLabel("视频轨道", { exact: true })
      .locator("option")
      .allTextContents(),
    warnings: await page
      .locator(".format-card .inline-warning")
      .allTextContents(),
  });
  await page.screenshot({ path: join(root, "film-formats.png") });
  const media = await app.evaluate(async () => {
    const b = (globalThis as any).__vidownBrowser;
    const api =
      "https://api.bilibili.com/pgc/player/web/v2/playurl?ep_id=5990057&fnval=12240&fourk=1&qn=127";
    const r = await b.session.fetch(api, {
      credentials: "include",
      headers: b.headersFor(api, "https://www.bilibili.com/"),
    });
    const d = await r.json();
    const v = (d.result ?? d.data)?.video_info;
    const source =
      v?.dash?.video?.[0]?.baseUrl ??
      v?.dash?.video?.[0]?.base_url ??
      v?.durl?.[0]?.url;
    if (!source) throw new Error("No media URL");
    const stream = v?.dash?.video?.[0] ?? v?.durl?.[0];
    const locations = [
      source,
      ...(stream?.backupUrl ?? stream?.backup_url ?? []),
    ];
    let response: Response | undefined;
    const failures: string[] = [];
    let attempts = 0;
    for (const location of locations) {
      attempts++;
      try {
        const r = await b.session.fetch(location, {
          credentials: "include",
          referrerPolicy: "unsafe-url",
          headers: {
            ...b.headersFor(
              location,
              "https://www.bilibili.com/bangumi/play/ep5990057",
            ),
            Range: "bytes=0-16383",
          },
          signal: AbortSignal.timeout(20000),
        });
        if (r.ok) {
          response = r;
          break;
        }
        failures.push(new URL(location).origin + " HTTP " + r.status);
        await r.body?.cancel();
      } catch (e) {
        failures.push(new URL(location).origin + " " + String(e));
      }
    }
    if (!response)
      throw new Error("All original sources failed: " + failures.join("; "));
    const reader = response.body!.getReader();
    let bytes = 0;
    try {
      while (bytes < 16384) {
        const block = await reader.read();
        if (block.done) break;
        bytes += block.value.length;
      }
    } finally {
      await reader.cancel();
    }
    return {
      attempts,
      status: response.status,
      bytes,
      type: response.headers.get("content-type"),
      preview: Boolean(v.is_preview),
    };
  });
  assert(
    media.status >= 200 &&
      media.status < 300 &&
      media.bytes > 0 &&
      !media.type?.includes("html"),
  );
  checks.push({
    site: "Bilibili film",
    check: "actual source partial bytes",
    passed: true,
    ...media,
  });
  for (const [site, url] of [
    ["Bilibili film queue", "https://www.bilibili.com/bangumi/play/ep5990057"],
    ["Bilibili投稿", "https://www.bilibili.com/video/BV1NGZtBwELa/"],
    ["Douyin", "https://www.douyin.com/jingxuan?modal_id=7666811827413601586"],
    ["X", "https://x.com/AlanShao111/status/2108406850727076182/video/1"],
    ["YouTube", "https://www.youtube.com/watch?v=jNQXAC9IVRw"],
    ["Vimeo", "https://vimeo.com/76979871"],
  ]) {
    console.log("Checking", site);
    try {
      const asset = await page.evaluate(
        (url) => window.vidown.probe({ url }),
        url,
      );
      assert(asset.tracks.length > 0);
      checks.push({
        site,
        check: "public extraction",
        passed: true,
        formats: asset.tracks.length,
        kinds: [...new Set(asset.tracks.map((t) => t.kind))],
        warnings: asset.warnings,
      });
      const before = (
        await page.evaluate(() => window.vidown.snapshot())
      ).tasks.map((t) => t.id);
      const video = asset.tracks.find((t) => t.kind !== "audio");
      const audio =
        video?.kind === "muxed"
          ? undefined
          : asset.tracks.find((t) => t.kind === "audio");
      await page.evaluate((input) => window.vidown.download(input), {
        assetId: asset.id,
        trackIds: [video?.id, audio?.id].filter((id): id is string =>
          Boolean(id),
        ),
        output: "source" as const,
      });
      const task = (
        await page.evaluate(() => window.vidown.snapshot())
      ).tasks.find((t) => !before.includes(t.id));
      assert(task, "Download must create a persisted task");
      let current = task;
      try {
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
          current = (
            await page.evaluate(() => window.vidown.snapshot())
          ).tasks.find((t) => t.id === task.id)!;
          if (
            current.state === "failed" ||
            current.state === "completed" ||
            (current.networkBytes ?? current.bytes ?? 0) >= 16384
          )
            break;
          await new Promise((r) => setTimeout(r, 200));
        }
        checks.push({
          site,
          check: "actual queue transfer (bounded, then cancel)",
          passed:
            current.state !== "failed" &&
            (current.networkBytes ?? current.bytes ?? 0) > 0,
          bytes: current.networkBytes ?? current.bytes ?? 0,
          state: current.state,
          error: current.error?.replace(/https?:\/\/[^\s]+/g, "[URL]"),
        });
      } finally {
        if (
          ["queued", "downloading", "merging", "verifying"].includes(
            current.state,
          )
        )
          await page.evaluate(
            (id) => window.vidown.task({ id, action: "cancel" }),
            task.id,
          );
      }
    } catch (error) {
      checks.push({
        site,
        check: "public extraction",
        passed: false,
        reason: String(error)
          .replace(/https?:\/\/[^\s]+/g, "[URL]")
          .slice(0, 1200),
      });
    }
  }
  assert(
    checks.some(
      (c) =>
        c.site === "Bilibili film queue" &&
        c.check.startsWith("actual queue") &&
        c.passed,
    ),
    "The film source must also work through the production download queue",
  );
} finally {
  await writeFile(
    join(root, "report.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        scope:
          "public sources; isolated profile; no premium account; bounded media reads",
        checks,
      },
      null,
      2,
    ),
  );
  await app.close();
}
console.log(JSON.stringify(checks, null, 2));
