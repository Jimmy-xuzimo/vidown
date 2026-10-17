import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

const executable = resolve(
  process.env.VIDOWN_VERIFY_EXECUTABLE ||
    "release/win-unpacked/Vidown Preview.exe",
);
const root = resolve(
  process.env.VIDOWN_VERIFY_REPORT_DIR || "work/startup-verification",
);
await mkdir(root, { recursive: true });
const results = [];
for (let i = 0; i < 2; i++) {
  const profile = join(root, "profile-" + randomUUID());
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VIDOWN_TEST_DATA: profile,
    VIDOWN_HEADLESS: "",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const start = performance.now();
  const child = spawn(executable, ["--remote-debugging-port=0"], {
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  let browser;
  try {
    let port = "";
    while (!port && performance.now() - start < 60000) {
      try {
        port = (
          await readFile(join(profile, "DevToolsActivePort"), "utf8")
        ).split(/\r?\n/)[0];
      } catch {}
      if (!port) await new Promise((r) => setTimeout(r, 40));
    }
    if (!port)
      throw new Error("Startup did not expose its test debugging port");
    browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
    let page;
    while (!page && performance.now() - start < 60000) {
      page = browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().startsWith("file:"));
      if (!page) await new Promise((r) => setTimeout(r, 40));
    }
    if (!page) throw new Error("Startup did not load the application");
    await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
    const readyMs = Math.round(performance.now() - start);
    const snapshot = await page.evaluate(() => window.vidown.snapshot());
    results.push({
      run: i + 1,
      readyMs,
      version: snapshot.version ?? "alpha.4 baseline",
      startup: snapshot.startup ?? null,
    });
    await page.evaluate(() => window.close());
    await new Promise<void>((r) => {
      if (child.exitCode !== null) return r();
      child.once("exit", () => r());
      setTimeout(r, 4000).unref();
    });
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill();
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  executable,
  scope:
    "Two isolated-profile starts; warm OS caches, includes automation connection overhead; no cold-boot claim",
  results,
};
await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
