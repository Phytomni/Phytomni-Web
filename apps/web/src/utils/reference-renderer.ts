import { escapeHtml, sanitizeHref } from "@/utils/sanitize-markup";
import {
  formatDetailedCitation,
  normalizeReferenceDocument,
} from "@/utils/citation";
import { requireCitationNamespace } from "@/utils/scientific-markdown/citations";

export interface DisplayReference {
  html: string;
  id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formattedCitationOf(doc: unknown): string | undefined {
  if (!isRecord(doc)) return undefined;
  const value = doc.formatted_citation;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Bot `formatted_citation` is Nature-style text with markdown * / ** and
 * `[label](href)` DOI links. The string is attacker-influenced: escape first,
 * then lift only those markdown tokens into sanitized HTML.
 */
function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function citationMarkupToSafeHtml(text: string): string {
  const escaped = escapeHtml(decodeBasicEntities(text));
  const withLinks = escaped.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, href: string) =>
      `<a href="${sanitizeHref(href)}" target="_blank" class="doi-link">${label}</a>`
  );
  const withBold = withLinks.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return withBold.replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

// Build the formatted HTML for the reference list (extracted verbatim from
// DeepGenomeResultViewer's displayReferences computed).
//
// XSS sanitization invariant (v-html sink): references come from a reshape of
// Bot's `formatted.references`, whose fields are influenced by agent output / RAG
// corpus and are ultimately injected via v-html. Every agent text field (title /
// citation au-so / dl text / pm text / plain string / JSON) is escapeHtml-ed; the
// DOI / PubMed href always goes through sanitizeHref for a scheme allow-list check.
export const buildDisplayReferences = (
  references: readonly unknown[] | null | undefined,
  ns: string
): DisplayReference[] => {
  if (references == null || references.length === 0) {
    return [];
  }

  // A namespace is a developer-owned identifier. Reject missing or invalid
  // input instead of creating bare IDs that can collide across answers.
  const safeNs = requireCitationNamespace(ns);
  const refId = (n: number) => `${safeNs}-ref-${n}`;

  return references.map((doc, index) => {
    const refIndex = index + 1;
    const natureCitation = formattedCitationOf(doc);
    if (natureCitation !== undefined) {
      return {
        html: `<div class="doc-citation">${refIndex}. ${citationMarkupToSafeHtml(
          natureCitation
        )}</div>`,
        id: refId(refIndex),
      };
    }
    const normalized = normalizeReferenceDocument(doc);

    if (normalized.au || normalized.ti) {
      // Rich branch FIRST: an enriched doc carries BOTH title and au/ti, and must render the full
      // bibliography rather than collapsing to the title-only row (enriched wins over title-only).
      const citation = formatDetailedCitation(doc);

      // build the DOI and PMID link parts
      let linkPart = "";
      const hasLink = normalized.dl || normalized.pm;

      if (hasLink) {
        const doiLink = normalized.dl
          ? `doi: <a href="${sanitizeHref(
              normalized.dl
            )}" target="_blank" class="doi-link">${escapeHtml(
              normalized.dl
            )}</a>`
          : "";
        const pmidLink = normalized.pm
          ? `pmid:<a href="${sanitizeHref(
              "https://pubmed.ncbi.nlm.nih.gov/" + normalized.pm
            )}" target="_blank" class="pmid-link">${escapeHtml(
              normalized.pm
            )}</a>`
          : "";

        const separator = normalized.dl && normalized.pm ? "; " : "";

        linkPart = `. <span class="doc-link-inline">${doiLink}</span><span>${separator}</span><span class="doc-link-inline">${pmidLink}</span>`;
      }

      return {
        // citation is plain text (au/so/volume-page-year), escaped first; linkPart is
        // a sanitized anchor produced by this component (sanitizeHref + escapeHtml),
        // kept as-is and not re-escaped.
        html: `<div class="doc-citation">${refIndex}. ${escapeHtml(
          citation
        )}${linkPart}</div>`,
        id: refId(refIndex),
      };
    } else if (normalized.title) {
      return {
        html: `<div class="doc-citation">${refIndex}. ${escapeHtml(
          normalized.title
        )}</div>`,
        id: refId(refIndex),
      };
    } else {
      // handle plain-string references
      if (typeof doc === "string") {
        return {
          html: `<div class="doc-citation">${refIndex}. ${escapeHtml(
            doc
          )}</div>`,
          id: refId(refIndex),
        };
      }

      // default case
      const serialized = JSON.stringify(doc) ?? String(doc);
      return {
        html: `<div class="doc-citation">${refIndex}. ${escapeHtml(
          serialized
        )}</div>`,
        id: refId(refIndex),
      };
    }
  });
};
