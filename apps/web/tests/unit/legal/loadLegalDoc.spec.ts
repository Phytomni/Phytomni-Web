import { describe, it, expect } from "vitest";
import { LEGAL_META, loadLegalDoc } from "@/legal/loadLegalDoc";

describe("loadLegalDoc", () => {
  it("exposes version metadata for both docs", () => {
    expect(LEGAL_META.terms.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(LEGAL_META.privacy.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(LEGAL_META.terms.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns Chinese markdown for zh-CN and English otherwise", () => {
    const zh = loadLegalDoc("terms", "zh-CN");
    const en = loadLegalDoc("terms", "en-US");
    expect(zh.markdown.length).toBeGreaterThan(40);
    expect(en.markdown.length).toBeGreaterThan(40);
    expect(zh.markdown).not.toEqual(en.markdown);
    expect(zh.version).toBe(LEGAL_META.terms.version);
  });

  it("falls back to English for unknown locales", () => {
    const doc = loadLegalDoc("privacy", "fr-FR");
    const en = loadLegalDoc("privacy", "en-US");
    expect(doc.markdown).toBe(en.markdown);
  });
});
