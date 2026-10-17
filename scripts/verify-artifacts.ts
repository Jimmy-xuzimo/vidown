import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { command } from "../src/core/process";

const version = JSON.parse(await readFile("package.json", "utf8")).version;
const root = resolve("work", `artifacts-${version}-${randomUUID()}`);
await mkdir(root, { recursive: true });
const zip = resolve("node_modules/electron-winstaller/vendor/7z.exe");
const hash = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const selected = [
  "Vidown.exe",
  "resources/app.asar",
  "resources/icon.ico",
  "resources/webview2-host/Vidown.WebView2.exe",
  "resources/webview2-host/Vidown.WebView2.dll",
  "resources/THIRD_PARTY_NOTICES.md",
  ...[
    "ffmpeg.exe",
    "ffprobe.exe",
    "yt-dlp.exe",
    "N_m3u8DL-RE.exe",
    "tools.lock.json",
  ].map((name) => "resources/tools/" + name),
];
const artifacts: {
  file: string;
  bytes: number;
  sha256: string;
  payloadSHA256: string;
}[] = [];
const checks: {
  artifact: string;
  file: string;
  matchesTestedApplication: boolean;
  sha256: string;
}[] = [];
for (const kind of ["Setup", "Portable"]) {
  const file = `Vidown-${kind}-${version}.exe`;
  const directory = join(root, kind);
  await command(zip, [
    "x",
    resolve("release", file),
    "$PLUGINSDIR\\app-64.7z",
    `-o${directory}`,
    "-y",
  ]);
  const payload = join(directory, "$PLUGINSDIR/app-64.7z");
  artifacts.push({
    file,
    bytes: (await stat(resolve("release", file))).size,
    sha256: await hash(resolve("release", file)),
    payloadSHA256: await hash(payload),
  });
  await command(zip, [
    "x",
    payload,
    `-o${directory}/payload`,
    "-y",
    ...selected,
  ]);
  for (const name of selected) {
    const actual = await hash(join(directory, "payload", name));
    assert.equal(
      actual,
      await hash(resolve("release/win-unpacked", name)),
      `Payload differs: ${kind} ${name}`,
    );
    checks.push({
      artifact: kind,
      file: name,
      matchesTestedApplication: true,
      sha256: actual,
    });
  }
}
assert.equal(artifacts[0].payloadSHA256, artifacts[1].payloadSHA256);
const report = {
  generatedAt: new Date().toISOString(),
  version,
  scope:
    "Local NSIS archive inspection, matching application/engines/native host. Installer wizard, clean-machine install and uninstall are not tested.",
  artifacts,
  checks,
};
await writeFile(
  resolve(`docs/validation/artifacts-${version}.json`),
  JSON.stringify(report, null, 2),
);
await writeFile(
  resolve("release", `Vidown-${version}-SHA256SUMS.txt`),
  artifacts.map((a) => `${a.sha256}  ${a.file}`).join("\n") + "\n",
);
console.log(
  JSON.stringify({ artifacts, verifiedPayloadFiles: checks.length }, null, 2),
);
