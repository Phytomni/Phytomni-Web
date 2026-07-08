import { escapeHtml } from "@/utils/sanitize-markup";
import { processInlineMarkdown } from "@/utils/markdown-inline";

// Compares the current escape-first render pipeline against a candidate renderer
// for one payload, classifying the candidate as identical, stricter, or looser.
// "looser" — the candidate emits executable markup (a tag/handler) the current
// pipeline neutralizes — is the security signal that adopting the candidate
// would weaken the v-html boundary. Detection is structural: strip to the set of
// live tags each side emits and compare.
export type DiffVerdict = "identical" | "candidate-stricter" | "candidate-looser";

export interface SanitizerDiff {
  payload: string;
  current: string;
  candidate: string;
  verdict: DiffVerdict;
}

// The tags/handlers whose presence means "live, potentially executable markup".
const liveMarkup = /<(script|img|svg|iframe|object|embed)\b|on\w+\s*=|javascript:/gi;

function liveHits(html: string): number {
  return (html.match(liveMarkup) || []).length;
}

export function diffSanitizers(
  payload: string,
  renderCandidate: (md: string) => string,
): SanitizerDiff {
  const current = processInlineMarkdown(escapeHtml(payload), "");
  const candidate = renderCandidate(payload);
  const cur = liveHits(current);
  const cand = liveHits(candidate);
  let verdict: DiffVerdict = "identical";
  if (cand > cur) verdict = "candidate-looser";
  else if (cand < cur) verdict = "candidate-stricter";
  return { payload, current, candidate, verdict };
}
