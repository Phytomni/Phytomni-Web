import type { ArtifactKind, ChatMessage } from "../types";

const ARTIFACT_KIND_BY_TOOL: ReadonlyMap<
  string,
  NonNullable<ArtifactKind>
> = new Map([
  ["DeepGenomeAgent", "deep-genome"],
  ["InSilicoResearchAgent", "research"],
  ["KnowledgeAgent", "cited-report"],
  ["ReviewAgent", "cited-report"],
  ["BriefGeneAgent", "cited-report"],
]);

const AUTO_OPEN_TOOLS: ReadonlySet<string> = new Set([
  "DeepGenomeAgent",
  "InSilicoResearchAgent",
]);

type ArtifactPolicyMessage = Pick<
  ChatMessage,
  "role" | "content" | "id" | "streaming" | "tool_name"
>;

export function artifactKindForMessage(
  message: ArtifactPolicyMessage
): ArtifactKind {
  if (
    message.role !== "assistant" ||
    message.streaming === true ||
    message.id == null ||
    String(message.id).trim() === "" ||
    typeof message.content !== "string" ||
    message.content.trim() === ""
  ) {
    return null;
  }

  return message.tool_name
    ? ARTIFACT_KIND_BY_TOOL.get(message.tool_name) ?? null
    : null;
}

export function shouldAutoOpenArtifact(
  message: ArtifactPolicyMessage
): boolean {
  return (
    artifactKindForMessage(message) !== null &&
    !!message.tool_name &&
    AUTO_OPEN_TOOLS.has(message.tool_name)
  );
}
