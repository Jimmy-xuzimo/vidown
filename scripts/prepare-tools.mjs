import { mkdir, copyFile, readFile, writeFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const root = resolve("resources/tools");
await mkdir(root, { recursive: true });
const windows = process.platform === "win32",
  exe = windows ? ".exe" : "";
const ytdlpVersion = "2026.08.19",
  nVersion = "v0.6.0-beta";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const yName = windows
  ? arch === "arm64"
    ? "yt-dlp_arm64.exe"
    : "yt-dlp.exe"
  : process.platform === "darwin"
    ? "yt-dlp_macos"
    : arch === "arm64"
      ? "yt-dlp_linux_aarch64"
      : "yt-dlp_linux";
const nPlatform = windows
  ? "win"
  : process.platform === "darwin"
    ? "osx"
    : "linux";
const archive = `N_m3u8DL-RE_${nVersion}_${nPlatform}-${arch}_20260629.${windows ? "zip" : "tar.gz"}`;
async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
const receipts = [];
const yUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${ytdlpVersion}/${yName}`;
console.log("Preparing yt-dlp", ytdlpVersion);
const sums = (
  await get(
    `https://github.com/yt-dlp/yt-dlp/releases/download/${ytdlpVersion}/SHA2-256SUMS`,
  )
).toString();
const expected = sums
  .split(/\r?\n/)
  .find((line) => line.endsWith(" " + yName))
  ?.split(/\s+/)[0];
if (!expected) throw new Error("Missing upstream yt-dlp checksum");
const yPath = join(root, "yt-dlp" + exe);
let yBytes;
try {
  yBytes = await readFile(yPath);
} catch {}
if (!yBytes || hash(yBytes) !== expected) {
  yBytes = await get(yUrl);
  if (hash(yBytes) !== expected) throw new Error("yt-dlp checksum mismatch");
  await writeFile(yPath, yBytes);
}
receipts.push({
  name: "yt-dlp",
  version: ytdlpVersion,
  source: yUrl,
  sha256: hash(yBytes),
  checksum: "upstream SHA2-256SUMS",
  license: "GPL-3.0-or-later (bundled binary)",
});
console.log("Preparing N_m3u8DL-RE", nVersion);
const nUrl = `https://github.com/nilaoda/N_m3u8DL-RE/releases/download/${nVersion}/${archive}`;
// GitHub release assets publish a SHA-256 digest. Fail closed if it cannot be obtained.
let release;
try {
  const r = await fetch(
    `https://api.github.com/repos/nilaoda/N_m3u8DL-RE/releases/tags/${nVersion}`,
  );
  if (r.ok) release = await r.json();
} catch {}
if (!release) {
  try {
    release = JSON.parse(
      execFileSync(
        "gh",
        ["api", `repos/nilaoda/N_m3u8DL-RE/releases/tags/${nVersion}`],
        { encoding: "utf8", windowsHide: true },
      ),
    );
  } catch {
    throw new Error(
      "Cannot obtain N_m3u8DL-RE upstream asset digest; retry with authenticated gh CLI.",
    );
  }
}
const asset = release.assets.find((a) => a.name === archive);
const nHash = asset?.digest?.replace(/^sha256:/, "");
if (!nHash) throw new Error("Upstream N_m3u8DL-RE digest unavailable");
const archivePath = join(root, archive);
let nBytes;
try {
  nBytes = await readFile(archivePath);
} catch {}
if (!nBytes || hash(nBytes) !== nHash) {
  nBytes = await get(nUrl);
  if (hash(nBytes) !== nHash) throw new Error("N_m3u8DL-RE checksum mismatch");
  await writeFile(archivePath, nBytes);
}
const unpack = join(root, ".n-unpack");
await mkdir(unpack, { recursive: true });
execFileSync("tar", ["-xf", archivePath, "-C", unpack], { windowsHide: true });
const { readdir } = await import("node:fs/promises");
async function find(dir, name) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) {
      const f = await find(p, name);
      if (f) return f;
    }
  }
}
const nBinary = await find(unpack, "N_m3u8DL-RE" + exe);
if (!nBinary) throw new Error("Archive missing binary");
await copyFile(nBinary, join(root, "N_m3u8DL-RE" + exe));
receipts.push({
  name: "N_m3u8DL-RE",
  version: nVersion,
  source: nUrl,
  sha256: hash(await readFile(nBinary)),
  archiveSha256: nHash,
  license: "MIT",
});
let ffPaths;
if (windows) {
  const ffVersion = "9.0.2",
    ffArchive = join(root, `.ffmpeg-${ffVersion}.zip`),
    ffExpected =
      "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
  console.log("Preparing matching FFmpeg / ffprobe", ffVersion);
  let ffBytes;
  try {
    ffBytes = await readFile(ffArchive);
  } catch {}
  const ffSource = `https://github.com/GyanD/codexffmpeg/releases/download/${ffVersion}/ffmpeg-${ffVersion}-essentials_build.zip`;
  if (!ffBytes || hash(ffBytes) !== ffExpected) {
    ffBytes = await get(ffSource);
    if (hash(ffBytes) !== ffExpected)
      throw new Error("FFmpeg checksum mismatch");
    await writeFile(ffArchive, ffBytes);
  }
  const ffUnpack = join(root, ".ff-unpack");
  await mkdir(ffUnpack, { recursive: true });
  execFileSync("tar", ["-xf", ffArchive, "-C", ffUnpack], {
    windowsHide: true,
  });
  await mkdir(join(root, "licenses"), { recursive: true });
  const ffLicense = await find(ffUnpack, "LICENSE");
  if (!ffLicense) throw new Error("FFmpeg distribution license missing");
  await copyFile(ffLicense, join(root, "licenses", "FFmpeg-GPL-3.0.txt"));
  ffPaths = [
    ["ffmpeg", await find(ffUnpack, "ffmpeg.exe")],
    ["ffprobe", await find(ffUnpack, "ffprobe.exe")],
  ];
  receipts.push({
    name: "FFmpeg archive",
    version: ffVersion,
    source: ffSource,
    sha256: ffExpected,
    license: "GPL-3.0-or-later",
  });
} else {
  // Non-Windows builds are not release-ready until a current, matching pair is provisioned and tested.
  throw new Error(
    "Current matching FFmpeg / ffprobe pair must be provisioned for this platform before packaging; Windows M0 only.",
  );
}
for (const [name, path] of ffPaths) {
  const target = join(root, name + exe);
  await copyFile(path, target);
  receipts.push({
    name,
    sha256: hash(await readFile(target)),
    source: "GyanD/codexffmpeg 9.0.2",
    version: execFileSync(target, ["-version"], {
      encoding: "utf8",
      windowsHide: true,
    })
      .split("\n")[0]
      .trim(),
    license: "GPL-3.0-or-later",
  });
}
for (const name of ["yt-dlp", "N_m3u8DL-RE", "ffmpeg", "ffprobe"])
  if (!windows) await chmod(join(root, name), 0o755);
await writeFile(
  join(root, "tools.lock.json"),
  JSON.stringify(
    { platform: process.platform, arch: process.arch, receipts },
    null,
    2,
  ),
);
console.log("Tools ready; receipts written to resources/tools/tools.lock.json");
