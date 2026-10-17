import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { format } from "prettier";
const root = resolve(".");
const destination = resolve("docs/validation");
await mkdir(destination, { recursive: true });
async function writeReport(path, json) {
  await writeFile(path, await format(json, { parser: "json" }));
}
function portable(value) {
  if (typeof value === "string" && value.startsWith(root))
    return relative(root, value).replaceAll("\\", "/");
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, portable(item)]),
    );
  return value;
}
for (const [name, source] of [
  ["controlled-media", "work/media-verification/report.json"],
  ["windows-packaged", "work/packaged-verification/report.json"],
  ["windows-portable", "work/portable-verification/report.json"],
  ["bilibili-preservation", "work/platform-verification/preservation.json"],
  ["x-download-smoke", "work/x-verification/smoke.json"],
  ["x-complete", "work/x-complete-verification/report.json"],
  ["x-complete-preservation", "work/x-complete-verification/preservation.json"],
  [
    "bilibili-flac-preservation",
    "work/bilibili-flac-verification/preservation.json",
  ],
  ["bilibili-flac-only", "work/bilibili-flac-verification/audio-only.json"],
  ["task-controls", "work/task-controls-verification/report.json"],
  ["browser-session", "work/browser-session-verification/report.json"],
  ["workbench-login", "work/workbench-login-verification/report.json"],
  ["web-downloads", "work/web-downloads-verification/report.json"],
  [
    "bilibili-8k-preservation",
    "work/high-spec-verification/8k/preservation.json",
  ],
  [
    "bilibili-hdr10-preservation",
    "work/high-spec-verification/hdr10/preservation.json",
  ],
  ["bilibili-backup-cdn", "work/bilibili-mirror-verification/report.json"],
  ["mirror-isolation", "work/mirror-verification/report.json"],
  ["protocol-edges", "work/protocol-edge-verification/report.json"],
  ["windows-shutdown", "work/shutdown-verification/report.json"],
  ["tools-windows-x64", "resources/tools/tools.lock.json"],
]) {
  const data = JSON.parse(await readFile(source, "utf8"));
  await writeReport(
    join(destination, name + ".json"),
    JSON.stringify(portable(data), null, 2) + "\n",
  );
}
for (const [name, source] of [
  ["bilibili", "work/platform-verification"],
  ["x", "work/x-verification"],
]) {
  const { asset, loginDetected } = JSON.parse(
    await readFile(join(source, "formats.json"), "utf8"),
  );
  await writeReport(
    join(destination, `${name}-formats.json`),
    JSON.stringify(
      {
        page: asset.pageUrl,
        title: asset.title,
        duration: asset.duration,
        loginDetected,
        tracks: asset.tracks.map(({ id, ...track }) => track),
        warnings: asset.warnings,
      },
      null,
      2,
    ) + "\n",
  );
}
await mkdir("docs/images", { recursive: true });
await copyFile(
  "work/packaged-verification/01-workbench.png",
  "docs/images/workbench.png",
);
console.log(
  "Only selected, public metadata reports and the clean fixture workbench screenshot were collected; no profile, signed URL or source media copied.",
);
