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

  it("terms English draft covers research disclaimer and improvement opt-out", () => {
    const md = loadLegalDoc("terms", "en-US").markdown.toLowerCase();
    expect(md).toContain("peer review");
    expect(md).toMatch(/opt-?out/);
    expect(md).toContain("bri-zhbgs@caas.cn");
    expect(md).toContain("chinese prevails");
  });

  it("privacy English draft covers no-sale and controller contact", () => {
    const md = loadLegalDoc("privacy", "en-US").markdown.toLowerCase();
    expect(md).toContain("do not sell");
    expect(md).toContain("bri-zhbgs@caas.cn");
    expect(md).toContain("huawei"); // OBS processor disclosure
  });

  it("Chinese terms and privacy include institute name and opt-out", () => {
    const terms = loadLegalDoc("terms", "zh-CN").markdown;
    const privacy = loadLegalDoc("privacy", "zh-CN").markdown;
    expect(terms).toContain("生物技术研究所");
    expect(terms).toContain("退出");
    expect(privacy).toContain("生物技术研究所");
    expect(privacy).toMatch(/出售|出卖/);
  });
});
