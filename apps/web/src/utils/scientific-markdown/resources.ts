import { safeHrefValue } from "@/utils/sanitize-markup";
import type {
  AuthorizedScientificResource,
  ScientificResourceKind,
} from "./types";

export function indexScientificResources(
  resources: readonly AuthorizedScientificResource[]
): ReadonlyMap<string, AuthorizedScientificResource> {
  const byHref = new Map<string, AuthorizedScientificResource>();
  const candidates = resources.map((resource) => ({
    resource,
    id: resource.id.trim(),
    href: resource.markdownHref.trim(),
  }));
  const idCounts = new Map<string, number>();
  const hrefCounts = new Map<string, number>();

  for (const { id, href } of candidates) {
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    if (href) hrefCounts.set(href, (hrefCounts.get(href) ?? 0) + 1);
  }

  for (const { resource, id, href } of candidates) {
    if (
      !id ||
      !href ||
      idCounts.get(id) !== 1 ||
      hrefCounts.get(href) !== 1 ||
      safeHrefValue(href) === null ||
      (resource.displayUrl && safeHrefValue(resource.displayUrl) === null)
    ) {
      continue;
    }
    byHref.set(href, { ...resource, id, markdownHref: href });
  }

  return byHref;
}

export function resourceFor<K extends ScientificResourceKind>(
  resources: ReadonlyMap<string, AuthorizedScientificResource>,
  href: string,
  kind: K
): (AuthorizedScientificResource & { kind: K }) | undefined {
  const resource = resources.get(href);
  return resource?.kind === kind
    ? (resource as AuthorizedScientificResource & { kind: K })
    : undefined;
}

export function unavailableResourceLabel(alt: unknown): string {
  const text = typeof alt === "string" ? alt.trim() : "";
  return text ? `${text} (resource unavailable)` : "Resource unavailable";
}
