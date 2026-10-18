/** Serialized into the page. Read public hydration data only; never read credentials or app internals. */
export function douyinPageData(): unknown[] {
  const values: unknown[] = [];
  for (const id of ["RENDER_DATA", "__NEXT_DATA__"]) {
    const text = document.getElementById(id)?.textContent;
    if (!text || text.length > 4 * 1024 * 1024) continue;
    try {
      values.push(
        JSON.parse(text.startsWith("%") ? decodeURIComponent(text) : text),
      );
    } catch {
      /* Network discovery can still provide data. */
    }
  }
  return values;
}
