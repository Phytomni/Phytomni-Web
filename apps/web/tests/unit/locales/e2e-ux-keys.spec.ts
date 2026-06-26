import { describe, expect, it } from "vitest";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const getMessage = (messages: unknown, path: string) =>
  path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object" && key in node) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, messages);

describe("e2e UX i18n keys", () => {
  const keys = [
    "chat.sendAriaLabel",
    "chat.abortAriaLabel",
    "chat.timeoutFailed",
    "chat.eta.fast",
    "chat.eta.medium",
    "chat.eta.slow",
    "chat.elapsedPrefix",
  ];
  for (const key of keys) {
    it(`has zh-CN + en-US copy for ${key}`, () => {
      const zh = getMessage(zhCN, key);
      const en = getMessage(enUS, key);
      expect(zh, `${key} zh-CN`).toEqual(expect.any(String));
      expect((zh as string).length, `${key} zh-CN non-empty`).toBeGreaterThan(0);
      expect(en, `${key} en-US`).toEqual(expect.any(String));
      expect((en as string).length, `${key} en-US non-empty`).toBeGreaterThan(0);
    });
  }
});
