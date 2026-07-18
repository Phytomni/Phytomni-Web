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
    "chat.progress.processing",
    "chat.progress.valueText",
    "chat.agentsArchitectureTitle",
    "chat.agentsArchitectureAlt",
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

  it("has exact progress copy and no chat.eta.* subtree", () => {
    expect(getMessage(enUS, "chat.progress.processing")).toBe("Processing");
    expect(getMessage(zhCN, "chat.progress.processing")).toBe("处理中");
    expect(getMessage(enUS, "chat.progress.valueText")).toBe(
      "Processing, {percent}%"
    );
    expect(getMessage(zhCN, "chat.progress.valueText")).toBe(
      "处理中，{percent}%"
    );
    expect(getMessage(enUS, "chat.eta")).toBeUndefined();
    expect(getMessage(zhCN, "chat.eta")).toBeUndefined();
    for (const leaf of ["fast", "medium", "slow"] as const) {
      expect(getMessage(enUS, `chat.eta.${leaf}`)).toBeUndefined();
      expect(getMessage(zhCN, `chat.eta.${leaf}`)).toBeUndefined();
    }
  });
});
