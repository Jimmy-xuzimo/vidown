import { readdir, readFile } from "node:fs/promises";
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
const target = JSON.parse(
  execFileSync(
    "gh",
    ["api", `repos/${process.env.GITHUB_REPOSITORY}/commits/${tag}`],
    { encoding: "utf8" },
  ),
);
assert.equal(
  target.sha,
  commit,
  "Release tag does not identify the tested source commit",
);
const root = "release/publish";
const files = await readdir(root);
for (const platform of [
  "Windows-x64",
  "macOS-arm64",
  "macOS-x64",
  "Linux-x64",
  "Linux-arm64",
]) {
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
  ...files.map((file) => join(root, file)),
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
