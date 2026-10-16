import { chromium } from "playwright";
import { resolve, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const root = resolve("work/platform-verification");
const port = (
  await readFile(join(root, "profile/DevToolsActivePort"), "utf8")
).split(/\r?\n/)[0];
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((page) => page.url().startsWith("file:"));
if (!page) throw new Error("Local Vidown renderer not found");
const { asset } = JSON.parse(
  await readFile(join(root, "formats.json"), "utf8"),
);
const video =
  asset.tracks.find((track) => track.dynamicRange === "DV") ||
  asset.tracks.find((track) => track.kind === "video");
const audio =
  asset.tracks.find(
    (track) => track.kind === "audio" && /flac/i.test(track.codec),
  ) || asset.tracks.find((track) => track.kind === "audio");
if (!video || !audio) throw new Error("No selected source tracks");
await page.evaluate(
  (directory) => window.vidown.settings({ downloadDir: directory }),
  join(root, "downloads"),
);
await page.evaluate((input) => window.vidown.download(input), {
  assetId: asset.id,
  trackIds: [video.id, audio.id],
  output: "source",
});
console.log(
  JSON.stringify({ state: "queued", video: video.label, audio: audio.label }),
);
await page.getByRole("button", { name: "下载记录", exact: true }).click();
const initial = await page.evaluate(() => window.vidown.snapshot());
const currentId =
  initial.tasks.find(
    (task) => task.title === asset.title && task.state === "queued",
  )?.id || initial.tasks.find((task) => task.title === asset.title)?.id;
const end = Date.now() + 15 * 60 * 1000;
let lastBytes = 0;
while (Date.now() < end) {
  const snapshot = await page.evaluate(() => window.vidown.snapshot());
  const task = snapshot.tasks.find((task) => task.id === currentId);
  if (task?.state === "failed") throw new Error(task.error);
  if (task?.bytes && task.bytes - lastBytes > 16 * 1024 * 1024) {
    lastBytes = task.bytes;
    console.log(JSON.stringify({ state: task.state, bytes: task.bytes }));
  }
  if (task?.state === "completed") {
    await writeFile(
      join(root, "download.json"),
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
    await page.getByText("已完成", { exact: true }).first().waitFor();
    await page.screenshot({ path: join(root, "completed-download.png") });
    console.log(
      JSON.stringify({ state: task.state, id: task.id, output: task.output }),
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
throw new Error("Platform download verification timed out");
