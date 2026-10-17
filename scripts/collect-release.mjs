import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const platform = { win32: "Windows", darwin: "macOS", linux: "Linux" }[
  process.platform
];
const suffix = `${platform}-${process.arch}`;
const publish = resolve("release/publish");
await mkdir(publish, { recursive: true });
const sources = resolve("work/corresponding-source");
for (const file of [
  "ffmpeg-revision.txt",
  "x264-revision.txt",
  "extractor-build.json",
  "config.log",
])
  assert(
    (await readFile(join(sources, file))).length > 0,
    `Missing source/build material: ${file}`,
  );
await copyFile(
  "THIRD_PARTY_NOTICES.md",
  join(sources, "THIRD_PARTY_NOTICES.md"),
);
await copyFile("docs/BUILDING.md", join(sources, "BUILDING.md"));
const sourceArchive = `Vidown-${version}-${suffix}-sources.tar.gz`;
execFileSync(
  "tar",
  ["-czf", join(publish, sourceArchive), "-C", sources, "."],
  { stdio: "inherit", windowsHide: true },
);

const evidence = {
  generatedAt: new Date().toISOString(),
  version,
  platform,
  arch: process.arch,
  commit: process.env.GITHUB_SHA,
  run: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  signing:
    process.platform === "darwin"
      ? "ad-hoc; no Developer ID or notarization"
      : "unsigned",
  realAccountAcceptance:
    "pending; controlled CI is not real premium/private account acceptance",
  suites: {},
  tools: JSON.parse(await readFile("resources/tools/tools.lock.json", "utf8")),
};
for (const suite of [
  "media-verification",
  "protocol-edge-verification",
  "mirror-verification",
  "packaged-verification",
  ...(process.platform === "win32"
    ? ["webview2-verification", "portable-release-verification"]
    : []),
]) {
  const data = JSON.parse(
    await readFile(join("work", suite, "report.json"), "utf8"),
  );
  if (suite === "mirror-verification") {
    assert.equal(data.status, "passed");
    assert.equal(data.checks.length, 6);
  } else {
    assert(data.results?.length > 0, `Empty test suite: ${suite}`);
    assert(
      data.results.every(
        (r) => r.status === "passed" || r.status === "pending",
      ),
      `Failed suite: ${suite}`,
    );
    if (suite !== "media-verification")
      assert(
        data.results.every((r) => r.status === "passed"),
        `Incomplete suite: ${suite}`,
      );
    else
      assert(
        data.results.filter((r) => r.status === "passed").length >= 11,
        "Missing controlled media/extractor checks",
      );
  }
  evidence.suites[suite] = data;
}
await writeFile(
  join(publish, `Vidown-${version}-${suffix}-verification.json`),
  JSON.stringify(evidence, null, 2),
);
const extensions =
  process.platform === "win32"
    ? [".exe"]
    : process.platform === "darwin"
      ? [".dmg", ".zip"]
      : [".AppImage", ".deb", ".tar.gz"];
const installers = (await readdir("release")).filter(
  (n) => n.startsWith("Vidown-") && extensions.some((ext) => n.endsWith(ext)),
);
assert.equal(
  installers.length,
  process.platform === "linux" ? 3 : 2,
  "Missing/unexpected installer formats",
);
for (const file of installers)
  await copyFile(join("release", file), join(publish, file));
const files = await readdir(publish);
const sums = [];
for (const file of files.sort())
  sums.push(
    `${createHash("sha256")
      .update(await readFile(join(publish, file)))
      .digest("hex")}  ${file}`,
  );
await writeFile(
  join(publish, `Vidown-${version}-${suffix}-SHA256SUMS.txt`),
  sums.join("\n") + "\n",
);
console.log(
  JSON.stringify({ version, platform, arch: process.arch, files }, null, 2),
);
