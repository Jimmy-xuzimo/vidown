import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { selectReleaseAssets, publicChecksums } from "./release-assets.mjs";

// Move existing, already verified release bytes without rebuilding the application.
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const tag = process.env.RELEASE_TAG;
assert.equal(tag, `v${version}`);
const repo = process.env.GITHUB_REPOSITORY;
assert(repo);
const gh = (...args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const api = (path) => JSON.parse(gh("api", `repos/${repo}/${path}`));
const original = api(`releases/tags/${tag}`);
assert(!original.draft && !original.prerelease);
const groups = selectReleaseAssets(
  original.assets.map((asset) => asset.name),
  version,
);
const commit = api(`commits/${tag}`).sha;
const root = "work/release-materials";
await mkdir(root, { recursive: true });
gh(
  "release",
  "download",
  tag,
  "--pattern",
  "*-sources.tar.gz",
  "--pattern",
  "*-verification.json",
  "--pattern",
  "*-SHA256SUMS.txt",
  "--dir",
  root,
  "--clobber",
);
for (const name of groups.materials) {
  const bytes = await readFile(join(root, name));
  const originalAsset = original.assets.find((asset) => asset.name === name);
  assert.equal(bytes.length, originalAsset.size);
  assert.equal(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    originalAsset.digest,
  );
  if (name.endsWith("-verification.json")) {
    const report = JSON.parse(bytes);
    assert.equal(report.commit, commit);
    assert.equal(report.version, version);
  }
  if (name.endsWith("-SHA256SUMS.txt")) {
    for (const line of bytes.toString().trim().split("\n")) {
      const [hash, file] = line.trimEnd().split("  ");
      assert.equal(
        original.assets.find((asset) => asset.name === file)?.digest,
        `sha256:${hash}`,
      );
    }
    await writeFile(
      join(root, name),
      publicChecksums(bytes.toString(), groups),
    );
  }
}
const materialsTag = `${tag}-materials`;
const materialsUrl = `https://github.com/${repo}/releases/tag/${materialsTag}`;
const notes = await readFile("docs/RELEASE_NOTES.md", "utf8");
assert(notes.includes(materialsUrl));
let exists = false;
try {
  api(`git/ref/tags/${materialsTag}`);
} catch (error) {
  if (!error.stderr?.toString().includes("HTTP 404")) throw error;
  gh(
    "api",
    `repos/${repo}/git/refs`,
    "--method",
    "POST",
    "-f",
    `ref=refs/tags/${materialsTag}`,
    "-f",
    `sha=${commit}`,
  );
}
try {
  api(`releases/tags/${materialsTag}`);
  exists = true;
} catch {}
if (!exists)
  gh(
    "release",
    "create",
    materialsTag,
    "--verify-tag",
    "--prerelease",
    "--latest=false",
    "--title",
    `Vidown ${version} — source and verification materials`,
    "--notes",
    `Corresponding third-party sources, build recipes, verification reports and checksums for ${tag}. Application source commit: ${commit}. Application downloads: https://github.com/${repo}/releases/tag/${tag}`,
  );
assert.equal(api(`commits/${materialsTag}`).sha, commit);
gh(
  "release",
  "upload",
  materialsTag,
  ...groups.materials.map((name) => join(root, name)),
  "--clobber",
);
gh("release", "edit", materialsTag, "--prerelease", "--latest=false");
const materials = api(`releases/tags/${materialsTag}`);
for (const name of groups.materials) {
  const expected = `sha256:${createHash("sha256")
    .update(await readFile(join(root, name)))
    .digest("hex")}`;
  assert.equal(
    materials.assets.find((asset) => asset.name === name)?.digest,
    expected,
  );
}
console.log(
  "All 15 material uploads verified; updating main release and removing redundant assets.",
);
// Establish the source link before deleting any old public corresponding source.
gh("release", "edit", tag, "--latest", "--notes-file", "docs/RELEASE_NOTES.md");
for (const asset of original.assets) {
  if (
    groups.materials.includes(asset.name) ||
    groups.internal.includes(asset.name)
  )
    gh(
      "api",
      `repos/${repo}/releases/assets/${asset.id}`,
      "--method",
      "DELETE",
    );
}
const final = api(`releases/tags/${tag}`);
assert.deepEqual(
  final.assets.map((asset) => asset.name).sort(),
  [...groups.installers].sort(),
);
for (const asset of final.assets)
  assert.equal(
    asset.digest,
    original.assets.find((previous) => previous.name === asset.name)?.digest,
  );
assert.equal(api("releases/latest").tag_name, tag);
assert.equal(api(`commits/${tag}`).sha, commit);
console.log(
  JSON.stringify(
    {
      tag,
      installers: final.assets.map((asset) => asset.name),
      materialsUrl,
      commit,
    },
    null,
    2,
  ),
);
