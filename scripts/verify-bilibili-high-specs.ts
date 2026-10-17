import { _electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { command } from "../src/core/process";
const root = resolve("work/high-spec-verification");
const profile = resolve("work/platform-verification/profile");
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env))
  if (value !== undefined) env[key] = value;
env.VIDOWN_TEST_DATA = profile;
env.VIDOWN_HEADLESS = "1";
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: resolve("release/win-unpacked/Vidown.exe"),
  args: [],
  env,
});
const page = await app.firstWindow();
let settings;
try {
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  settings = (await page.evaluate(() => window.vidown.snapshot())).settings;
  const asset = await page.evaluate(
    (url) => window.vidown.probe({ url }),
    "https://www.bilibili.com/video/BV1KG4y1V7WN/",
  );
  assert(
    asset.duration && asset.duration < 240,
    "Use a short controlled public platform sample",
  );
  const audio = asset.tracks.find((t) => t.kind === "audio");
  assert(audio);
  for (const name of ["8k", "hdr10"]) {
    const video =
      name === "8k"
        ? asset.tracks.find((t) => (t.height ?? 0) >= 4320)
        : asset.tracks.find((t) => t.dynamicRange === "HDR10");
    assert(video, `No actual ${name} track`);
    const caseRoot = join(root, name);
    await mkdir(caseRoot, { recursive: true });
    await writeFile(
      join(caseRoot, "formats.json"),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), loginDetected: true, asset },
        null,
        2,
      ),
    );
    await page.evaluate(
      (directory) => window.vidown.settings({ downloadDir: directory }),
      join(caseRoot, "downloads"),
    );
    const before = new Set(
      (await page.evaluate(() => window.vidown.snapshot())).tasks.map(
        (t) => t.id,
      ),
    );
    await page.evaluate((input) => window.vidown.download(input), {
      assetId: asset.id,
      trackIds: [video.id, audio.id],
      output: "source" as const,
    });
    console.log(
      JSON.stringify({
        name,
        state: "queued",
        video: video.label,
        audio: audio.label,
      }),
    );
    const end = Date.now() + 600000;
    let task;
    let logged = 0;
    while (Date.now() < end) {
      task = (await page.evaluate(() => window.vidown.snapshot())).tasks.find(
        (t) => !before.has(t.id),
      );
      if (task?.state === "failed") throw new Error(task.error);
      if (task?.state === "completed") break;
      if ((task?.networkBytes ?? 0) - logged > 32 * 1024 * 1024) {
        logged = task!.networkBytes!;
        console.log(
          JSON.stringify({ name, state: task!.state, networkBytes: logged }),
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(task?.state, "completed");
    await writeFile(
      join(caseRoot, "download.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          page: asset.pageUrl,
          video,
          audio,
          task,
        },
        null,
        2,
      ),
    );
    await command(
      process.execPath,
      ["--import", "tsx", "scripts/verify-preservation.ts"],
      {
        env: {
          VIDOWN_PLATFORM_ROOT: caseRoot,
          VIDOWN_PLATFORM_PROFILE: profile,
        },
        timeout: 600000,
      },
    );
    console.log(
      JSON.stringify({
        name,
        state: "preservation-passed",
        output: task!.output,
      }),
    );
  }
} finally {
  if (settings)
    await page
      .evaluate((settings) => window.vidown.settings(settings), settings)
      .catch(() => {});
  await app.close();
}
