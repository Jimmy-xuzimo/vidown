import assert from "node:assert/strict";

export function releaseAssets(version) {
  const platforms = [
    "Windows-x64",
    "macOS-arm64",
    "macOS-x64",
    "Linux-x64",
    "Linux-arm64",
  ];
  return {
    installers: [
      `Vidown-Setup-${version}.exe`,
      ...["arm64", "x64"].map((arch) => `Vidown-${version}-macOS-${arch}.dmg`),
      ...["x86_64", "arm64"].map(
        (arch) => `Vidown-${version}-Linux-${arch}.AppImage`,
      ),
    ],
    materials: platforms.flatMap((platform) => [
      `Vidown-${version}-${platform}-sources.tar.gz`,
      `Vidown-${version}-${platform}-verification.json`,
      `Vidown-${version}-${platform}-SHA256SUMS.txt`,
    ]),
    internal: [
      `Vidown-Portable-${version}.exe`,
      ...["amd64", "arm64"].map(
        (arch) => `Vidown-${version}-Linux-${arch}.deb`,
      ),
      ...["arm64", "x64"].map((arch) => `Vidown-${version}-macOS-${arch}.zip`),
      ...["arm64", "x64"].map(
        (arch) => `Vidown-${version}-Linux-${arch}.tar.gz`,
      ),
    ],
  };
}

export function selectReleaseAssets(files, version) {
  const groups = releaseAssets(version);
  const known = Object.values(groups).flat();
  assert.equal(new Set(files).size, files.length, "Duplicate release files");
  for (const file of files)
    assert(known.includes(file), `Unexpected release file: ${file}`);
  for (const file of [...groups.installers, ...groups.materials])
    assert(files.includes(file), `Missing release file: ${file}`);
  return groups;
}

export function publicChecksums(sums, groups) {
  const allowed = new Set([...groups.installers, ...groups.materials]);
  return (
    sums
      .trim()
      .split("\n")
      .filter((line) => allowed.has(line.trimEnd().split("  ")[1]))
      .join("\n") + "\n"
  );
}
