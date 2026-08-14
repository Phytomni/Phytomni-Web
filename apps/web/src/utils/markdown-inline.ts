import {
  sanitizeAnchorAttributes,
  sanitizeEscapedHref,
  sanitizeHref,
} from "@/utils/sanitize-markup";
import {
  parseCitationBody,
  requireCitationNamespace,
} from "@/utils/scientific-markdown/citations";

// AnalystAgent returns markdown that writes images/links as ./.out/xxxx; the
// frontend rewrites them into accessible attachment URLs. The base prefix comes
// from a Vite env (VITE_ATTACHMENTS_BASE_URL), defaulting to the relative path
// /attachments/ — in dev the vite proxy / same-origin nginx takes over; for a
// production cross-origin pointing at a standalone attachments service, change the
// key in .env.production. Do not hard-code the prod host into the source.
const attachmentsBaseUrl =
  import.meta.env.VITE_ATTACHMENTS_BASE_URL || "/attachments/";

export const convertFilePath = (path: string): string => {
  if (!path) return path;
  if (path.includes(".out/")) {
    return path.replace(/\.?\/?\.out\//g, attachmentsBaseUrl);
  }
  return path;
};

// processInlineMarkdown does NOT escapeHtml — this is the contract: the caller
// escapeHtml-s before passing in (processInlineMarkdown(escapeHtml(text))). This
// function does inline processing on the bare string and never escapes itself
// (escaping belongs to the caller; see the v-html sanitization invariant /
// @/utils/sanitize-markup).
export const processInlineMarkdown = (
  line: string,
  ns = "",
  referenceCount = 0
): string => {
  if (!line) return line;

  // Emitted-HTML vault (regex-reentrancy guard). Each pass below runs a
  // .replace over the WHOLE line in sequence, so without protection a later
  // pass (image / citation) re-scans the finished <a href="..."> markup a
  // prior pass (anchor resurrection) just produced — and can match markdown
  // syntax INSIDE that href attribute value, splicing a template whose own "
  // breaks out of the attribute and lets the browser's tag-soup parser
  // recover an onclick/onmouseover from the wreckage (a real, executable XSS
  // once this line reaches v-html). To stop that, every pass that emits a
  // FINISHED tag stashes the tag here and leaves an opaque NUL-delimited
  // token in the line; later passes see the token, never the tag's
  // attributes. expandVault() splices the real markup back in at the very
  // end, non-recursively. The sentinel is a Private-Use-Area char that
  // escapeHtml never emits, and it is stripped on entry so a payload cannot
  // forge a token.
  line = line.replace(/\uE000/g, "");
  const vault: string[] = [];
  const stash = (html: string): string => {
    const token = `\uE000MD${vault.length}\uE000`;
    vault.push(html);
    return token;
  };
  const expandVault = (s: string): string => {
    // A later stashing pass can capture a payload that already contains an
    // earlier pass's token (e.g. a clickable image [![alt](img)](doc.md): the
    // .md-link anchor's inner text is the image token). String.replace does not
    // re-scan replacement text, so expand to a fixed point. Safe against
    // infinite loops: tokens are only ever produced by stash() (attacker NUL is
    // stripped on entry), so every expansion strictly consumes a real token and
    // vault is finite; the bound is a defensive backstop.
    let out = s;
    for (let i = 0; i <= vault.length; i++) {
      const next = out.replace(
        /\uE000MD(\d+)\uE000/g,
        (_m, j) => vault[Number(j)] ?? ""
      );
      if (next === out) break;
      out = next;
    }
    return out;
  };

  // ns namespaces the [N] citation anchors so they target reference N of the SAME message
  // (multiple DeepGenome/cited answers render into one chat document). Reject a
  // malformed non-empty namespace instead of silently changing its identity.
  const safeNs = ns ? requireCitationNamespace(ns) : "";

  const inlineCodeRanges = [...line.matchAll(/`[^`]*`/g)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));

  // First restore the escaped HTML <a> tags (supports various attribute combinations)
  // Match pattern: &lt;a href=&quot;...&quot; ... &gt;...&lt;/a&gt;
  // Use a looser match to handle attributes that contain HTML entities
  line = line.replace(
    /&lt;a\s+(.*?)&gt;(.*?)&lt;\/a&gt;/g,
    function (match: string, attributes: string, text: string, offset: number) {
      if (
        inlineCodeRanges.some(
          (range) => range.start < offset + match.length && offset < range.end
        )
      ) {
        return match;
      }

      // restore escaped characters in the attributes
      attributes = attributes
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&");

      // convert the path (if the href attribute exists)
      attributes = attributes.replace(
        /href=["']([^"']+)["']/g,
        function (attrMatch: string, url: string) {
          const convertedUrl = convertFilePath(url);
          return `href="${convertedUrl}"`;
        }
      );

      // XSS protection: resurrected <a> attributes are passed through verbatim; before
      // v-html injection, strip event-handler attributes and neutralize dangerous-scheme
      // hrefs like javascript:/data: (see @/utils/sanitize-markup).
      attributes = sanitizeAnchorAttributes(attributes);

      // Stash the finished anchor so a later image/citation pass cannot
      // re-enter its attribute text (the regex-reentrancy XSS above).
      return stash(`<a ${attributes}>${text}</a>`);
    }
  );

  // Protect inline-code spans before processing images, links, citations, and
  // emphasis. The caller already escaped the code text, and the vault keeps
  // markdown-looking content inside backticks inert through later passes.
  line = line.replace(/`([^`]*)`/g, (_match: string, content: string) =>
    stash(`<code>${content}</code>`)
  );

  // handle .cif images first
  line = line.replace(
    /!\[(.*?)\]\((.*?\.cif)\)/g,
    function (match: string, alt: string, src: string) {
      const convertedSrc = sanitizeEscapedHref(convertFilePath(src));
      return stash(
        '<div class="cif-container" data-src="' +
          convertedSrc +
          '" data-alt="' +
          alt +
          '"></div>'
      );
    }
  );
  // handle other image formats
  line = line.replace(
    /!\[(.*?)\]\((?!.*\.cif)(.*?)\)/g,
    function (match: string, alt: string, src: string) {
      const convertedSrc = sanitizeEscapedHref(convertFilePath(src));
      return stash(
        '<img src="' +
          convertedSrc +
          '" alt="' +
          alt +
          '" style="max-width: 100%; height: auto; cursor: zoom-in;" class="clickable-image" data-src="' +
          convertedSrc +
          '" data-alt="' +
          alt +
          '">'
      );
    }
  );
  // handle .md links
  line = line.replace(
    /\[([^\]]+?)\]\(([^)]+?\.md)\)/g,
    function (match: string, text: string, url: string) {
      const convertedUrl = convertFilePath(url);
      return stash(
        '<a href="' +
          sanitizeHref(convertedUrl) +
          '" target="_blank" download>' +
          text +
          "</a>"
      );
    }
  );
  // handle .cif links
  line = line.replace(
    /\[([^\]]+?)\]\(([^)]+?\.cif)\)/g,
    (_: string, text: string, url: string) => {
      // convert the path
      const cleanUrl = sanitizeEscapedHref(convertFilePath(url));
      return stash(
        `<div class="cif-container" data-src="${cleanUrl}" data-alt="${text}">${text} (CIF file)</div>`
      );
    }
  );
  // v-html content cannot compile Vue click handlers, so DeepGenome citations
  // use native fragment links plus stable class/ARIA metadata consumed by the
  // artifact's delegated interaction. Without a namespace, keep the marker
  // literal instead of creating a cross-message bare #ref-N target.
  line = line.replace(
    /\[(\d{1,3}(?:\s*-\s*\d{1,3})?(?:\s*,\s*\d{1,3}(?:\s*-\s*\d{1,3})?)*)\]/g,
    (match: string) => {
      const parsed = parseCitationBody(match);
      if (
        !safeNs ||
        !parsed ||
        !Number.isInteger(referenceCount) ||
        referenceCount < 1 ||
        parsed.indices.some((index) => index > referenceCount)
      ) {
        return match;
      }
      return stash(
        `<a href="#${safeNs}-ref-${parsed.indices[0]}" class="citation-ref" aria-label="Citation ${parsed.display}" style="display: inline-block;">[${parsed.display}]</a>`
      );
    }
  );
  // handle bold
  line = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  line = line.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // handle italics (improved, avoids confusion with lists)
  line = line.replace(/(^|\s)\*([^*]+?)\*(?=\s|$|[.,;:!?])/g, "$1<em>$2</em>");
  // Splice the stashed finished tags back in, non-recursively.
  return expandVault(line);
};
