import {
  mkdir,
  writeFile,
  copyFile,
  readdir,
  readFile,
} from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { execFileSync } from "node:child_process";
const root = resolve("resources/tools/licenses");
await mkdir(root, { recursive: true });
const sources = [
  [
    "N_m3u8DL-RE-MIT.txt",
    "https://raw.githubusercontent.com/nilaoda/N_m3u8DL-RE/v0.6.0-beta/LICENSE",
  ],
  [
    "yt-dlp-source-Unlicense.txt",
    "https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.08.19/LICENSE",
  ],
];
for (const [name, url] of sources) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`License request failed: ${response.status} ${url}`);
  await writeFile(join(root, name), await response.text());
}
const directories = execFileSync(
  process.execPath,
  [process.env.npm_execpath, "ls", "--omit=dev", "--all", "--parseable"],
  { encoding: "utf8", windowsHide: true },
)
  .trim()
  .split(/\r?\n/)
  .slice(1);
for (const directory of new Set(directories)) {
  const pkg = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  );
  const prefix = pkg.name.replace(/[\/@]/g, "_") + "-" + pkg.version;
  for (const file of await readdir(directory))
    if (/^(LICEN[CS]E|COPYING|NOTICE)(\.|$)/i.test(file))
      await copyFile(
        join(directory, file),
        join(root, prefix + "-" + basename(file)),
      );
}
await copyFile("LICENSE", join(root, "Vidown-MIT.txt"));
await writeFile(
  join(root, "SOURCE-REFERENCES.json"),
  JSON.stringify(
    {
      licenseSources: sources,
      notice:
        "Public release builds include platform-specific corresponding-source archives, build recipes, dependency inventories and hashes in the persistent materials release linked from the application release. Local upstream-binary builds are not public release artifacts.",
    },
    null,
    2,
  ),
);
console.log("Pinned license texts and installed component notices prepared.");
