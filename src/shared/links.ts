import { completeAddress } from "./address";

export function mediaLinks(input: string): string[] {
  const found = input.match(/https?:\/\/[^\s<>"，。；！？）》】」』]+/gi);
  const values =
    found ??
    input
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
  if (!values.length || values.length > 50)
    throw new Error("请提供 1–50 个媒体链接，每行一个。");
  return [
    ...new Set(
      values.map((value) => {
        let clean = value.trim();
        for (const [end, start] of [
          [")", "("],
          ["]", "["],
          ["}", "{"],
        ])
          while (
            clean.endsWith(end) &&
            clean.split(end).length > clean.split(start).length
          )
            clean = clean.slice(0, -1);
        const url = new URL(completeAddress(clean));
        if (!/^https?:$/.test(url.protocol) || url.username || url.password)
          throw new Error("仅支持不含账号密码的 HTTP／HTTPS 链接");
        if (url.href.length > 16384) throw new Error("链接过长");
        return url.href;
      }),
    ),
  ];
}
