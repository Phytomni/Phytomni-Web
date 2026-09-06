import { decodeCitationDocuments } from "@/views/chat/utils/format";
import type { CitationPresentation } from "@/utils/citation-presentation";
import { requireCitationNamespace } from "@/utils/scientific-markdown/citations";

export interface DisplayReference {
  id: string;
  index: number;
  citation: CitationPresentation | null;
}

/** Build typed rows without interpreting bibliography text as markup. */
export const buildDisplayReferences = (
  references: readonly unknown[] | null | undefined,
  ns: string
): DisplayReference[] => {
  if (references == null || references.length === 0) return [];
  const safeNs = requireCitationNamespace(ns);
  return (decodeCitationDocuments(references) ?? []).map((doc, position) => ({
    id: `${safeNs}-ref-${position + 1}`,
    index: position + 1,
    citation: doc.citation,
  }));
};
