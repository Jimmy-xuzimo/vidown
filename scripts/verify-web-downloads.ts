import { _electron } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createFixtures } from "./fixtures";
import { digest } from "../src/core/safety";

const root = resolve("work/web-downloads-verification");
await mkdir(root, { recursive: true });
const dir = resolve("resources/tools");
const fixture = await createFixtures(join(root, "fixtures"), {
  ffmpeg: join(dir, "ffmpeg.exe"),
  ffprobe: join(dir, "ffprobe.exe"),
  ytdlp: join(dir, "yt-dlp.exe"),
  m3u8: join(dir, "N_m3u8DL-RE.exe"),
  runtime: process.execPath,
});
const source = await readFile(join(fixture.root, "direct.mp4"));
const env: Record<string, string> = {
  ...(Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  ) as Record<string, string>),
  VIDOWN_TEST_DATA: join(root, "profile-" + randomUUID()),
  VIDOWN_HEADLESS: "",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  ...(process.env.VIDOWN_VERIFY_EXECUTABLE
    ? {
        executablePath: resolve(process.env.VIDOWN_VERIFY_EXECUTABLE),
        args: [],
      }
    : { args: ["."] }),
  env,
  cwd: resolve("."),
});
const results: { name: string; status: string }[] = [];
async function until<T>(
  fn: () => Promise<T | false | undefined>,
  timeout = 45000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Web download assertion timed out");
}
try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  await page.evaluate(
    (downloadDir) => window.vidown.settings({ downloadDir }),
    join(root, "downloads"),
  );
  // An isolated protocol fixture uses the same DOM contract as Web A, with real MP4 bytes and blob download.
  // It proves the integration, not real Telegram authentication or media access.
  await app.evaluate(({ session }, base64) => {
    session
      .fromPartition("persist:vidown-browser")
      .protocol.handle("https", (request) => {
        const url = new URL(request.url);
        if (url.hostname === "webk.telegram.org") {
          if (url.pathname.startsWith("/stream/")) {
            const renderer =
              request.headers.get("sec-fetch-dest") === "video" ||
              request.headers.has("range");
            if (!renderer)
              (globalThis as any).telegramStreamReplays =
                ((globalThis as any).telegramStreamReplays ?? 0) + 1;
            return new Response(
              renderer
                ? Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
                : "client required",
              {
                status: renderer ? 200 : 502,
                headers: { "content-type": "video/mp4" },
              },
            );
          }
          return new Response(
            `<!doctype html><style>.hide{display:none} video{width:320px;height:180px}</style>
          <title>Controlled Web K fixture</title>
          <div class="bubbles"><div class="bubble" data-mid="4294967338" data-peer-id="-12345">Controlled K message</div></div>
          <div class="media-viewer-whole"><div class="media-viewer-author"><div class="media-viewer-name">Controlled K</div></div>
          <div class="media-viewer-caption">Original video</div><div class="media-viewer-mover active"><video src="/stream/controlled-original" autoplay muted></video></div>
          <div class="media-viewer-buttons"><button class="btn-icon tgico-download">Download</button></div></div>
          <script>
          function save(){const data=Uint8Array.from(atob('${base64}'),c=>c.charCodeAt(0));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'video/mp4'}));a.download='K-original.mp4';a.click();}
          document.querySelector('.btn-icon').onclick=save;
          document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('.btn-menu-item')?.remove()});
          document.querySelector('.bubble').oncontextmenu=e=>{e.preventDefault();const b=document.createElement('button');b.className='btn-menu-item';b.innerHTML='<span class="tgico-download"></span>Download';b.onclick=save;document.body.append(b)};
          </script>`,
            { headers: { "content-type": "text/html" } },
          );
        }
        return new Response(
          `<!doctype html>
      <title>Controlled web media fixture</title><div class="Message" data-message-id="42">Controlled video</div>
      <script>
      document.addEventListener('keydown', e=>{if(e.key==='Escape')document.querySelector('.MenuItem')?.remove()});
      document.querySelector('.Message').oncontextmenu=e=>{
        e.preventDefault(); document.querySelector('.MenuItem')?.remove();
        if(localStorage.getItem('protectedMessage'))return;
        const b=document.createElement('button');b.className='MenuItem';b.innerHTML='<i class="icon-download"></i>Download';
        b.onclick=()=>{ setTimeout(()=>{ const data=Uint8Array.from(atob(localStorage.getItem('badMedia')?'bm90IGEgbWVkaWEgZmlsZQ==':'${base64}'),c=>c.charCodeAt(0));
          const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'video/mp4'}));a.download='原始媒体.mp4';a.click();},Number(localStorage.getItem('delaySave')||0));b.remove();};document.body.append(b);
      };
      </script>`,
          { headers: { "content-type": "text/html" } },
        );
      });
  }, source.toString("base64"));
  await page
    .getByLabel("视频链接", { exact: true })
    .fill("https://t.me/controlledchannel/42");
  await page.getByRole("button", { name: "探测资源", exact: true }).click();
  await page
    .getByRole("heading", { name: "选择保存规格" })
    .waitFor({ timeout: 45000 });
  await page.getByRole("button", { name: "加入下载队列", exact: true }).click();
  const completed = await until(async () => {
    const t = (await page.evaluate(() => window.vidown.snapshot())).tasks[0];
    if (t?.state === "failed") throw new Error(t.error);
    return t?.state === "completed" && t;
  });
  assert.equal(digest(await readFile(completed.output!)), digest(source));
  assert(
    completed.output!.endsWith(".mp4") &&
      !completed.output!.endsWith(".mp4.mp4"),
  );
  results.push({
    name: "paste-message-link-parses-webpage-and-saves-real-blob-media-through-native-task-with-identical-file-hash",
    status: "passed",
  });
  await page
    .getByLabel("视频链接", { exact: true })
    .fill("https://t.me/+invalid-invite");
  await page.getByRole("button", { name: "探测资源", exact: true }).click();
  await page
    .getByText("请粘贴具体消息链接，不是频道首页或邀请链接", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByText("已加入下载队列", { exact: true }).count(),
    0,
  );
  results.push({
    name: "failed-new-probe-clears-stale-task-success-notice",
    status: "passed",
  });
  await page.getByRole("button", { name: "设置与账号", exact: true }).click();
  assert.equal(
    await page.getByLabel("Telegram API ID", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "打开 Telegram 网页", exact: true })
      .count(),
    0,
  );
  results.push({
    name: "no-site-specific-login-entry-or-api-form",
    status: "passed",
  });
  const remote = app
    .windows()
    .find((p) => p.url().includes("web.telegram.org"))!;
  const stale = await page.evaluate(() =>
    window.vidown.probe({ url: "https://t.me/controlledchannel/42" }),
  );
  await remote.evaluate(() => {
    document.querySelector<HTMLElement>(".Message")!.innerText =
      "Changed message";
  });
  await assert.rejects(
    page.evaluate(
      (a) =>
        window.vidown.download({
          assetId: a.id,
          trackIds: [a.tracks[0].id],
          output: "source",
        }),
      stale,
    ),
    /消息或聊天已变化/,
  );
  assert.equal(
    (await page.evaluate(() => window.vidown.snapshot())).tasks[0].state,
    "failed",
  );
  results.push({
    name: "message-fingerprint-change-refuses-saving-a-different-message",
    status: "passed",
  });
  await remote.evaluate(() => {
    localStorage.setItem("protectedMessage", "1");
  });
  await assert.rejects(
    page.evaluate(() =>
      window.vidown.probe({ url: "https://t.me/controlledchannel/42" }),
    ),
    /下载操作|未找到/,
  );
  results.push({
    name: "missing-save-permission-or-changed-page-does-not-produce-a-downloadable-asset",
    status: "passed",
  });
  await remote.evaluate(() => {
    localStorage.removeItem("protectedMessage");
    localStorage.setItem("badMedia", "1");
  });
  const asset = await page.evaluate(() =>
    window.vidown.probe({ url: "https://t.me/controlledchannel/42" }),
  );
  await page.evaluate(
    (a) =>
      window.vidown.download({
        assetId: a.id,
        trackIds: [a.tracks[0].id],
        output: "source",
      }),
    asset,
  );
  const invalidId = (await page.evaluate(() => window.vidown.snapshot()))
    .tasks[0].id;
  await until(
    async () =>
      (await page.evaluate(() => window.vidown.snapshot())).tasks.find(
        (t) => t.id === invalidId,
      )?.state === "failed",
  );
  assert.equal(
    (await page.evaluate(() => window.vidown.snapshot())).tasks.filter(
      (t) => t.state === "completed",
    ).length,
    1,
  );
  results.push({
    name: "fake-mp4-is-rejected-by-real-media-validation-and-never-marked-completed",
    status: "passed",
  });

  await remote.evaluate(() => {
    localStorage.removeItem("badMedia");
    localStorage.setItem("delaySave", "1500");
  });
  const delayed = await page.evaluate(() =>
    window.vidown.probe({ url: "https://t.me/controlledchannel/42" }),
  );
  await page.evaluate(
    (a) =>
      window.vidown.download({
        assetId: a.id,
        trackIds: [a.tracks[0].id],
        output: "source",
      }),
    delayed,
  );
  const pending = (await page.evaluate(() => window.vidown.snapshot()))
    .tasks[0];
  await page.evaluate(
    (id) => window.vidown.task({ id, action: "cancel" }),
    pending.id,
  );
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(
    (await page.evaluate(() => window.vidown.snapshot())).tasks.find(
      (t) => t.id === pending.id,
    )?.state,
    "cancelled",
  );
  results.push({
    name: "cancelled-webpage-preparation-cannot-later-save-a-file-or-become-completed",
    status: "passed",
  });
  fixture.setSlow(true);
  await app.evaluate(async ({ session, webContents }, origin) => {
    await session.fromPartition("persist:vidown-browser").cookies.set({
      url: origin,
      name: "vidown_fixture",
      value: "allowed",
      path: "/",
    });
    webContents
      .getAllWebContents()
      .find((w) => w.getURL().includes("web.telegram.org"))!
      .downloadURL(origin + "/auth/direct.mp4");
  }, fixture.origin);
  const transferring = await until(async () => {
    const t = (await page.evaluate(() => window.vidown.snapshot())).tasks.find(
      (t) =>
        t.source === "browser" &&
        t.state === "downloading" &&
        (t.bytes ?? 0) > 0,
    );
    return t;
  });
  await page.evaluate(
    (id) => window.vidown.task({ id, action: "cancel" }),
    transferring.id,
  );
  await until(
    async () =>
      (await page.evaluate(() => window.vidown.snapshot())).tasks.find(
        (t) => t.id === transferring.id,
      )?.state === "cancelled",
  );
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(
    fixture.requests.filter((r) => r.path === "/auth/direct.mp4").at(-1)
      ?.completed,
    false,
  );
  results.push({
    name: "cancel-native-media-download-stops-the-actual-http-response-and-never-publishes-output",
    status: "passed",
  });

  await page.evaluate(() =>
    window.vidown.browser({ action: "new", url: "https://webk.telegram.org/" }),
  );
  const kTab = (await page.evaluate(() => window.vidown.snapshot())).activeTab!;
  const kPage = await until(async () =>
    app.windows().find((p) => p.url().startsWith("https://webk.telegram.org/")),
  );
  await kPage.locator("video").waitFor();
  const captured = await until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).candidates.find(
      (c) => c.tabId === kTab && c.host === "webk.telegram.org",
    ),
  );
  const replaysBefore = await app.evaluate(
    () => (globalThis as any).telegramStreamReplays ?? 0,
  );
  const kAsset = await page.evaluate(
    (id) => window.vidown.probe({ candidateId: id }),
    captured.id,
  );
  assert.equal(kAsset.tracks[0].protocol, "browser");
  assert.equal(
    await app.evaluate(() => (globalThis as any).telegramStreamReplays ?? 0),
    replaysBefore,
  );
  await page.evaluate(
    (a) =>
      window.vidown.download({
        assetId: a.id,
        trackIds: [a.tracks[0].id],
        output: "source",
      }),
    kAsset,
  );
  const kDone = await until(async () => {
    const t = (await page.evaluate(() => window.vidown.snapshot())).tasks.find(
      (t) => t.title === "Original video",
    );
    if (t?.state === "failed") throw new Error(t.error);
    return t?.state === "completed" && t;
  });
  assert.equal(digest(await readFile(kDone.output!)), digest(source));
  results.push({
    name: "webk-captured-service-worker-media-uses-native-page-save-with-identical-file-hash-and-zero-http-replays",
    status: "passed",
  });

  const viewAsset = await page.evaluate(
    (tabId) => window.vidown.probe({ tabId }),
    kTab,
  );
  await kPage.locator("video").evaluate((v: HTMLVideoElement) => {
    v.src = "/stream/different-video";
  });
  await assert.rejects(
    page.evaluate(
      (a) =>
        window.vidown.download({
          assetId: a.id,
          trackIds: [a.tracks[0].id],
          output: "source",
        }),
      viewAsset,
    ),
    /视频已变化|不一致/,
  );
  results.push({
    name: "webk-current-page-viewer-refuses-changed-media-before-saving",
    status: "passed",
  });
  await assert.rejects(
    page.evaluate(
      (id) => window.vidown.probe({ candidateId: id }),
      captured.id,
    ),
    /不一致/,
  );
  results.push({
    name: "webk-stale-captured-resource-cannot-save-the-current-different-video",
    status: "passed",
  });
  await kPage
    .locator(".media-viewer-whole")
    .evaluate((v) => v.classList.add("no-forwards"));
  await assert.rejects(
    page.evaluate((tabId) => window.vidown.probe({ tabId }), kTab),
    /禁止保存/,
  );
  results.push({
    name: "webk-protected-message-reports-permission-instead-of-502",
    status: "passed",
  });
  await kPage
    .locator(".media-viewer-whole")
    .evaluate((v) => v.classList.remove("no-forwards"));
  await kPage.locator(".btn-icon").evaluate((b) => {
    b.classList.remove("tgico-download");
    b.innerHTML = '<span class="tgico">\ue973</span>';
  });
  assert.equal(
    (await page.evaluate((tabId) => window.vidown.probe({ tabId }), kTab))
      .tracks[0].protocol,
    "browser",
  );
  results.push({
    name: "webk-download-button-detected-with-current-glyph-icon-as-well-as-legacy-class",
    status: "passed",
  });
  const linked = await page.evaluate(() =>
    window.vidown.probe({ url: "https://t.me/c/12345/42" }),
  );
  assert.equal(new URL(kPage.url()).hostname, "webk.telegram.org");
  assert.equal(linked.tracks[0].protocol, "browser");
  assert.equal(
    app.windows().filter((p) => p.url().includes("web.telegram.org")).length,
    1,
  );
  results.push({
    name: "pasted-message-link-reuses-existing-webk-client-origin-and-exact-message",
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
        scope:
          "Controlled Web A and Web K DOM, service-worker URL routing, real blob/media validation. Real Telegram account and private messages remain unverified.",
        results,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify(results, null, 2));
