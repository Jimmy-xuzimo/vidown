import { it, expect } from "vitest";
import {
  telegramWebUrl,
  telegramMessageId,
  isTelegramLink,
  isTelegramWeb,
} from "../src/shared/telegram";

it("preserves private message and topic links through the official web client's deep-link parameter", () => {
  for (const link of [
    "https://t.me/c/123456789/42",
    "https://t.me/channelname/100/42?single",
    "https://t.me/s/channelname/42",
  ]) {
    const web = new URL(telegramWebUrl(link));
    expect(web.origin).toBe("https://web.telegram.org");
    expect(new URLSearchParams(web.hash.slice(1)).get("tgaddr")).toBe(link);
    expect(telegramMessageId(link)).toBe("42");
  }
});
it("recognizes official alternate clients and keeps the logged-in client for message navigation", () => {
  for (const value of [
    "https://webk.telegram.org/",
    "https://weba.telegram.org/",
    "https://web.telegram.org/k/",
  ]) {
    expect(isTelegramWeb(value)).toBe(true);
    expect(isTelegramLink(value)).toBe(true);
    const next = telegramWebUrl("https://t.me/c/12345/42", value + "#old");
    expect(new URL(next).origin).toBe(new URL(value).origin);
    expect(new URL(next).pathname).toBe(new URL(value).pathname);
    expect(telegramMessageId(next)).toBe("42");
  }
  for (const value of [
    "https://webk.telegram.org.evil.test/",
    "https://user@webk.telegram.org/",
    "file://webk.telegram.org/",
  ]) {
    expect(isTelegramWeb(value)).toBe(false);
    expect(isTelegramLink(value)).toBe(false);
  }
});
it("does not treat invitations, channel roots or lookalike domains as downloadable messages", () => {
  expect(isTelegramLink("https://web.telegram.org.evil.test/a/")).toBe(false);
  expect(isTelegramLink("https://user@t.me/channelname/42")).toBe(false);
  expect(() => telegramMessageId("https://t.me/+invite")).toThrow();
  expect(() => telegramMessageId("https://t.me/channelname")).toThrow();
});
