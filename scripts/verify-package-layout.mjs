// Check actual release containers against the application directory, then make
// the desktop test execute the Linux AppImage/macOS ZIP payload itself.
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  stat,
  appendFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import assert from "node:assert/strict";
if (process.platform === "win32") process.exit(0); // verify-artifacts.ts covers NSIS.
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const root = resolve("work/package-layout");
const runRoot = join(root, randomUUID());
await mkdir(runRoot, { recursive: true });
const files = await readdir("release");
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const run = (program, args, cwd) =>
  execFileSync(program, args, { cwd, stdio: "pipe" });
async function find(directory, name, depth = 3) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.name === name) return file;
    if (entry.isDirectory() && depth > 0) {
      const match = await find(file, name, depth - 1);
      if (match) return match;
    }
  }
}
const results = [];
const tools = ["ffmpeg", "ffprobe", "yt-dlp", "N_m3u8DL-RE", "tools.lock.json"];
async function compare(candidate, expected, mac, format) {
  const names = mac
    ? [
        "Contents/MacOS/Vidown",
        "Contents/Resources/app.asar",
        ...tools.map((n) => `Contents/Resources/tools/${n}`),
      ]
    : [
        "vidown",
        "resources/app.asar",
        ...tools.map((n) => `resources/tools/${n}`),
      ];
  for (const name of names)
    assert.equal(
      await hash(join(candidate, name)),
      await hash(join(expected, name)),
      `${format}: changed payload ${name}`,
    );
  for (const name of [
    mac ? "Contents/MacOS/Vidown" : "vidown",
    ...tools
      .slice(0, 4)
      .map((n) =>
        mac ? `Contents/Resources/tools/${n}` : `resources/tools/${n}`,
      ),
  ])
    assert(
      (await stat(join(candidate, name))).mode & 0o111,
      `${format}: executable permission missing: ${name}`,
    );
  results.push({
    name: `${format}-payload-hashes-and-executable-permissions`,
    status: "passed",
    files: names.length,
  });
}
let executable;
if (process.platform === "darwin") {
  const expected = resolve(
    `release/${process.arch === "arm64" ? "mac-arm64" : "mac"}/Vidown.app`,
  );
  const zip = files.find(
    (f) => f === `Vidown-${version}-macOS-${process.arch}.zip`,
  );
  const dmg = files.find(
    (f) => f === `Vidown-${version}-macOS-${process.arch}.dmg`,
  );
  assert(zip && dmg);
  const extracted = join(runRoot, "zip");
  run("ditto", ["-x", "-k", resolve("release", zip), extracted]);
  const application = await find(extracted, "Vidown.app");
  assert(application);
  await compare(application, expected, true, "ZIP");
  const mounted = join(runRoot, "volume");
  await mkdir(mounted);
  let attached = false;
  try {
    run("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mounted,
      resolve("release", dmg),
    ]);
    attached = true;
    const application = await find(mounted, "Vidown.app");
    assert(application);
    await compare(application, expected, true, "DMG");
  } finally {
    if (attached) run("hdiutil", ["detach", mounted]);
  }
  executable = join(application, "Contents/MacOS/Vidown");
} else {
  const expected = resolve(
    `release/${process.arch === "arm64" ? "linux-arm64-unpacked" : "linux-unpacked"}`,
  );
  for (const format of ["AppImage", "deb", "tar.gz"]) {
    const file = `Vidown-${version}-Linux-${process.arch}.${format}`;
    assert(files.includes(file), `Missing ${file}`);
    const directory = join(runRoot, format);
    await mkdir(directory);
    if (format === "AppImage")
      run(resolve("release", file), ["--appimage-extract"], directory);
    else if (format === "deb")
      run("dpkg-deb", ["--extract", resolve("release", file), directory]);
    else run("tar", ["-xf", resolve("release", file), "-C", directory]);
    const asar = await find(directory, "app.asar", 7);
    assert(asar, `Missing application in ${format}`);
    const candidate = dirname(dirname(asar));
    await compare(candidate, expected, false, format);
    if (format === "AppImage") executable = join(candidate, "vidown");
  }
}
assert(executable);
if (process.env.GITHUB_ENV)
  await appendFile(
    process.env.GITHUB_ENV,
    `VIDOWN_VERIFY_EXECUTABLE=${executable}\n`,
  );
await writeFile(
  join(root, "report.json"),
  JSON.stringify(
    { generatedAt: new Date().toISOString(), version, results, executable },
    null,
    2,
  ),
);
console.log(JSON.stringify({ results, executable }, null, 2));
