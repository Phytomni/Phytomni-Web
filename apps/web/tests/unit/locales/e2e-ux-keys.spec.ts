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
  const keys = ["chat.sendAriaLabel", "chat.abortAriaLabel", "chat.timeoutFailed"];
  for (const key of keys) {
    it(`has zh-CN + en-US copy for ${key}`, () => {
      expect(getMessage(zhCN, key), `${key} zh-CN`).toEqual(expect.any(String));
      expect(getMessage(enUS, key), `${key} en-US`).toEqual(expect.any(String));
    });
  }
});
