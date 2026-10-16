import { createHash } from "node:crypto";
export function httpUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("仅支持不含账号密码的 HTTP／HTTPS 链接");
  if (value.length > 16384) throw new Error("链接过长");
  return url.href;
}
export function publicUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return "[invalid URL]";
  }
}
export function redact(value: unknown): string {
  return String(value)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (u) => publicUrl(u))
    .replace(
      /\b(cookie|authorization|api_hash|password|token|SESSDATA)\s*[:=]\s*[^\r\n]+/gi,
      "$1=[redacted]",
    );
}
export function safeName(value: string): string {
  const clean = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  return !clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)
    ? `video_${clean}`
    : clean;
}
export function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
export function classifyError(error: unknown): string {
  const text = redact(error instanceof Error ? error.message : error);
  if (/DRM|Widevine|PlayReady|FairPlay|ContentProtection/i.test(text))
    return `检测到受保护媒体：${text.slice(-700)}`;
  if (/429|too many requests|FLOOD_WAIT/i.test(text))
    return "平台限流，请稍后重试或降低并发。";
  if (/401|403|login|sign in|premium|会员|登录/i.test(text))
    return `登录、权限或链接有效期检查失败，请在浏览器登录并重新探测。${text.slice(-500)}`;
  if (/ENOSPC|disk.*full/i.test(text)) return "磁盘空间不足，请清理后重试。";
  return text.slice(-1400);
}
