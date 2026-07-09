import { describe, it, expect } from "vitest";
import { createI18n } from "vue-i18n";
import { datetimeFormats } from "@/locales/datetime-formats";
import { formatDisplayDate } from "@/locales/format-display-date";

const FIXED = new Date(2026, 6, 9, 15, 30, 45); // local Jul 9, 2026 15:30:45

function makeI18n(locale: "en-US" | "zh-CN") {
  return createI18n({
    legacy: false,
    locale,
    datetimeFormats,
    messages: { "en-US": {}, "zh-CN": {} },
  });
}

describe("datetimeFormats + formatDisplayDate", () => {
  it("formats the same instant differently for en-US vs zh-CN on each preset", () => {
    const en = makeI18n("en-US");
    const zh = makeI18n("zh-CN");
    for (const preset of ["date", "datetime", "timestamp"] as const) {
      const enOut = formatDisplayDate(en.global.d, FIXED, preset);
      const zhOut = formatDisplayDate(zh.global.d, FIXED, preset);
      expect(enOut).not.toBe("--");
      expect(zhOut).not.toBe("--");
      expect(enOut).not.toBe(zhOut);
    }
  });

  it("returns -- for null, empty string, and invalid input without throwing", () => {
    const en = makeI18n("en-US");
    const d = en.global.d;
    expect(formatDisplayDate(d, null, "datetime")).toBe("--");
    expect(formatDisplayDate(d, "", "datetime")).toBe("--");
    expect(formatDisplayDate(d, "not-a-date", "datetime")).toBe("--");
  });

  it("accepts ISO strings and reformats when locale changes on the same i18n instance", () => {
    const i18n = makeI18n("zh-CN");
    const iso = FIXED.toISOString();
    const zhOut = formatDisplayDate(i18n.global.d, iso, "datetime");
    (i18n.global.locale as { value: string }).value = "en-US";
    const enOut = formatDisplayDate(i18n.global.d, iso, "datetime");
    expect(zhOut).not.toBe(enOut);
  });
});
