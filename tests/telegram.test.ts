import { it, expect } from "vitest";
import {
  telegramWebUrl,
  telegramMessageId,
  isTelegramLink,
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
it("does not treat invitations, channel roots or lookalike domains as downloadable messages", () => {
  expect(isTelegramLink("https://web.telegram.org.evil.test/a/")).toBe(false);
  expect(isTelegramLink("https://user@t.me/channelname/42")).toBe(false);
  expect(() => telegramMessageId("https://t.me/+invite")).toThrow();
  expect(() => telegramMessageId("https://t.me/channelname")).toThrow();
});
