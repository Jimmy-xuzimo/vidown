// Browser-style address completion; never reinterpret an explicit non-web scheme.
export function completeAddress(value: string): string {
  const text = value.trim();
  if (!text || /\s/.test(text)) throw new Error("请输入有效的网址");
  const explicit = /^https?:\/\//i.test(text);
  if (
    !explicit &&
    /^[a-z][a-z\d+.-]*:/i.test(text) &&
    !/^[^/:]+:\d+(?:[/?#]|$)/.test(text)
  )
    throw new Error("仅支持 HTTP 或 HTTPS 网页地址");
  const local =
    /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(text);
  const url = new URL(
    explicit ? text : `${local ? "http" : "https"}://${text}`,
  );
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("请输入不含账号密码的 HTTP 或 HTTPS 网页地址");
  return url.href;
}
