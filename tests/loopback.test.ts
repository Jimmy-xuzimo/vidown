import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { listenLoopback } from "../src/core/loopback";

describe("local media listener", () => {
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
