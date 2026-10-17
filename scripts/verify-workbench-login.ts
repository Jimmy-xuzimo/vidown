import { _electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve("work/workbench-login-verification");
await mkdir(root, { recursive: true });
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env))
  if (value !== undefined) env[key] = value;
env.VIDOWN_TEST_DATA = resolve("work/platform-verification/profile");
env.VIDOWN_HEADLESS = process.env.VIDOWN_VERIFY_EXECUTABLE ? "" : "1";
delete env.ELECTRON_RUN_AS_NODE;
const options = {
  ...(process.env.VIDOWN_VERIFY_EXECUTABLE
    ? {
        executablePath: resolve(process.env.VIDOWN_VERIFY_EXECUTABLE),
        args: [],
      }
    : { args: ["."] }),
  env,
  cwd: resolve("."),
};
let app = await _electron.launch(options);
try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  const hasLocalLogin = await app.evaluate(
    async ({ session }) =>
      (
        await session
          .fromPartition("persist:vidown-browser")
          .cookies.get({ name: "SESSDATA", domain: ".bilibili.com" })
      ).length > 0,
  );
  assert(
    hasLocalLogin,
    "Requires the user's existing local login; no credential is exported",
  );
} finally {
  await app.close();
}
app = await _electron.launch(options);
try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.vidown.snapshot())).tabs.length,
    0,
  );
  const url = "https://www.bilibili.com/video/BV1NGZtBwELa/";
  await page.getByLabel("视频链接", { exact: true }).fill(url);
  await page.getByRole("button", { name: "探测资源", exact: true }).click();
  await page
    .getByRole("heading", { name: "选择保存规格" })
    .waitFor({ timeout: 120000 });
  const videoOptions = await page
    .getByLabel("视频轨道", { exact: true })
    .locator("option")
    .allTextContents();
  const audioOptions = await page
    .getByLabel("音频轨道", { exact: true })
    .locator("option")
    .allTextContents();
  assert(
    videoOptions.some((v) => v.includes("2160p") && /DV/.test(v)),
    "Existing login did not expose source Dolby Vision 4K",
  );
  assert(
    audioOptions.some((a) => /ec-3|eac3/i.test(a)),
    "Existing login did not expose Dolby audio",
  );
  const selectedVideo = await page
    .getByLabel("视频轨道", { exact: true })
    .evaluate(
      (select: HTMLSelectElement) => select.selectedOptions[0].textContent,
    );
  assert(
    selectedVideo?.includes("2160p"),
    "Workbench must default to a highest-resolution source track",
  );
  await page.screenshot({ path: join(root, "authenticated-workbench.png") });
  const report = {
    generatedAt: new Date().toISOString(),
    packaged: !!process.env.VIDOWN_VERIFY_EXECUTABLE,
    status: "passed",
    page: url,
    scope:
      "Existing local Bilibili login across app restart, no browser tab opened; actual workbench URL form returns 4K Dolby Vision and Dolby audio and defaults to 2160p. High-quality full download was verified previously, not repeated here.",
    videoOptions,
    audioOptions,
    selectedVideo,
    loginCredentialsExported: false,
  };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      status: "passed",
      selectedVideo,
      highestOptions: videoOptions.filter((v) => /2160p|DV/.test(v)),
    }),
  );
} finally {
  await app.close();
}
