// Turn citation markers [N] and compound [N,M,...] into anchors that jump to the matching
// `#ref-N` reference row (the id emitted by buildDisplayReferences). Call this AFTER escapeHtml and
// AFTER markdown link processing: escaping means any smuggled tag is already inert text, and running
// after the link regex means a real `[1](url)` was already consumed as a link (never a citation).
// XSS: the bracket class is digits/commas/whitespace ONLY, so it can never capture tag syntax, and
// each href is a fixed `#ref-N` built from a \d{1,3} group with no attacker-controlled text —
// preserving the v-html sanitization invariant.
export const linkifyCitations = (html: string): string => {
  if (!html) return html;
  return html.replace(
    /\[(\d{1,3}(?:,\s*\d{1,3})*)\]/g,
    (_match, group: string) => {
      const anchors = group
        .split(/\s*,\s*/)
        .map((n) => `<a href="#ref-${n}" class="citation-ref">${n}</a>`)
        .join(", ");
      return `[${anchors}]`;
    }
  );
};
