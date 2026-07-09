export type LegalDocKind = "terms" | "privacy";

export const LEGAL_META: Record<
  LegalDocKind,
  { version: string; effectiveDate: string }
> = {
  terms: { version: "0.1.0", effectiveDate: "2026-07-09" },
  privacy: { version: "0.1.0", effectiveDate: "2026-07-09" },
};
