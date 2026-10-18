export function isDouyinPage(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      /^https?:$/.test(u.protocol) &&
      !u.username &&
      !u.password &&
      [
        "www.douyin.com",
        "douyin.com",
        "v.douyin.com",
        "www.iesdouyin.com",
        "iesdouyin.com",
      ].includes(u.hostname)
    );
  } catch {
    return false;
  }
}

export function douyinVideoId(value: string): string | undefined {
  if (!isDouyinPage(value)) return;
  const u = new URL(value);
  const id =
    u.pathname.match(/^\/(?:share\/)?video\/(\d+)(?:\/|$)/)?.[1] ??
    u.searchParams.get("modal_id") ??
    u.searchParams.get("vid");
  return id && /^\d{8,24}$/.test(id) ? id : undefined;
}

export function isDouyinDetailResponse(value: string): boolean {
  if (!isDouyinPage(value)) return false;
  const u = new URL(value);
  return (
    ["www.douyin.com", "douyin.com"].includes(u.hostname) &&
    /^\/aweme\/v\d+\/web\/(?:aweme\/(?:detail|post)|tab\/feed|feed)\//.test(
      u.pathname,
    )
  );
}

export function douyinVideoUrl(id: string): string {
  if (!/^\d{8,24}$/.test(id)) throw new Error("无效的视频编号");
  return `https://www.douyin.com/video/${id}`;
}
