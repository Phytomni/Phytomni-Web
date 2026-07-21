// XSS protection: DeepGenomeResultViewer's processInlineMarkdown takes <a> tags
// from deep_genome agent markdown (relayed via Bot), first escapeHtml-s them into
// entities, then "resurrects" them into bare <a> via regex, and finally injects
// the result into the DOM via v-html. On resurrection the attribute string is
// passed through verbatim, so malicious agent output or a poisoned RAG corpus can
// inject event handlers or dangerous-scheme hrefs onto the anchor — v-html
// (innerHTML) lets them execute on click or even hover, and this app stores its
// token in a non-HttpOnly cookie, so document.cookie can be stolen.
//
// Sanitize with an "attribute-NAME allow-list", not an "on* deny-list": HTML does
// not require attributes to be whitespace-separated — after a closing quote the
// next attribute can follow immediately (e.g. href="x"onmouseover="y" is two
// attributes), so a deny-list regex relying on a \son boundary is bypassed by that
// form. Here we correctly tokenize name=value pairs and keep only attribute names
// on the explicit allow-list; everything else (all on*, style, formaction, etc.)
// is dropped; href then gets a scheme allow-list check. Only the attributes need
// sanitizing: the body is never un-escaped (stays entities after escapeHtml), and
// the only thing resurrected into bare HTML is the <a> attribute string, so that
// is the sole injection primitive on this path.

// Attribute names allowed to remain (compared lowercase). Everything else is dropped.
const ALLOWED_ATTRS = new Set([
  "href",
  "title",
  "target",
  "rel",
  "class",
  "download",
]);

// Schemes allowed for href; no scheme (relative path / #anchor / absolute path) is allowed by default.
const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);

interface Attr {
  name: string;
  value: string | null; // null = boolean attribute (e.g. download)
}

const isSpace = (c: string): boolean =>
  c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

// Correct tokenize: attributes may be whitespace-separated or follow immediately after the previous attribute's closing quote.
function parseAttributes(input: string): Attr[] {
  const attrs: Attr[] = [];
  const n = input.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isSpace(input[i]) || input[i] === "/")) i++;
    if (i >= n) break;

    let name = "";
    while (
      i < n &&
      !isSpace(input[i]) &&
      input[i] !== "=" &&
      input[i] !== "/" &&
      input[i] !== ">"
    ) {
      name += input[i];
      i++;
    }
    if (!name) {
      i++; // skip stray = / > etc. to keep advancing
      continue;
    }

    while (i < n && isSpace(input[i])) i++;

    let value: string | null = null;
    if (input[i] === "=") {
      i++;
      while (i < n && isSpace(input[i])) i++;
      const quote = input[i];
      if (quote === '"' || quote === "'") {
        i++;
        let v = "";
        while (i < n && input[i] !== quote) {
          v += input[i];
          i++;
        }
        i++; // skip the closing quote
        value = v;
      } else {
        let v = "";
        while (i < n && !isSpace(input[i]) && input[i] !== ">") {
          v += input[i];
          i++;
        }
        value = v;
      }
    }

    attrs.push({ name, value });
  }
  return attrs;
}

function decodeEntities(s: string): string {
  const fromCp = (code: number, fallback: string): string =>
    Number.isInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : fallback;
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (m: string, hex: string) =>
      fromCp(parseInt(hex, 16), m)
    )
    .replace(/&#(\d+);?/g, (m: string, dec: string) =>
      fromCp(parseInt(dec, 10), m)
    )
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n");
}

// Scheme allow-list: decode entities and strip control/whitespace chars before
// reading the scheme, to defeat obfuscation like java&Tab;script:. Filter by
// codepoint rather than a regex containing control chars (the latter trips eslint
// no-control-regex): strip control/whitespace chars <= 0x20, plus 0x7f–0xa0
// (DEL / C1 controls / NBSP).
function isSafeHref(rawValue: string): boolean {
  const stripped = Array.from(decodeEntities(rawValue))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x20 && !(code >= 0x7f && code <= 0xa0);
    })
    .join("");
  const schemeMatch = stripped.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!schemeMatch) return true; // no scheme: relative path / #anchor / absolute path
  return SAFE_SCHEMES.has(schemeMatch[1].toLowerCase());
}

// Escape the attribute value before re-emitting into v-html, to prevent attribute breakout.
function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Sanitize the attribute string of an <a> tag headed for a v-html sink.
 *
 * @param attributes the raw attribute string between `<a` and `>` (already un-escaped to bare chars).
 * @returns the sanitized attribute string: only allow-listed attributes are kept, and a dangerous-scheme href is neutralized to `#`.
 */
export function sanitizeAnchorAttributes(attributes: string): string {
  if (!attributes) return "";

  const kept: string[] = [];
  for (const attr of parseAttributes(attributes)) {
    const name = attr.name.toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) continue;

    if (name === "href") {
      const href = isSafeHref(attr.value ?? "") ? attr.value ?? "" : "#";
      kept.push(`href="${escapeAttrValue(href)}"`);
    } else if (attr.value === null) {
      kept.push(name); // boolean attribute, e.g. download
    } else {
      kept.push(`${name}="${escapeAttrValue(attr.value)}"`);
    }
  }

  return kept.join(" ");
}

/**
 * Validate a single href URL, for cases that insert a URL straight into a fixed
 * `<a href="...">` (doi / pmid / .md links) — these sites do not pass through
 * arbitrary attributes, but the URL itself may carry a dangerous scheme (e.g.
 * `[x](javascript:alert(1)//.md)` sneaks javascript: in behind a `.md` suffix).
 *
 * @param url the raw URL to be inserted as href.
 * @returns the escaped URL when the scheme is on the allow-list (safe to put into
 *          a v-html attribute), otherwise `"#"`.
 */
export function sanitizeHref(url: string): string {
  if (!url) return "#";
  return isSafeHref(url) ? escapeAttrValue(url) : "#";
}

/**
 * HTML-entity-encode arbitrary text headed for a v-html sink. Use to neutralize
 * agent-influenced strings interpolated straight into innerHTML — the
 * MarkdownViewer source body, the DeepGenome reference text fields — so any raw
 * `<img onerror>` / quote-breakout becomes inert text. Coerces non-strings.
 */
export function escapeHtml(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Scheme-check a URL that has ALREADY been escapeHtml-ed (the markdown source is
 * escaped in full before the link/img regexes run). Re-validates the scheme
 * WITHOUT re-escaping — re-escaping would double-encode a query-string `&amp;`.
 * A dangerous scheme needing entity obfuscation can't survive the up-front
 * escape (its leading `&` is now `&amp;`, which the browser also can't read as a
 * scheme), so only a literal `javascript:`/`data:`/`vbscript:` reaches here, and
 * the scheme allow-list rejects it. Returns the (escaped) URL when safe, else `#`.
 */
export function sanitizeEscapedHref(escapedUrl: string): string {
  if (!escapedUrl) return "#";
  return isSafeHref(escapedUrl) ? escapedUrl : "#";
}
