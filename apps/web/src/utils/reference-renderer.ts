import { escapeHtml, sanitizeHref } from "@/utils/sanitize-markup";
import { formatDetailedCitation } from "@/utils/citation";

// Build the formatted HTML for the reference list (extracted verbatim from
// DeepGenomeResultViewer's displayReferences computed).
//
// XSS sanitization invariant (v-html sink): references come from a reshape of
// Bot's `formatted.references`, whose fields are influenced by agent output / RAG
// corpus and are ultimately injected via v-html. Every agent text field (title /
// citation au-so / dl text / pm text / plain string / JSON) is escapeHtml-ed; the
// DOI / PubMed href always goes through sanitizeHref for a scheme allow-list check.
export const buildDisplayReferences = (
  references: any[]
): Array<{ html: string; id: string }> => {
  if (!references || references.length === 0) {
    return [];
  }

  return references.map((doc, index) => {
    const refIndex = index + 1;

    if (doc.au || doc.ti) {
      // Rich branch FIRST: an enriched doc carries BOTH title and au/ti, and must render the full
      // bibliography rather than collapsing to the title-only row (WI1 priority flip).
      const citation = formatDetailedCitation(doc);

      // build the DOI and PMID link parts
      let linkPart = "";
      const hasLink = doc.dl || doc.pm;

      if (hasLink) {
        const doiLink = doc.dl
          ? `doi:<a href="${sanitizeHref(
              String(doc.dl)
            )}" target="_blank" class="doi-link">${escapeHtml(
              String(doc.dl)
            )}</a>`
          : "";
        const pmidLink = doc.pm
          ? `pmid:<a href="${sanitizeHref(
              "https://pubmed.ncbi.nlm.nih.gov/" + String(doc.pm)
            )}" target="_blank" class="pmid-link">${escapeHtml(
              String(doc.pm)
            )}</a>`
          : "";

        const separator = doc.dl && doc.pm ? "; " : "";

        linkPart = `. <span class="doc-link-inline">${doiLink}</span><span>${separator}</span><span class="doc-link-inline">${pmidLink}</span>`;
      }

      return {
        // citation is plain text (au/so/volume-page-year), escaped first; linkPart is
        // a sanitized anchor produced by this component (sanitizeHref + escapeHtml),
        // kept as-is and not re-escaped.
        html: `<div class="doc-citation">${refIndex}. ${escapeHtml(
          citation
        )}${linkPart}</div>`,
        id: `ref-${refIndex}`,
      };
    } else if (doc.title) {
      return {
        html: `<div>${refIndex}. ${escapeHtml(String(doc.title))}</div>`,
        id: `ref-${refIndex}`,
      };
    } else {
      // handle plain-string references
      if (typeof doc === "string") {
        return {
          html: `<div>${refIndex}. ${escapeHtml(doc)}</div>`,
          id: `ref-${refIndex}`,
        };
      }

      // default case
      return {
        html: `<div>${refIndex}. ${escapeHtml(JSON.stringify(doc))}</div>`,
        id: `ref-${refIndex}`,
      };
    }
  });
};
