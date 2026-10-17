// Public formats only; no personal profiles and no full-video downloads.
import { _electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { redact } from "../src/core/safety";
const root = resolve("work/public-formats-1.0.2");
await mkdir(root, { recursive: true });
const env = {
  ...process.env,
  VIDOWN_TEST_DATA: join(root, "profile-" + randomUUID()),
  VIDOWN_HEADLESS: "1",
};
delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: resolve("release/win-unpacked/Vidown.exe"),
  args: [],
  env: env as Record<string, string>,
});
const results: Record<string, unknown>[] = [];
try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  await page.evaluate(() =>
    window.vidown.settings({
      clipboard: false,
      proxy: "http://127.0.0.1:7890",
    }),
  );
  for (const [platform, url] of [
    ["bilibili", "https://www.bilibili.com/video/BV1NGZtBwELa/"],
    ["x", "https://x.com/AlanShao111/status/2108406850727076182/video/1"],
    ["youtube", "https://www.youtube.com/watch?v=aqz-KE-bpKQ"],
  ]) {
    try {
      const asset = await page.evaluate(
        (url) => window.vidown.probe({ url }),
        url,
      );
      const videos = asset.tracks.filter((t) => t.kind === "video"),
        audios = asset.tracks.filter((t) => t.kind === "audio");
      results.push({
        platform,
        status: "parsed",
        videoTracks: videos.length,
        audioTracks: audios.length,
        maxHeight: Math.max(0, ...videos.map((t) => t.height ?? 0)),
      });
    } catch (error) {
      results.push({
        platform,
        status: "failed",
        reason: redact((error as Error).message),
      });
    }
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  await app.close();
  await writeFile(
    join(root, "report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        version: "1.0.2",
        scope:
          "Public format extraction in isolated profile using local proxy; no account, no full download, no signed URLs or credentials in report. Does not verify paid/private/highest account formats.",
        results,
      },
      null,
      2,
    ),
  );
}
