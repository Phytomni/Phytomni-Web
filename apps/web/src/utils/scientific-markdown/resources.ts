import { safeHrefValue } from "@/utils/sanitize-markup";
import type {
  AuthorizedScientificResource,
  ScientificResourceKind,
} from "./types";

export function indexScientificResources(
  resources: readonly AuthorizedScientificResource[]
): ReadonlyMap<string, AuthorizedScientificResource> {
  const byHref = new Map<string, AuthorizedScientificResource>();
  const ids = new Set<string>();

  for (const resource of resources) {
    const id = resource.id.trim();
    const href = resource.markdownHref.trim();
    if (
      !id ||
      !href ||
      ids.has(id) ||
      byHref.has(href) ||
      safeHrefValue(href) === null ||
      (resource.displayUrl && safeHrefValue(resource.displayUrl) === null)
    ) {
      continue;
    }
    ids.add(id);
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
