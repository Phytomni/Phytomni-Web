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
    "chat.agentsArchitectureTitle",
    "chat.agentsArchitectureAlt",
    "chat.execution.workflowPlan",
    "chat.execution.workflowPlanSteps",
    "chat.execution.technicalDetails",
    "chat.execution.technicalEventCount",
  ];
  for (const key of keys) {
    it(`has zh-CN + en-US copy for ${key}`, () => {
      const zh = getMessage(zhCN, key);
      const en = getMessage(enUS, key);
      expect(zh, `${key} zh-CN`).toEqual(expect.any(String));
      expect((zh as string).length, `${key} zh-CN non-empty`).toBeGreaterThan(
        0
      );
      expect(en, `${key} en-US`).toEqual(expect.any(String));
      expect((en as string).length, `${key} en-US non-empty`).toBeGreaterThan(
        0
      );
    });
  }

  it("does not expose elapsed-time progress estimates", () => {
    expect(getMessage(enUS, "chat.progress")).toBeUndefined();
    expect(getMessage(zhCN, "chat.progress")).toBeUndefined();
    expect(getMessage(enUS, "chat.eta")).toBeUndefined();
    expect(getMessage(zhCN, "chat.eta")).toBeUndefined();
    for (const leaf of ["fast", "medium", "slow"] as const) {
      expect(getMessage(enUS, `chat.eta.${leaf}`)).toBeUndefined();
      expect(getMessage(zhCN, `chat.eta.${leaf}`)).toBeUndefined();
    }
  });
});
