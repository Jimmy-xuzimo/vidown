export function isTelegramWeb(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      /^https?:$/.test(u.protocol) &&
      !u.username &&
      !u.password &&
      ["web.telegram.org", "webk.telegram.org", "weba.telegram.org"].includes(
        u.hostname,
      )
    );
  } catch {
    return false;
  }
}

export function isTelegramLink(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (
      /^https?:$/.test(u.protocol) &&
      !u.username &&
      !u.password &&
      (["t.me", "telegram.me"].includes(u.hostname) || isTelegramWeb(value))
    );
  } catch {
    return false;
  }
}

export function telegramWebUrl(value?: string, existing?: string): string {
  if (!value) return "https://web.telegram.org/a/";
  if (!isTelegramLink(value)) throw new Error("请输入 Telegram 网页或消息链接");
  const u = new URL(value.trim());
  if (isTelegramWeb(value)) {
    u.protocol = "https:";
    return u.href;
  }
  // Use the existing client and origin: Web A and K do not share account storage.
  const target = new URL(
    existing && isTelegramWeb(existing)
      ? existing
      : "https://web.telegram.org/a/",
  );
  target.search = "";
  target.hash =
    (target.hostname === "webk.telegram.org" || target.pathname.startsWith("/k")
      ? "?tgaddr="
      : "tgaddr=") + encodeURIComponent(u.href);
  return target.href;
}

export function telegramMessageId(value: string): string {
  if (!isTelegramLink(value)) throw new Error("无效 Telegram 消息链接");
  const u = new URL(value);
  if (isTelegramWeb(value)) {
    const deep = new URLSearchParams(u.hash.slice(1).replace(/^\?/, "")).get(
      "tgaddr",
    );
    if (deep) return telegramMessageId(deep);
    throw new Error("请粘贴 Telegram 消息的 t.me 链接，以准确定位媒体");
  }
  const match =
    /^\/(?:s\/)?(?:c\/\d+|[a-zA-Z0-9_]+)\/(?:\d+\/)?([1-9]\d*)\/?$/.exec(
      u.pathname,
    );
  if (!match)
    throw new Error("请粘贴具体 Telegram 消息链接，不是频道首页或邀请链接");
  return match[1];
}
