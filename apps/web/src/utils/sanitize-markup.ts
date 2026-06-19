// XSS 防护:DeepGenomeResultViewer 的 processInlineMarkdown 会把 deep_genome
// agent(经 Bot 中转)markdown 里的 <a> 标签先 escapeHtml 成实体、再用正则
// "复活"成裸 <a>,最终经 v-html 注入 DOM。复活时属性串是原样透传的,所以恶意
// agent 输出或被投毒的 RAG 语料能在 anchor 上塞入事件处理器或危险协议 href ——
// v-html(innerHTML)会让它们在点击甚至悬停时执行,而本应用 token 存于非
// HttpOnly cookie,document.cookie 可被窃。
//
// 清洗用「属性名白名单」而非「on* 黑名单」:HTML 不要求属性间靠空白分隔——引号
// 闭合后可紧跟下一个属性(如 href="x"onmouseover="y" 是两个属性),靠 \son 边界
// 的黑名单正则会被这种写法绕过。这里正确 tokenize 出 name=value 对,只保留显式
// 白名单中的属性名,其余(含全部 on*、style、formaction 等)一律丢弃;href 再做
// 协议白名单校验。只需清洗属性:正文从不被反转义(escapeHtml 后保持实体),唯一
// 被复活成裸 HTML 的就是 <a> 的属性串,故这是该路径上唯一的注入原语。

// 允许保留的属性名(小写比较)。其余一律丢弃。
const ALLOWED_ATTRS = new Set([
  "href",
  "title",
  "target",
  "rel",
  "class",
  "download",
]);

// href 允许的协议;无协议(相对路径 / #锚点 / 绝对路径)默认放行。
const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);

interface Attr {
  name: string;
  value: string | null; // null = 布尔属性(如 download)
}

const isSpace = (c: string): boolean =>
  c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

// 正确 tokenize:属性可由空白分隔,也可紧跟在上一属性引号值闭合之后。
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
      i++; // 跳过孤立的 = / > 等,保证推进
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
        i++; // 跳过闭合引号
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
    .replace(/&#x([0-9a-f]+);?/gi, (m, hex) => fromCp(parseInt(hex, 16), m))
    .replace(/&#(\d+);?/g, (m, dec) => fromCp(parseInt(dec, 10), m))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n");
}

// 协议白名单:先解码实体、剥控制/空白字符再判 scheme,挡掉 java&Tab;script: 之类混淆。
// 用 codepoint 过滤而非含控制字符的正则(后者触发 eslint no-control-regex):
// 剥掉 <= 0x20 的控制字符与空白,以及 0x7f–0xa0(DEL / C1 控制 / NBSP)。
function isSafeHref(rawValue: string): boolean {
  const stripped = Array.from(decodeEntities(rawValue))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x20 && !(code >= 0x7f && code <= 0xa0);
    })
    .join("");
  const schemeMatch = stripped.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!schemeMatch) return true; // 无 scheme:相对路径 / #锚点 / 绝对路径
  return SAFE_SCHEMES.has(schemeMatch[1].toLowerCase());
}

// 重新输出到 v-html 前转义属性值,防止属性逃逸。
function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 清洗将被注入 v-html 的 <a> 标签属性串。
 *
 * @param attributes `<a` 与 `>` 之间的原始属性串(已反转义为裸字符)。
 * @returns 清洗后的属性串:仅保留白名单属性,危险协议 href 中和为 `#`。
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
      kept.push(name); // 布尔属性,如 download
    } else {
      kept.push(`${name}="${escapeAttrValue(attr.value)}"`);
    }
  }

  return kept.join(" ");
}

/**
 * 校验单个 href URL,用于把 URL 直接插进固定 `<a href="...">` 的场景
 * (doi / pmid / .md 链接)——这些点不透传任意属性,但 URL 本身可能携带危险
 * 协议(如 `[x](javascript:alert(1)//.md)` 借 `.md` 后缀混进 javascript:)。
 *
 * @param url 待插入 href 的原始 URL。
 * @returns 协议在白名单内则返回转义后的 URL(可安全放进 v-html 的属性),
 *          否则返回 `"#"`。
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
export function escapeHtml(text: string): string {
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
