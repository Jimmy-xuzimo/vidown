import { afterEach, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Session, Cookie } from "electron";
import { SessionKeeper } from "../src/main/session";

afterEach(() => vi.useRealTimers());
function fixture(entries: any[], native: Cookie[] = []) {
  let sealed: string | undefined = "encrypted";
  let backup = entries;
  let rows = [...native];
  const cookies = Object.assign(new EventEmitter(), {
    get: async () => rows,
    set: vi.fn(async (value: any) => {
      rows.push({
        ...value,
        domain: value.domain ?? new URL(value.url).hostname,
        hostOnly: !value.domain,
        session: true,
      });
    }),
    flushStore: async () => {},
  });
  const keeper = new SessionKeeper(
    {
      cookies,
      flushStorageData: () => {},
      clearStorageData: async () => {
        rows = [];
      },
    } as unknown as Session,
    () => sealed,
    (value) => {
      sealed = value;
    },
    (value) => {
      backup = value as any[];
      return "encrypted";
    },
    () => backup,
  );
  return { keeper, cookies, backup: () => backup, sealed: () => sealed };
}
const savedCookie = {
  url: "https://example.com/",
  name: "login",
  value: "old",
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
};
it("does not restore an expired session-cookie backup", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const f = fixture([{ cookie: savedCookie, until: 90000 }]);
  await f.keeper.restore();
  expect(f.cookies.set).not.toHaveBeenCalled();
  await f.keeper.close();
  expect(f.sealed()).toBeUndefined();
});
it("keeps a newer native cookie instead of overwriting it with an older backup", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const current = {
    ...savedCookie,
    value: "new",
    domain: "example.com",
    session: false,
  } as Cookie;
  const f = fixture([{ cookie: savedCookie, until: 200000 }], [current]);
  await f.keeper.restore();
  expect(f.cookies.set).not.toHaveBeenCalled();
  await f.keeper.close();
  expect(f.sealed()).toBeUndefined();
});
it("does not extend the backup lifetime when the same native session cookie survives restart", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const current = {
    ...savedCookie,
    domain: "example.com",
    session: true,
  } as Cookie;
  const f = fixture([{ cookie: savedCookie, until: 200000 }], [current]);
  await f.keeper.restore();
  await f.keeper.flush();
  expect(f.backup()[0].until).toBe(200000);
  vi.setSystemTime(300000);
  await f.keeper.flush();
  expect(f.sealed()).toBeUndefined();
  await f.keeper.close();
  expect(f.sealed()).toBeUndefined();
});
