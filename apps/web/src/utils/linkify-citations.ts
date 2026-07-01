// Turn citation markers [N] and compound [N,M,...] into anchors that jump to the matching
// `#ns-ref-N` reference row (the id emitted by buildDisplayReferences for the same ns). Call this
// AFTER escapeHtml and AFTER markdown link processing: escaping means any smuggled tag is already
// inert text, and running after the link regex means a real `[1](url)` was already consumed as a
// link (never a citation). Without an ns the function is a no-op (no matching targets exist, so
// linkifying would only create dead links). XSS: the bracket class is digits/commas/whitespace
// ONLY, ns is [A-Za-z0-9-]-sanitized, and each href is a fixed `#ns-ref-N` built from a \d{1,3}
// group with no attacker-controlled text — preserving the v-html sanitization invariant.
export const linkifyCitations = (html: string, ns = ""): string => {
  if (!html) return html;
  // ns namespaces the anchor targets so [N] jumps to reference N of the SAME message.
  // ns is developer-supplied (m<index> / kb / bg), never agent text; sanitize defensively.
  const safeNs = ns.replace(/[^A-Za-z0-9-]/g, "");
  // Scope gate: without a namespace there are no matching #ns-ref-N targets in the document,
  // so linkifying would only produce dead links (e.g. in plain assistant / user / analyst / help
  // bodies). Only cited-family and DeepGenome answers pass a namespace.
  if (!safeNs) return html;
  return html.replace(
    /\[(\d{1,3}(?:,\s*\d{1,3})*)\]/g,
    (_match, group: string) => {
      const anchors = group
        .split(/\s*,\s*/)
        .map((n) => `<a href="#${safeNs}-ref-${n}" class="citation-ref">${n}</a>`)
        .join(", ");
      return `[${anchors}]`;
    }
  );
};
