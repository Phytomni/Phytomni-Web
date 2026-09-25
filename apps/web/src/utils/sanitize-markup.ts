// Shared URL and text sanitizers for Vue-bound values and the small, reviewed
// reference/legal HTML boundaries. Agent report bodies never use v-html: they
// render through ScientificMarkdown with raw HTML disabled and sanitization on.

const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);

function decodeEntities(value: string): string {
  const fromCodePoint = (code: number, fallback: string): string =>
    Number.isInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : fallback;
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (match: string, hex: string) =>
      fromCodePoint(parseInt(hex, 16), match)
    )
    .replace(/&#(\d+);?/g, (match: string, dec: string) =>
      fromCodePoint(parseInt(dec, 10), match)
    )
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n");
}

function isSafeHref(rawValue: string): boolean {
  const stripped = Array.from(decodeEntities(rawValue))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x20 && !(code >= 0x7f && code <= 0xa0);
    })
    .join("");
  const schemeMatch = stripped.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!schemeMatch) return true;
  return SAFE_SCHEMES.has(schemeMatch[1].toLowerCase());
}

function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape a URL before interpolating it into a reviewed HTML attribute. */
export function sanitizeHref(url: string): string {
  if (!url) return "#";
  return isSafeHref(url) ? escapeAttrValue(url) : "#";
}

/** Validate a URL before passing it to a Vue-bound href attribute. */
export function safeHrefValue(rawValue: string): string | null {
  if (!rawValue) return null;
  return isSafeHref(rawValue) ? rawValue : null;
}

/** Escape arbitrary text at the reviewed reference/log/legal HTML boundaries. */
export function escapeHtml(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
