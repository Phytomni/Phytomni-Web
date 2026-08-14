export function focusReferenceRows(options: {
  root: HTMLElement;
  namespace: string;
  indices: readonly number[];
}): boolean {
  const safeNamespace = options.namespace.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeNamespace || options.indices.length === 0) return false;

  const rows = options.indices.map((index) =>
    options.root.querySelector<HTMLElement>(
      `#${safeNamespace}-ref-${String(index)}`
    )
  );
  if (rows.some((row) => row === null)) return false;

  options.root
    .querySelectorAll(".is-citation-target")
    .forEach((row) => row.classList.remove("is-citation-target"));
  rows.forEach((row) => row?.classList.add("is-citation-target"));
  rows[0]?.scrollIntoView({ block: "nearest" });
  rows[0]?.focus();
  return true;
}
