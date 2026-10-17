import { readdir, readFile, writeFile } from "node:fs/promises";
import { selectReleaseAssets, publicChecksums } from "./release-assets.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import assert from "node:assert/strict";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const tag = process.env.RELEASE_TAG;
assert.equal(tag, `v${version}`);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const root = "release/publish";
const files = await readdir(root);
const groups = selectReleaseAssets(files, version);
for (const platform of [
  "Windows-x64",
  "macOS-arm64",
  "macOS-x64",
  "Linux-x64",
  "Linux-arm64",
]) {
  const report = JSON.parse(
    await readFile(
      join(root, `Vidown-${version}-${platform}-verification.json`),
      "utf8",
    ),
  );
  assert.equal(report.commit, commit, `Untested source commit in ${platform}`);
  assert.equal(report.version, version);
  const sums = await readFile(
    join(root, `Vidown-${version}-${platform}-SHA256SUMS.txt`),
    "utf8",
  );
  for (const line of sums.trim().split("\n")) {
    const [expected, file] = line.split("  ");
    assert(file && !file.includes("/") && !file.includes("\\"));
    assert.equal(
      createHash("sha256")
        .update(await readFile(join(root, file)))
        .digest("hex"),
      expected,
      `Corrupt release file: ${file}`,
    );
  }
}
const gh = (...args) => execFileSync("gh", args, { stdio: "inherit" });
const materialsTag = `${tag}-materials`;
const materialsUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${materialsTag}`;
const commitEndpoint = `repos/${process.env.GITHUB_REPOSITORY}/commits/${tag}`;
try {
  execFileSync(
    "gh",
    ["api", `repos/${process.env.GITHUB_REPOSITORY}/git/ref/tags/${tag}`],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
} catch (error) {
  if (!error.stderr?.toString().includes("HTTP 404")) throw error;
  // Create only after every native build, report and checksum has passed. The
  // workflow's GITHUB_TOKEN does not recursively trigger another tag workflow.
  gh(
    "api",
    `repos/${process.env.GITHUB_REPOSITORY}/git/refs`,
    "--method",
    "POST",
    "-f",
    `ref=refs/tags/${tag}`,
    "-f",
    `sha=${commit}`,
  );
}
const target = JSON.parse(
  execFileSync("gh", ["api", commitEndpoint], { encoding: "utf8" }),
);
assert.equal(
  target.sha,
  commit,
  "Release tag does not identify the tested source commit",
);
// Keep build verification above intact, then publish only public-format checksums.
for (const file of groups.materials.filter((file) =>
  file.endsWith("-SHA256SUMS.txt"),
)) {
  await writeFile(
    join(root, file),
    publicChecksums(await readFile(join(root, file), "utf8"), groups),
  );
}
try {
  execFileSync("gh", ["release", "view", materialsTag], { stdio: "pipe" });
} catch {
  gh(
    "release",
    "create",
    materialsTag,
    "--target",
    commit,
    "--latest=false",
    "--prerelease",
    "--title",
    `Vidown ${version} — source and verification materials`,
    "--notes",
    `Corresponding third-party sources, build recipes, verification reports and checksums for ${tag}. Application source commit: ${commit}. Application downloads: https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${tag}`,
  );
}
const materialsTarget = JSON.parse(
  execFileSync(
    "gh",
    ["api", `repos/${process.env.GITHUB_REPOSITORY}/commits/${materialsTag}`],
    { encoding: "utf8" },
  ),
);
assert.equal(
  materialsTarget.sha,
  commit,
  "Materials tag must identify tested source",
);
gh(
  "release",
  "upload",
  materialsTag,
  ...groups.materials.map((file) => join(root, file)),
  "--clobber",
);
gh(
  "release",
  "edit",
  materialsTag,
  "--draft=false",
  "--prerelease",
  "--latest=false",
);
const publishedMaterials = JSON.parse(
  execFileSync("gh", ["release", "view", materialsTag, "--json", "assets"], {
    encoding: "utf8",
  }),
);
for (const file of groups.materials) {
  const asset = publishedMaterials.assets.find((asset) => asset.name === file);
  assert.equal(
    asset?.digest,
    `sha256:${createHash("sha256")
      .update(await readFile(join(root, file)))
      .digest("hex")}`,
    `Materials upload mismatch: ${file}`,
  );
}
assert(
  (await readFile("docs/RELEASE_NOTES.md", "utf8")).includes(materialsUrl),
  "Release notes must link to corresponding source materials",
);
let exists = false;
try {
  execFileSync("gh", ["release", "view", tag], { stdio: "pipe" });
  exists = true;
} catch {}
if (!exists)
  gh(
    "release",
    "create",
    tag,
    "--verify-tag",
    "--draft",
    "--title",
    `Vidown ${version}`,
    "--notes-file",
    "docs/RELEASE_NOTES.md",
  );
gh(
  "release",
  "upload",
  tag,
  ...groups.installers.map((file) => join(root, file)),
  "--clobber",
);
gh(
  "release",
  "edit",
  tag,
  "--draft=false",
  "--latest",
  "--notes-file",
  "docs/RELEASE_NOTES.md",
);
const published = JSON.parse(
  execFileSync("gh", ["release", "view", tag, "--json", "assets"], {
    encoding: "utf8",
  }),
);
for (const file of groups.installers) {
  assert.equal(
    published.assets.find((asset) => asset.name === file)?.digest,
    `sha256:${createHash("sha256")
      .update(await readFile(join(root, file)))
      .digest("hex")}`,
    `Installer upload mismatch: ${file}`,
  );
}
// Re-publishing an older layout also removes only known redundant attachments,
// after the linked corresponding sources and installer digests have been verified.
for (const asset of published.assets) {
  if (
    groups.materials.includes(asset.name) ||
    groups.internal.includes(asset.name)
  )
    gh("release", "delete-asset", tag, asset.name, "--yes");
}
