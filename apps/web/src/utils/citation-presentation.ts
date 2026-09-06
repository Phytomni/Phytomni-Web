import i18n from "@/locales";
import { safeHrefValue } from "@/utils/sanitize-markup";
import type { DisplayReference } from "@/utils/reference-renderer";

export interface CitationRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface CitationLink {
  label: string;
  href: string;
}

export interface CitationPresentation {
  runs: CitationRun[];
  links: CitationLink[];
}

const LINK_LABELS = new Set([
  "Article",
  "PubMed",
  "PubMed Central",
  "CAS",
  "ADS",
  "Google Scholar",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCitationHref(href: string): boolean {
  if (
    !safeHrefValue(href) ||
    !/^https?:\/\//i.test(href) ||
    href.includes("\\") ||
    /\p{Cc}/u.test(href)
  )
    return false;
  try {
    const url = new URL(href);
    return (
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !href.split("/")[2].includes("@") &&
      !/\p{Cc}/u.test(decodeURIComponent(href))
    );
  } catch {
    return false;
  }
}

/** Accept only canonical semantic data; never recover bibliography from metadata. */
export function decodeCitationPresentation(
  value: unknown
): CitationPresentation | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.runs) ||
    !Array.isArray(value.links)
  )
    return null;
  const runs: CitationRun[] = [];
  for (const run of value.runs) {
    if (
      !isRecord(run) ||
      typeof run.text !== "string" ||
      (run.bold !== undefined && typeof run.bold !== "boolean") ||
      (run.italic !== undefined && typeof run.italic !== "boolean")
    )
      return null;
    runs.push({
      text: run.text,
      ...(run.bold !== undefined ? { bold: run.bold } : {}),
      ...(run.italic !== undefined ? { italic: run.italic } : {}),
    });
  }
  if (!runs.some((run) => run.text.trim())) return null;
  const links: CitationLink[] = [];
  for (const link of value.links) {
    if (
      !isRecord(link) ||
      typeof link.label !== "string" ||
      !LINK_LABELS.has(link.label) ||
      typeof link.href !== "string" ||
      !isCitationHref(link.href)
    )
      return null;
    links.push({ label: link.label, href: link.href });
  }
  return { runs, links };
}

/** The canonical sentence excludes numbering and the separate link line. */
export function citationPlainText(presentation: CitationPresentation): string {
  return presentation.runs.map((run) => run.text).join("");
}

/** Serialize semantic emphasis, not bibliographic rules. */
export function citationMarkdown(presentation: CitationPresentation): string {
  const runs: CitationRun[] = [];
  for (const run of presentation.runs) {
    const previous = runs[runs.length - 1];
    if (
      previous &&
      Boolean(previous.bold) === Boolean(run.bold) &&
      Boolean(previous.italic) === Boolean(run.italic)
    )
      previous.text += run.text;
    else runs.push({ ...run });
  }
  let lineStart = true;
  const inline = (text: string) =>
    text.replace(/[\\`*_\[\]()<> &|~$]/g, (char) =>
      char === " " ? char : "\\" + char
    );
  const escape = (text: string): string =>
    text
      .split("\n")
      .map((line, index) => {
        if (index > 0) lineStart = true;
        let escaped = inline(line);
        if (lineStart && line) {
          if (line.startsWith(" ")) escaped = "&#32;" + inline(line.slice(1));
          else if (line.startsWith("\t"))
            escaped = "&#9;" + inline(line.slice(1));
          else if (/^\d{1,9}[.)](?:[ \t]|$)/.test(line))
            escaped = inline(line).replace(/^(\d+)(\\?)([.)])/, "$1\\$3");
          else if (/^[#\-+=]/.test(line)) escaped = "\\" + escaped;
        }
        if (line) lineStart = false;
        return escaped;
      })
      .join("\n");
  const fragments: { text: string; marker: string }[] = [];
  const append = (text: string, strength = 0) => {
    if (!text) return;
    const previous = fragments[fragments.length - 1];
    // Different adjacent styles must not merge into one delimiter run.
    const delimiter = previous?.marker.startsWith("*") ? "_" : "*";
    fragments.push({ text: escape(text), marker: delimiter.repeat(strength) });
  };
  for (const run of runs) {
    if (!run.bold && !run.italic) {
      append(run.text);
      continue;
    }
    // Emphasis is inline: close and reopen it across line/paragraph breaks.
    for (const line of run.text.split(/(\n)/)) {
      const core = line.trim();
      if (!core) append(line);
      else {
        const start = line.indexOf(core);
        append(line.slice(0, start));
        append(core, run.bold && run.italic ? 3 : run.bold ? 2 : 1);
        append(line.slice(start + core.length));
      }
    }
  }
  const ordinary = (char: string) => char && !/[\s\p{P}\p{S}]/u.test(char);
  for (let index = 0; index < fragments.length; index++) {
    const fragment = fragments[index];
    if (!fragment.marker) continue;
    // CommonMark flanking uses source characters, before entity decoding.
    // Encode the outside letter when a punctuation edge would stop emphasis.
    for (const side of [-1, 1]) {
      const neighbor = fragments[index + side];
      if (!neighbor || neighbor.marker) continue;
      const chars = Array.from(neighbor.text);
      const offset = side < 0 ? chars.length - 1 : 0;
      const content = Array.from(fragment.text);
      const inside = side < 0 ? 0 : content.length - 1;
      const edge = content[inside];
      if (
        ordinary(chars[offset]) &&
        (!ordinary(edge) || fragment.marker[0] === "_")
      ) {
        chars[offset] = `&#${chars[offset].codePointAt(0)};`;
        neighbor.text = chars.join("");
        // Underscores additionally forbid letter-to-letter intraword edges.
        if (fragment.marker[0] === "_" && ordinary(edge)) {
          content[inside] = `&#${edge.codePointAt(0)};`;
          fragment.text = content.join("");
        }
      }
    }
  }
  const sentence = fragments
    .map(({ text, marker }) => marker + text + marker)
    .join("");
  const links = presentation.links
    .map((link) => {
      const href = link.href
        .replace(/[<>"\s]/g, (char) => encodeURIComponent(char))
        .replace(/&/g, "&amp;");
      const destination = /[()]/.test(href) ? `<${href}>` : href;
      return `[${link.label}](${destination})`;
    })
    .join(" · ");
  return sentence + (links ? "\n\n" + links : "");
}

export function referenceListPlainText(
  rows: readonly DisplayReference[]
): string {
  return rows
    .map((row) => {
      if (!row.citation)
        return `${row.index}. ${i18n.global.t("chat.referenceUnavailable")}`;
      const links = row.citation.links
        .map((link) => `${link.label}: ${link.href}`)
        .join("\n");
      return (
        `${row.index}. ${citationPlainText(row.citation)}` +
        (links ? "\n" + links : "")
      );
    })
    .join("\n\n");
}

export function referenceListMarkdown(
  rows: readonly DisplayReference[]
): string {
  return rows
    .map((row) => {
      const text = row.citation
        ? citationMarkdown(row.citation)
        : i18n.global.t("chat.referenceUnavailable");
      const indent = " ".repeat(String(row.index).length + 2);
      return `${row.index}. ` + text.replace(/\n([^\n])/g, `\n${indent}$1`);
    })
    .join("\n\n");
}
