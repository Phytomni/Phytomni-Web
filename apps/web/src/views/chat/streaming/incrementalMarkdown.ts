import { escapeHtml } from "@/utils/sanitize-markup";
import { processInlineMarkdown } from "@/utils/markdown-inline";

// renderStreamingMarkdown turns a partial streaming markdown buffer into a
// safe HTML string for v-html. It repairs only DANGLING inline markers so the
// fragment is well-formed BEFORE sanitization — the v-html invariant forbids
// sanitizing an unterminated fragment. The pipeline stays escapeHtml ->
// processInlineMarkdown (the load-bearing contract; processInlineMarkdown does
// not self-escape). Repair is applied to the RAW text before escaping so the
// closing marker participates in the same markdown pass.
//
// Citation ns: processInlineMarkdown rewrites [N] into <a href="#<ns>-ref-N">,
// and with an EMPTY ns it emits bare #ref-N — a dead link, since every real
// reference row id is namespaced (m<i>-ref-N). gateCitations mirrors the
// linkifyCitations scope gate: no ns ⇒ [N] stays literal text. P1 cited
// streaming passes the page-unique per-message ns ('m' + index, matching the
// blocking branches in index.vue).
export function renderStreamingMarkdown(text: string, ns = ""): string {
  const repaired = repairDanglingInline(text);
  const html = processInlineMarkdown(escapeHtml(repaired), ns);
  return ns ? html : gateCitations(html);
}

// gateCitations unwraps the exact bare-#ref-N anchors processInlineMarkdown
// emits on its empty-ns back-compat path (that fallback is test-locked in
// markdown-inline.spec.ts, so we gate here instead of changing the shared
// util). escapeHtml upstream guarantees agent text cannot forge this shape.
function gateCitations(html: string): string {
  return html.replace(
    /<a href="#ref-(\d{1,3})" style="display: inline-block;">\[(\d{1,3})\]<\/a>/g,
    "[$2]"
  );
}

// repairDanglingInline closes an unbalanced **bold**, *italic*, or `code`
// marker at the tail of a partial buffer. It is context-aware: an open inline
// code run swallows everything to end-of-buffer, so bold/italic inside it are
// left untouched (closing them would corrupt the code span).
function repairDanglingInline(text: string): string {
  // 1. Inline code: odd number of backticks ⇒ one is open. Close it and stop;
  //    markers inside code are literal, so no bold/italic repair afterwards.
  const backticks = (text.match(/`/g) || []).length;
  if (backticks % 2 === 1) {
    return text + "`";
  }
  let out = text;
  // 2. Bold: count "**" pairs; an odd count means one dangling opener.
  const boldMarkers = (out.match(/\*\*/g) || []).length;
  if (boldMarkers % 2 === 1) {
    out = out + "**";
  }
  // 3. Italic: count single "*" not part of "**". Approximate by stripping
  //    "**" first, then counting remaining "*".
  const singles = (out.replace(/\*\*/g, "").match(/\*/g) || []).length;
  if (singles % 2 === 1) {
    out = out + "*";
  }
  return out;
}
