import type { Plugin } from "unified";

export interface CitationOptions {
  namespace: string;
  referenceCount: number;
}

export interface ParsedCitation {
  display: string;
  indices: number[];
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface MdParent extends MdNode {
  children: MdNode[];
}

const MAX_CITATION_INDEX = 999;
const MAX_EXPANDED_INDICES = 100;
const CITATION_NAMESPACE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,255})?$/;
const PROTECTED_NODE_TYPES = new Set([
  "inlineCode",
  "code",
  "link",
  "image",
  "inlineMath",
  "math",
]);
const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function requireCitationNamespace(namespace: string): string {
  if (
    typeof namespace !== "string" ||
    !CITATION_NAMESPACE_PATTERN.test(namespace)
  ) {
    throw new TypeError("citation namespace is invalid");
  }
  return namespace;
}

function normalizeCitationSource(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[") || trimmed.endsWith("]")) {
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseCitationBody(source: string): ParsedCitation | null {
  const normalized = normalizeCitationSource(source);
  if (
    !normalized ||
    !/^\d{1,3}(?:\s*-\s*\d{1,3})?(?:\s*,\s*\d{1,3}(?:\s*-\s*\d{1,3})?)*$/.test(
      normalized
    )
  ) {
    return null;
  }
  const display = normalized.replace(/\s+/g, "");

  const indices: number[] = [];
  const seen = new Set<number>();
  for (const segment of display.split(",")) {
    const [startSource, endSource] = segment.split("-");
    const start = Number(startSource);
    const end = endSource === undefined ? start : Number(endSource);
    if (
      start < 1 ||
      end < start ||
      end > MAX_CITATION_INDEX ||
      end - start + 1 > MAX_EXPANDED_INDICES
    ) {
      return null;
    }
    for (let index = start; index <= end; index += 1) {
      if (seen.has(index) || indices.length >= MAX_EXPANDED_INDICES)
        return null;
      seen.add(index);
      indices.push(index);
    }
  }

  return { display, indices };
}

function isInteractiveCitation(
  parsed: ParsedCitation,
  options: CitationOptions
): boolean {
  return (
    Boolean(options.namespace) &&
    options.referenceCount > 0 &&
    parsed.indices.every((index) => index <= options.referenceCount)
  );
}

function citationNode(
  parsed: ParsedCitation,
  options: CitationOptions,
  display = `[${parsed.display}]`
): MdNode {
  const interactive = isInteractiveCitation(parsed, options);
  const hChildren = interactive
    ? [
        {
          type: "element",
          tagName: "a",
          properties: {
            href: `#${options.namespace}-ref-${parsed.indices[0]}`,
            className: ["scientific-citation__link"],
            ariaLabel: `Citation ${parsed.display}`,
          },
          children: [{ type: "text", value: display }],
        },
      ]
    : [{ type: "text", value: display }];

  return {
    type: "scientificCitation",
    data: {
      hName: "sup",
      hProperties: { className: ["scientific-citation"] },
      hChildren,
    },
  };
}

function rewriteSupTriplets(parent: MdParent, options: CitationOptions): void {
  let rawDepth = 0;
  for (let index = 0; index < parent.children.length; index += 1) {
    const node = parent.children[index];
    const boundary =
      node.type === "html" ? rawHtmlBoundary(node.value ?? "") : "other";
    if (boundary === "close") {
      rawDepth = Math.max(0, rawDepth - 1);
      continue;
    }

    if (rawDepth === 0 && index <= parent.children.length - 3) {
      const [open, body, close] = parent.children.slice(index, index + 3);
      if (
        open.type === "html" &&
        open.value === "<sup>" &&
        body.type === "text" &&
        close.type === "html" &&
        close.value === "</sup>"
      ) {
        const parsed = parseCitationBody(body.value?.trim() ?? "");
        if (parsed) {
          parent.children.splice(
            index,
            3,
            citationNode(parsed, options, body.value?.trim() ?? "")
          );
          continue;
        }
      }
    }

    if (boundary === "open") rawDepth += 1;
  }
}

function rewriteTextCitations(
  parent: MdParent,
  options: CitationOptions
): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const node = parent.children[index];
    if (
      node.type !== "text" ||
      !node.value ||
      node.data?.scientificRawHtml ||
      node.data?.scientificRawHtmlContent
    ) {
      continue;
    }

    const parts: MdNode[] = [];
    let offset = 0;
    const matcher =
      /\[(\d{1,3}(?:\s*-\s*\d{1,3})?(?:\s*,\s*\d{1,3}(?:\s*-\s*\d{1,3})?)*)\]/g;
    for (const match of node.value.matchAll(matcher)) {
      const matchIndex = match.index ?? 0;
      const parsed = parseCitationBody(match[0]);
      if (!parsed) continue;
      if (matchIndex > offset) {
        parts.push({
          type: "text",
          value: node.value.slice(offset, matchIndex),
        });
      }
      parts.push(citationNode(parsed, options));
      offset = matchIndex + match[0].length;
    }
    if (!parts.length) continue;
    if (offset < node.value.length) {
      parts.push({ type: "text", value: node.value.slice(offset) });
    }
    parent.children.splice(index, 1, ...parts);
    index += parts.length - 1;
  }
}

function rawHtmlBoundary(value: string): "open" | "close" | "other" {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<")) return "other";

  let cursor = 1;
  const closing = trimmed[cursor] === "/";
  if (closing) cursor += 1;
  if (!/[A-Za-z]/.test(trimmed[cursor] ?? "")) return "other";

  const nameStart = cursor;
  cursor += 1;
  while (/[A-Za-z0-9:-]/.test(trimmed[cursor] ?? "")) cursor += 1;
  const tagName = trimmed.slice(nameStart, cursor).toLowerCase();
  const nameEnd = cursor;
  let quote: '"' | "'" | null = null;

  for (; cursor < trimmed.length; cursor += 1) {
    const character = trimmed[cursor];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== ">") continue;
    if (trimmed.slice(cursor + 1).trim()) return "other";

    const suffix = trimmed.slice(nameEnd, cursor);
    if (closing) return /^\s*$/.test(suffix) ? "close" : "other";
    if (suffix.trimEnd().endsWith("/") || VOID_HTML_TAGS.has(tagName)) {
      return "other";
    }
    return "open";
  }

  return "other";
}

function rewriteHtmlNodes(parent: MdParent): void {
  let rawDepth = 0;
  for (const node of parent.children) {
    if (node.type === "html") {
      const boundary = rawHtmlBoundary(node.value ?? "");
      if (boundary === "close") rawDepth = Math.max(0, rawDepth - 1);
      node.type = "text";
      node.data = { ...node.data, scientificRawHtml: true };
      if (boundary === "open") rawDepth += 1;
      continue;
    }
    if (rawDepth > 0) {
      node.data = { ...node.data, scientificRawHtmlContent: true };
    }
  }
}

function visit(
  parent: MdParent,
  options: CitationOptions,
  protectedByAncestor = false
): void {
  const protectedHere =
    protectedByAncestor ||
    PROTECTED_NODE_TYPES.has(parent.type) ||
    parent.data?.scientificRawHtmlContent === true;
  if (!protectedHere) {
    rewriteSupTriplets(parent, options);
    rewriteHtmlNodes(parent);
    rewriteTextCitations(parent, options);
  }

  for (const child of parent.children) {
    if (child.children) visit(child as MdParent, options, protectedHere);
  }
}

export function transformScientificCitations(
  tree: MdNode,
  options: CitationOptions
): void {
  if (!options.namespace && options.referenceCount > 0) {
    throw new TypeError("citation namespace is invalid");
  }
  const validatedOptions = {
    ...options,
    namespace: options.namespace
      ? requireCitationNamespace(options.namespace)
      : "",
  };
  if (tree.children) visit(tree as MdParent, validatedOptions);
}

export const scientificCitationRemarkPlugin: Plugin<[CitationOptions]> =
  function (options) {
    return (tree) => transformScientificCitations(tree as MdNode, options);
  };
