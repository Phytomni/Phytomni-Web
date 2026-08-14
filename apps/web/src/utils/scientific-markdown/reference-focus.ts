import { requireCitationNamespace } from "@/utils/scientific-markdown/citations";

export function focusReferenceRows(options: {
  root: HTMLElement;
  namespace: string;
  indices: readonly number[];
}): boolean {
  const safeNamespace = requireCitationNamespace(options.namespace);
  if (
    options.indices.length === 0 ||
    options.indices.some((index) => !Number.isInteger(index) || index < 1) ||
    new Set(options.indices).size !== options.indices.length
  ) {
    return false;
  }

  const rowsById = new Map(
    Array.from(options.root.querySelectorAll<HTMLElement>("[id]")).map(
      (row) => [row.id, row]
    )
  );
  const rows = options.indices.map((index) =>
    rowsById.get(`${safeNamespace}-ref-${String(index)}`)
  );
  if (rows.some((row) => row === undefined)) return false;

  options.root
    .querySelectorAll(".is-citation-target")
    .forEach((row) => row.classList.remove("is-citation-target"));
  rows.forEach((row) => row?.classList.add("is-citation-target"));
  rows[0]?.scrollIntoView?.({ block: "nearest" });
  rows[0]?.focus();
  return true;
}
