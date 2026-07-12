/**
 * Deterministic Chat message fixtures shared by Vitest and the visual harness.
 * Bodies, doc_list rows, and block graphs must stay identical across both paths —
 * import these objects; do not copy markdown or reference payloads.
 */

import type { ChatMessage, ContentBlock } from "@/views/chat/types";

/** Exact Phase 3B message-state keys (stable registry contract). */
export const PHASE_3B_MESSAGE_KEYS = [
  "short-generic",
  "long-generic",
  "cited",
  "deep-genome",
  "table",
  "steps",
  "image",
  "streaming",
  "interleaved-streaming",
] as const;

export type Phase3BMessageKey = typeof PHASE_3B_MESSAGE_KEYS[number];

export function isPhase3BMessageKey(
  value: string | null | undefined
): value is Phase3BMessageKey {
  return (
    typeof value === "string" &&
    (PHASE_3B_MESSAGE_KEYS as readonly string[]).includes(value)
  );
}

/** Shared synthetic reference row — reused by cited + DeepGenome fixtures. */
export const FIXTURE_REFERENCE_DOC = {
  title: "Synthetic reference paper",
  au: "Synthetic Author",
  ti: "Plant genomics overview",
  so: "Nature Plants",
  py: 2024,
  dl: "https://doi.org/10.1000/synthetic.fixture",
} as const;

export const SHORT_GENERIC_MARKDOWN =
  "Synthetic short assistant reply about gene regulation.";

export const LONG_GENERIC_MARKDOWN = [
  "# Synthetic long assistant reply",
  "",
  "This fixture exercises a multi-paragraph Markdown body without citations.",
  "",
  "## Background",
  "",
  "Plant genomics pipelines combine sequence retrieval, annotation, and",
  "comparative analysis. The harness must render this body through the",
  "generic MarkdownViewer branch — never CitedAnswer or DeepGenome.",
  "",
  "## Notes",
  "",
  "- Item one: allele frequency",
  "- Item two: haplotype blocks",
  "- Item three: expression QTL mapping",
  "",
  "Closing sentence keeps the fixture deterministic and network-free.",
].join("\n");

export const CITED_MARKDOWN =
  "Synthetic cited answer cites the literature [1] for the claim.";

export const DEEP_GENOME_MARKDOWN = [
  "## Synthetic DeepGenome result",
  "",
  "Gene locus summary with citation [1].",
  "",
  "![fig](https://example.com/synthetic-deep-genome.png)",
].join("\n");

const mdBlock = (text: string): ContentBlock => ({
  type: "markdown",
  authority: "web",
  text,
});

const stepBlock = (label: string): ContentBlock => ({
  type: "step",
  authority: "web",
  label,
});

const toolBlock = (toolName: string, count = 2): ContentBlock => ({
  type: "tool",
  authority: "web",
  toolName,
  count,
});

/** User prompt paired with each Phase 3B assistant fixture. */
export const PHASE_3B_USER_PROMPT: ChatMessage = {
  id: "fixture-msg-user-phase3b",
  role: "user",
  content: "Synthetic fixture user question about plant genomics.",
};

export const MESSAGE_SHORT_GENERIC: ChatMessage = {
  id: "fixture-msg-short-generic",
  role: "assistant",
  content: SHORT_GENERIC_MARKDOWN,
  tool_name: "ChatAgent",
};

export const MESSAGE_LONG_GENERIC: ChatMessage = {
  id: "fixture-msg-long-generic",
  role: "assistant",
  content: LONG_GENERIC_MARKDOWN,
  tool_name: "ChatAgent",
};

export const MESSAGE_CITED: ChatMessage = {
  id: "fixture-msg-cited",
  role: "assistant",
  content: CITED_MARKDOWN,
  tool_name: "KnowledgeAgent",
  doc_list: [{ ...FIXTURE_REFERENCE_DOC }],
};

export const MESSAGE_DEEP_GENOME: ChatMessage = {
  id: "fixture-msg-deep-genome",
  role: "assistant",
  content: DEEP_GENOME_MARKDOWN,
  tool_name: "DeepGenomeAgent",
  doc_list: [{ ...FIXTURE_REFERENCE_DOC }],
};

export const MESSAGE_TABLE: ChatMessage = {
  id: "fixture-msg-table",
  role: "assistant",
  content: [{ gene: "Os01g01010", trait: "yield" }],
  tableHeaders: [
    { prop: "gene", label: "Gene" },
    { prop: "trait", label: "Trait" },
  ],
  tool_name: "DataAgent",
};

export const MESSAGE_STEPS: ChatMessage = {
  id: "fixture-msg-steps",
  role: "assistant",
  content: "Synthetic final answer after legacy steps.",
  steps: ["retrieve literature", "summarize findings"],
  tool_name: "ChatAgent",
};

/** GeneNetwork image family (DigitalDesign shares the same visual branch chrome). */
export const MESSAGE_IMAGE: ChatMessage = {
  id: "fixture-msg-image",
  role: "assistant",
  content: "",
  tool_name: "GeneNetworkAgent",
};

export const MESSAGE_STREAMING: ChatMessage = {
  id: "fixture-msg-streaming",
  role: "assistant",
  content: "",
  streaming: true,
  blocks: [mdBlock("Streaming markdown with literal citation marker [1].")],
  tool_name: "ChatAgent",
};

/** Interleaved tool/step/markdown blocks — still StreamMessage when in the bubble. */
export const MESSAGE_INTERLEAVED_STREAMING: ChatMessage = {
  id: "fixture-msg-interleaved-streaming",
  role: "assistant",
  content: "",
  streaming: true,
  blocks: [
    stepBlock("plan"),
    toolBlock("search_literature", 3),
    mdBlock("Interleaved streaming body mentions [2] without a namespace."),
  ],
  tool_name: "ChatAgent",
};

/**
 * Characterizes the streaming citation gap for a follow-up fix:
 * useStreamMessage copies phyto.references → doc_list, but non-empty blocks keep
 * the StreamMessage branch (no ns, no reference rows). Not a visual registry key.
 */
export const MESSAGE_STREAM_REFS_CAPTURED: ChatMessage = {
  id: "fixture-msg-stream-refs-captured",
  role: "assistant",
  content: "",
  streaming: false,
  blocks: [mdBlock("Finalized stream still shows [1] literally.")],
  doc_list: [{ ...FIXTURE_REFERENCE_DOC }],
  tool_name: "ChatAgent",
};

export const MESSAGE_FIXTURES: Record<Phase3BMessageKey, ChatMessage> = {
  "short-generic": MESSAGE_SHORT_GENERIC,
  "long-generic": MESSAGE_LONG_GENERIC,
  cited: MESSAGE_CITED,
  "deep-genome": MESSAGE_DEEP_GENOME,
  table: MESSAGE_TABLE,
  steps: MESSAGE_STEPS,
  image: MESSAGE_IMAGE,
  streaming: MESSAGE_STREAMING,
  "interleaved-streaming": MESSAGE_INTERLEAVED_STREAMING,
};

/** User + specialized assistant transcript for a Phase 3B visual key. */
export function buildPhase3BTranscript(key: Phase3BMessageKey): ChatMessage[] {
  return [
    { ...PHASE_3B_USER_PROMPT, id: `fixture-msg-user-${key}` },
    MESSAGE_FIXTURES[key],
  ];
}

/** Tiny SVG data URL — no network for the GeneNetwork image branch. */
export const FIXTURE_GENE_NETWORK_IMAGE_DATA_URL =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect fill="#9ec5fe" width="48" height="48"/></svg>'
  );
