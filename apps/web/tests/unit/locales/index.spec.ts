import { describe, expect, it, vi } from "vitest";

const mockLoadLocaleMessages = vi.hoisted(() => vi.fn());

vi.mock("@/locales/lazy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/locales/lazy")>();
  return { ...actual, loadLocaleMessages: mockLoadLocaleMessages };
});

import { i18n, setLanguage } from "@/locales";

describe("setLanguage", () => {
  it("rejects locale-pack failures without reporting a successful switch", async () => {
    const failure = new Error("locale pack unavailable");
    mockLoadLocaleMessages.mockRejectedValueOnce(failure);
    i18n.global.locale.value = "en-US";

    await expect(setLanguage("zh-CN")).rejects.toBe(failure);
    expect(i18n.global.locale.value).toBe("en-US");
  });
});
