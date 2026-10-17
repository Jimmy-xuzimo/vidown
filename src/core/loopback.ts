import type { Server } from "node:http";
import { randomInt } from "node:crypto";

// Windows can allocate low ephemeral ports that Fetch/Chromium prohibit (e.g. 6000).
// Bind directly in the private range, retrying collisions without a reservation race.
export async function listenLoopback(server: Server): Promise<void> {
  for (let attempt = 0; attempt < 32; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          server.off("error", failed);
          resolve();
        };
        const failed = (error: Error) => {
          server.off("listening", ready);
          reject(error);
        };
        server.once("error", failed);
        server.once("listening", ready);
        server.listen({
          host: "127.0.0.1",
          port: randomInt(49152, 65535),
          exclusive: true,
        });
      });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("无法分配本地媒体传输端口，请稍后重试。");
}
