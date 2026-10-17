export function isTelegramLink(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (
      /^https?:$/.test(u.protocol) &&
      !u.username &&
      !u.password &&
      ["t.me", "telegram.me", "web.telegram.org"].includes(u.hostname)
    );
  } catch {
    return false;
  }
}

export function telegramWebUrl(value?: string): string {
  if (!value) return "https://web.telegram.org/a/";
  if (!isTelegramLink(value)) throw new Error("请输入 Telegram 网页或消息链接");
  const u = new URL(value.trim());
  if (u.hostname === "web.telegram.org") {
    u.protocol = "https:";
    return u.href;
  }
  // Web A's public tgaddr entry point parses message links itself, including private channel links.
  return "https://web.telegram.org/a/#tgaddr=" + encodeURIComponent(u.href);
}

export function telegramMessageId(value: string): string {
  if (!isTelegramLink(value)) throw new Error("无效 Telegram 消息链接");
  const u = new URL(value);
  if (u.hostname === "web.telegram.org") {
    const deep = new URLSearchParams(u.hash.slice(1)).get("tgaddr");
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
