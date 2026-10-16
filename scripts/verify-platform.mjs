import { _electron } from "playwright";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const url = new URL(process.argv[2]);
if (!/^https?:$/.test(url.protocol)) throw new Error("HTTP URL required");
url.search = "";
url.hash = "";
const root = resolve(
  process.env.VIDOWN_PLATFORM_ROOT || "work/platform-verification",
);
await mkdir(root, { recursive: true });
const env = {
  ...process.env,
  VIDOWN_TEST_DATA: join(root, "profile"),
  VIDOWN_HEADLESS: "",
};
delete env.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({
  executablePath: resolve(
    process.env.VIDOWN_VERIFY_EXECUTABLE ||
      "release/win-unpacked/Vidown Preview.exe",
  ),
  args: [],
  cwd: resolve("."),
  env,
});
const page = await application.firstWindow();
await page.getByRole("heading", { name: "把精彩，完整保存。" }).waitFor();
await page.getByRole("button", { name: "浏览器探测", exact: true }).click();
await page.evaluate(
  (url) => window.vidown.browser({ action: "new", url }),
  url.href,
);
const requiresLocalLogin = /(^|\.)bilibili\.com$/.test(url.hostname);
let loginDetected = false;
console.log(
  requiresLocalLogin
    ? "Vidown opened the supplied page. Sign in locally in the embedded browser."
    : "Vidown opened the supplied page. Probing publicly available formats.",
);
await writeFile(
  join(root, "status.json"),
  JSON.stringify(
    {
      page: url.href,
      state: requiresLocalLogin
        ? "awaiting-local-login"
        : "probing-public-source",
    },
    null,
    2,
  ),
);
let readyToProbe = !requiresLocalLogin;
if (!readyToProbe) {
  let loggedIn = false;
  for (let i = 0; i < 600 && !loggedIn; i++) {
    if (page.isClosed()) break;
    loggedIn = await application.evaluate(
      async ({ session }) =>
        (
          await session
            .fromPartition("persist:vidown-browser")
            .cookies.get({ name: "SESSDATA" })
        ).length > 0,
    );
    if (!loggedIn) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (loggedIn) {
    readyToProbe = true;
    loginDetected = true;
  }
}
if (readyToProbe) {
  console.log(
    loginDetected
      ? "Local login detected. Probing available formats without exporting session credentials."
      : "Probing public source; no account login was required by this verification.",
  );
  try {
    const asset = await page.evaluate(
      (url) => window.vidown.probe({ url }),
      url.href,
    );
    await writeFile(
      join(root, "formats.json"),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), loginDetected, asset },
        null,
        2,
      ),
    );
    await writeFile(
      join(root, "status.json"),
      JSON.stringify(
        { page: url.href, state: "formats-ready", loginDetected },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          title: asset.title,
          tracks: asset.tracks,
          warnings: asset.warnings,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile(
      join(root, "status.json"),
      JSON.stringify(
        { page: url.href, state: "probe-failed", error: String(error) },
        null,
        2,
      ),
    );
    console.error(String(error));
  }
}
// Keep the user's login browser open for manual playback and resource selection.
await new Promise((resolve) => application.on("close", resolve));
