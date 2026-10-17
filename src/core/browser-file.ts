import { stat } from "node:fs/promises";
import { mediaInfo, type Tools } from "./engine";
import { command } from "./process";

export async function verifyBrowserFile(
  path: string,
  tools: Tools,
  signal: AbortSignal,
): Promise<void> {
  const file = await stat(path);
  if (!file.size) throw new Error("网页保存了空文件，请回到消息中重试");
  const info = await mediaInfo(path, tools, signal);
  if (
    !info.streams?.some((s: any) => ["audio", "video"].includes(s.codec_type))
  )
    throw new Error("网页下载的文件不是可识别的视频或音频");
  const duration = Number(info.format?.duration);
  if (!(duration > 0) || !Number.isFinite(duration))
    throw new Error("无法确认网页媒体时长，文件未标记成功");
  for (const offset of new Set([0, Math.max(0, duration - 2)]))
    await command(
      tools.ffmpeg,
      [
        "-v",
        "error",
        "-xerror",
        "-ss",
        String(offset),
        "-i",
        path,
        "-t",
        "2",
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-f",
        "null",
        "-",
      ],
      { signal, timeout: 60000 },
    );
}
