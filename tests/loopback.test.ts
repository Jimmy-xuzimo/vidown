import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import { listenLoopback } from "../src/core/loopback";

describe("local media listener", () => {
  it("skips Windows excluded ports and occupied ports before binding successfully", async () => {
    let attempts = 0;
    const server = Object.assign(new EventEmitter(), {
      listen() {
        const code = ["EACCES", "EADDRINUSE"][attempts++];
        queueMicrotask(() =>
          code
            ? server.emit(
                "error",
                Object.assign(new Error("Controlled bind failure"), { code }),
              )
            : server.emit("listening"),
        );
      },
    });
    await listenLoopback(server as unknown as Server);
    expect(attempts).toBe(3);
    expect(server.listenerCount("error")).toBe(0);
    expect(server.listenerCount("listening")).toBe(0);
  });
  it("binds independent browser-fetchable listeners only on loopback", async () => {
    const servers = Array.from({ length: 8 }, () =>
      createServer((_req, res) => res.end("controlled-media")),
    );
    try {
      await Promise.all(servers.map(listenLoopback));
      const addresses = servers.map((server) => {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("Missing address");
        expect(address.address).toBe("127.0.0.1");
        expect(address.port).toBeGreaterThanOrEqual(49152);
        return address;
      });
      expect(new Set(addresses.map((a) => a.port)).size).toBe(8);
      expect(
        await Promise.all(
          addresses.map(async (a) =>
            (await fetch(`http://127.0.0.1:${a.port}`)).text(),
          ),
        ),
      ).toEqual(Array(8).fill("controlled-media"));
    } finally {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.closeAllConnections();
              server.close(() => resolve());
            }),
        ),
      );
    }
  });
});
