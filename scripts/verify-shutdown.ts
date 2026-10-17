import { _electron } from "playwright";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createFixtures } from "./fixtures";
import type { DesktopAPI } from "../src/shared/types";
const exec = promisify(execFile);
const root = resolve("work/shutdown-verification");
await mkdir(root, { recursive: true });
const toolDir = resolve("resources/tools");
const suffix = process.platform === "win32" ? ".exe" : "";
const tools = {
  ffmpeg: join(toolDir, "ffmpeg" + suffix),
  ffprobe: join(toolDir, "ffprobe" + suffix),
  ytdlp: join(toolDir, "yt-dlp" + suffix),
  m3u8: join(toolDir, "N_m3u8DL-RE" + suffix),
  runtime: process.execPath,
};
const fixture = await createFixtures(join(root, "fixtures"), tools);
fixture.setSlowSegments(true);
const profile = join(root, "profile-" + randomUUID());
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env))
  if (value !== undefined) env[key] = value;
env.VIDOWN_TEST_DATA = profile;
env.VIDOWN_HEADLESS = "1";
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  _electron.launch({
    executablePath: resolve("release/win-unpacked/Vidown.exe"),
    args: [],
    env,
  });
let app = await launch();
async function until<T>(
  check: () => Promise<T | undefined>,
  timeout = 20000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("Shutdown verification timed out");
}
try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  await page.evaluate(
    (dir) => window.vidown.settings({ downloadDir: dir }),
    join(root, "downloads"),
  );
  await page.evaluate(
    (url) => window.vidown.browser({ action: "new", url }),
    fixture.origin + "/login",
  );
  const candidate = await until(async () =>
    (await page.evaluate(() => window.vidown.snapshot())).candidates.find(
      (c) => c.protocol === "hls",
    ),
  );
  const asset = await page.evaluate(
    (candidateId) => window.vidown.probe({ candidateId }),
    candidate.id,
  );
  await page.evaluate((input) => window.vidown.download(input), {
    assetId: asset.id,
    trackIds: asset.tracks.map((t) => t.id),
    output: "source" as const,
  });
  await until(async () =>
    fixture.requests.some((r) => r.path.endsWith(".ts")) ? true : undefined,
  );
  const metrics = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => m.pid),
  );
  const childPids: number[] =
    process.platform === "win32"
      ? await until(async () => {
          const { stdout } = await exec(
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              `Get-CimInstance Win32_Process -Filter "Name='N_m3u8DL-RE.exe'" | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`,
            ],
            { windowsHide: true },
          );
          const rows = stdout.trim() ? JSON.parse(stdout) : [];
          const pids = (Array.isArray(rows) ? rows : [rows])
            .filter((r) => metrics.includes(r.ParentProcessId))
            .map((r) => r.ProcessId);
          return pids.length ? pids : undefined;
        })
      : [];
  const start = Date.now();
  await app.close();
  for (const pid of childPids)
    await until(async () => {
      try {
        process.kill(pid, 0);
        return undefined;
      } catch {
        return true;
      }
    }, 5000);
  const requestsAtExit = fixture.requests.length;
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(
    fixture.requests.length,
    requestsAtExit,
    "Requests continued after desktop shutdown",
  );
  app = await launch();
  const restarted = await app.firstWindow();
  await restarted
    .getByRole("heading", { name: "把精彩，完整保存。" })
    .waitFor();
  const snapshot = await restarted.evaluate(() => window.vidown.snapshot());
  assert(snapshot.tasks.some((t) => t.state === "interrupted"));
  assert(!snapshot.tasks.some((t) => t.state === "completed"));
  const report = {
    generatedAt: new Date().toISOString(),
    status: "passed",
    scope:
      "Normal desktop close during an actual HLS download; native child processes exit, source requests stop and restart retains an interrupted task. OS-level forced termination is not covered.",
    childProcessesStopped: childPids.length,
    shutdownAndRestartElapsedMs: Date.now() - start,
    checks: [
      "in-flight download stops before utility parent exits",
      "no further source requests after close",
      "restart marks unfinished task interrupted",
      "no false completion",
    ],
  };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close().catch(() => {});
  await fixture.close();
}
