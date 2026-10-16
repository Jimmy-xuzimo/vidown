import {
  mkdir,
  writeFile,
  copyFile,
  readdir,
  readFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
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
  [
    "TDLib-Boost-1.0.txt",
    "https://raw.githubusercontent.com/tdlib/td/d1085f9cebc5a62379991ae1652673954f229c1f/LICENSE_1_0.txt",
  ],
];
for (const [name, url] of sources) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`License request failed: ${response.status} ${url}`);
  await writeFile(join(root, name), await response.text());
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
for (const name of [
  ...Object.keys(pkg.dependencies),
  "@prebuilt-tdlib/win32-x64",
]) {
  const directory = resolve("node_modules", name);
  for (const file of await readdir(directory))
    if (/^(LICEN[CS]E|COPYING|NOTICE)(\.|$)/i.test(file))
      await copyFile(
        join(directory, file),
        join(root, name.replace(/[\/@]/g, "_") + "-" + file),
      );
}
await copyFile("LICENSE", join(root, "Vidown-MIT.txt"));
await writeFile(
  join(root, "SOURCE-REFERENCES.json"),
  JSON.stringify(
    {
      licenseSources: sources,
      notice:
        "This is a local experimental preview. Complete corresponding-source and native dependency notices remain a public binary release gate.",
    },
    null,
    2,
  ),
);
console.log("Pinned license texts and installed component notices prepared.");
