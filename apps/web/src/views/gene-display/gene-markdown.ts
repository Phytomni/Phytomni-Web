// buildDisplayContent prepares raw gene-example markdown for DeepGenomeResultViewer.
// It strips the trailing "--- DOC TITLES ---" reference block (references are
// parsed separately). Image URLs are already backend /api/v1/gene-images/ paths,
// so there is deliberately NO client-side image rewriting here.
const DOC_TITLES_SEPARATOR = "--- DOC TITLES ---";

export function buildDisplayContent(raw: string): string {
  if (!raw) return "";
  const idx = raw.indexOf(DOC_TITLES_SEPARATOR);
  const mainContent = idx === -1 ? raw : raw.substring(0, idx).trim();
  return mainContent.replace(/\r\n/g, "\n");
}
