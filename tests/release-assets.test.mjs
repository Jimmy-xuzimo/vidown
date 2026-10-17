import { describe, it, expect } from "vitest";
import {
  releaseAssets,
  selectReleaseAssets,
  publicChecksums,
} from "../scripts/release-assets.mjs";

describe("public release downloads", () => {
  const groups = releaseAssets("1.0.4");
  it("keeps five application downloads and preserves all corresponding sources separately", () => {
    expect(groups.installers).toHaveLength(5);
    expect(groups.materials).toHaveLength(15);
    expect(
      groups.materials.filter((f) => f.endsWith("-sources.tar.gz")),
    ).toHaveLength(5);
    expect(new Set(Object.values(groups).flat()).size).toBe(27);
    expect(selectReleaseAssets(Object.values(groups).flat(), "1.0.4")).toEqual(
      groups,
    );
    expect(
      groups.installers.every((f) => /\.(exe|dmg|AppImage|deb)$/.test(f)),
    ).toBe(true);
  });
  it("fails closed on missing sources or unrecognized files", () => {
    const files = Object.values(groups).flat();
    expect(() =>
      selectReleaseAssets(
        files.filter((f) => f !== groups.materials[0]),
        "1.0.4",
      ),
    ).toThrow("Missing release file");
    expect(() =>
      selectReleaseAssets([...files, "unverified.exe"], "1.0.4"),
    ).toThrow("Unexpected release file");
  });
  it("retains source checksums while dropping unpublished alternate application archives", () => {
    const files = Object.values(groups).flat();
    const sums = files.map((f) => `${"a".repeat(64)}  ${f}`).join("\n") + "\n";
    const filtered = publicChecksums(sums, groups);
    for (const file of [...groups.installers, ...groups.materials])
      expect(filtered).toContain(`  ${file}\n`);
    for (const file of groups.internal)
      expect(filtered).not.toContain(`  ${file}\n`);
  });
});
