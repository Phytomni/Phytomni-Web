import { escapeHtml, sanitizeHref } from "@/utils/sanitize-markup";

function renderInline(text: string): string {
  const escaped = escapeHtml(text);
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // sanitizeHref returns "#" for unsafe schemes (never empty) — still emit <a href="#">.
  return withBold.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const href = sanitizeHref(url);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
}

export function renderLegalMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.trim() === "---") {
      out.push("<hr />");
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(`<li>${renderInline(lines[i].slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("- ") &&
      lines[i].trim() !== "---"
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length === 0) {
      // Unmatched #-prefixed or otherwise blocked line — emit as paragraph and advance
      out.push(`<p>${renderInline(lines[i])}</p>`);
      i++;
      continue;
    }
    out.push(`<p>${renderInline(para.join(" "))}</p>`);
  }
  return out.join("");
}
