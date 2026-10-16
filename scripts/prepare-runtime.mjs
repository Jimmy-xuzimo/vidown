import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
const dir = resolve("node_modules/electron");
const { version } = JSON.parse(
  await readFile(join(dir, "package.json"), "utf8"),
);
const filename = `electron-v${version}-${process.platform}-${process.arch}.zip`;
const checksums = JSON.parse(
  await readFile(join(dir, "checksums.json"), "utf8"),
);
const expected = checksums[filename];
if (!expected) throw new Error("No pinned runtime checksum");
const hash = (b) => createHash("sha256").update(b).digest("hex");
await mkdir("work", { recursive: true });
const archive = resolve("work", filename);
let bytes;
try {
  bytes = await readFile(archive);
} catch {}
if (!bytes || hash(bytes) !== expected) {
  console.log("Downloading pinned Electron runtime", version);
  execFileSync(
    process.platform === "win32" ? "curl.exe" : "curl",
    [
      "--fail",
      "--location",
      "--retry",
      "2",
      "--max-time",
      "600",
      "--silent",
      "--show-error",
      "--output",
      archive,
      `https://github.com/electron/electron/releases/download/v${version}/${filename}`,
    ],
    { windowsHide: true, stdio: "inherit" },
  );
  bytes = await readFile(archive);
  if (hash(bytes) !== expected) throw new Error("Runtime SHA-256 mismatch");
}
await mkdir(join(dir, "dist"), { recursive: true });
execFileSync("tar", ["-xf", archive, "-C", join(dir, "dist")], {
  windowsHide: true,
});
await writeFile(
  join(dir, "path.txt"),
  process.platform === "win32"
    ? "electron.exe"
    : process.platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron"
      : "electron",
);
console.log("Electron runtime verified and extracted");
