import { LEGAL_META, type LegalDocKind } from "./meta";
import termsEn from "./terms.en-US.md?raw";
import termsZh from "./terms.zh-CN.md?raw";
import privacyEn from "./privacy.en-US.md?raw";
import privacyZh from "./privacy.zh-CN.md?raw";

export { LEGAL_META, type LegalDocKind } from "./meta";

const BODIES: Record<LegalDocKind, Record<"en-US" | "zh-CN", string>> = {
  terms: { "en-US": termsEn, "zh-CN": termsZh },
  privacy: { "en-US": privacyEn, "zh-CN": privacyZh },
};

function normalizeLocale(locale: string): "en-US" | "zh-CN" {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}

export function loadLegalDoc(kind: LegalDocKind, locale: string) {
  const meta = LEGAL_META[kind];
  const lang = normalizeLocale(locale);
  return {
    kind,
    version: meta.version,
    effectiveDate: meta.effectiveDate,
    markdown: BODIES[kind][lang],
  };
}
