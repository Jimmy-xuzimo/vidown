import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
const root = resolve(".");
const destination = resolve("docs/validation");
await mkdir(destination, { recursive: true });
function portable(value) {
  if (typeof value === "string" && value.startsWith(root))
    return relative(root, value).replaceAll("\\", "/");
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, portable(item)]),
    );
  return value;
}
for (const [name, source] of [
  ["controlled-media", "work/media-verification/report.json"],
  ["windows-packaged", "work/packaged-verification/report.json"],
  ["bilibili-preservation", "work/platform-verification/preservation.json"],
  ["tools-windows-x64", "resources/tools/tools.lock.json"],
]) {
  const data = JSON.parse(await readFile(source, "utf8"));
  await writeFile(
    join(destination, name + ".json"),
    JSON.stringify(portable(data), null, 2) + "\n",
  );
}
const { asset } = JSON.parse(
  await readFile("work/platform-verification/formats.json", "utf8"),
);
await writeFile(
  join(destination, "bilibili-formats.json"),
  JSON.stringify(
    {
      page: asset.pageUrl,
      title: asset.title,
      duration: asset.duration,
      tracks: asset.tracks.map(({ id, ...track }) => track),
      warnings: asset.warnings,
    },
    null,
    2,
  ) + "\n",
);
await mkdir("docs/images", { recursive: true });
await copyFile(
  "work/packaged-verification/01-workbench.png",
  "docs/images/workbench.png",
);
console.log(
  "Only selected, public metadata reports and the clean fixture workbench screenshot were collected; no profile, signed URL or source media copied.",
);
