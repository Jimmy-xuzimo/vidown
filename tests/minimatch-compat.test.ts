import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const legacy = require("@vidown/minimatch-compat");
it("delegates legacy matching and defaults to patched upstream", () => {
  expect(legacy("src/main.ts", "**/*.{ts,js}")).toBe(true);
  expect(legacy(".hidden", "*")).toBe(false);
  expect(legacy.defaults({ dot: true })(".hidden", "*")).toBe(true);
  expect(new legacy.Minimatch("**/*.ts").match("src/main.ts")).toBe(true);
  expect(legacy.match(["x.js", "y.ts"], "*.ts")).toEqual(["y.ts"]);
});
it("uses the adapter through actual glob, directory comparison and ASAR packaging", async () => {
  const work = await mkdtemp(join(tmpdir(), "vidown-packaging-"));
  try {
    const source = join(work, "source"),
      other = join(work, "other");
    for (const dir of [source, other]) {
      await mkdir(join(dir, "nested"), { recursive: true });
      await writeFile(join(dir, "nested", "entry.js"), "module.exports=42;");
    }
    const builderRequire = createRequire(require.resolve("app-builder-lib"));
    const asar = builderRequire("@electron/asar");
    const asarRequire = createRequire(builderRequire.resolve("@electron/asar"));
    const glob = asarRequire("glob");
    expect(glob.sync("**/*.js", { cwd: source })).toEqual(["nested/entry.js"]);
    const universalRequire = createRequire(
      builderRequire.resolve("@electron/universal"),
    );
    const compare = await universalRequire("dir-compare").compare(
      source,
      other,
      { compareContent: true, includeFilter: "*.js" },
    );
    expect(compare.same).toBe(true);
    const archive = join(work, "app.asar");
    await asar.createPackageWithOptions(source, archive, {
      unpack: "**/*.node",
    });
    expect(asar.extractFile(archive, "nested/entry.js").toString()).toBe(
      "module.exports=42;",
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
