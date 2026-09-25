import { describe, it, expect, vi } from "vitest";
import { createI18n } from "vue-i18n";
import { loadLocaleMessages, type SupportedLocales } from "@/locales/lazy";

const freshI18n = () =>
  createI18n({
    legacy: false,
    locale: "en-US",
    fallbackLocale: "en-US",
    messages: { "en-US": {} },
  });

describe("loadLocaleMessages", () => {
  it("loads the zh-CN pack into i18n on first call", async () => {
    const i18n = freshI18n();
    expect(i18n.global.availableLocales).not.toContain("zh-CN");
    await loadLocaleMessages(i18n, "zh-CN");
    expect(i18n.global.availableLocales).toContain("zh-CN");
    expect(
      Object.keys(i18n.global.getLocaleMessage("zh-CN")).length
    ).toBeGreaterThan(0);
  });

  it("is idempotent — a second call does not re-run the loader", async () => {
    const i18n = freshI18n();
    const messages = { hello: "world", nested: { label: "Nested" } };
    const spy = vi.fn(async () => messages);
    const loaders: Partial<
      Record<SupportedLocales, () => Promise<typeof messages>>
    > = { "zh-CN": spy };
    await loadLocaleMessages(i18n, "zh-CN", loaders);
    await loadLocaleMessages(i18n, "zh-CN", loaders);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(i18n.global.getLocaleMessage("zh-CN")).toEqual(messages);
  });

  it("no-ops for an already-present locale (en-US)", async () => {
    const i18n = freshI18n();
    const spy = vi.fn(async () => ({}));
    const loaders = { "en-US": spy } as Record<
      SupportedLocales,
      () => Promise<Record<string, unknown>>
    >;
    await loadLocaleMessages(i18n, "en-US", loaders);
    expect(spy).not.toHaveBeenCalled();
  });
});
