import type {
  ConversationArtifactKind,
  ConversationArtifactLink,
} from "@/api/types";
import type {
  AuthorizedScientificResource,
  ScientificResourceKind,
} from "@/utils/scientific-markdown/types";

export function scientificKindForConversationArtifact(
  kind: ConversationArtifactKind
): ScientificResourceKind {
  switch (kind) {
    case "image":
      return "image";
    case "cif":
      return "cif";
    case "report":
      return "markdown";
    default:
      return "attachment";
  }
}

export function markdownMentionsArtifact(
  source: string,
  artifactName: string
): boolean {
  if (!source || !artifactName) return false;
  const escapedName = artifactName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`!?\[[^\]]*\]\(\s*${escapedName}\s*\)`).test(
    source
  );
}

export function authorizedResourcesFromConversationArtifacts(
  source: string,
  artifacts: readonly ConversationArtifactLink[],
  displayUrls: ReadonlyMap<string, string> = new Map()
): AuthorizedScientificResource[] {
  const resources: AuthorizedScientificResource[] = [];
  for (const artifact of artifacts) {
    if (!markdownMentionsArtifact(source, artifact.name)) continue;
    const resource: AuthorizedScientificResource = {
      id: artifact.id,
      name: artifact.name,
      kind: scientificKindForConversationArtifact(artifact.kind),
      markdownHref: artifact.name,
    };
    const displayUrl = displayUrls.get(artifact.id);
    if (displayUrl && (resource.kind === "image" || resource.kind === "cif")) {
      resource.displayUrl = displayUrl;
    }
    resources.push(resource);
  }
  return resources;
}
