import type { ArtifactKind, ChatMessage } from "../types";
import type { RemoteAgentTool } from "@/constants/agents";

/** Remote product artifacts stay explicit until each surface has a renderer. */
export const REMOTE_AGENT_ARTIFACT_POLICIES: Record<
  RemoteAgentTool,
  { kind: ArtifactKind; autoOpen: boolean }
> = {
  InSilicoResearchAgent: { kind: "research", autoOpen: true },
  DigitalDesignAgent: { kind: null, autoOpen: false },
  GeneNetworkAgent: { kind: null, autoOpen: false },
};

/**
 * Chat artifact behavior is intentionally independent from product-route
 * liveness: existing InSilicoResearch chat rows retain their tested
 * research-artifact behavior while dark product routes remain unavailable.
 */
const ARTIFACT_POLICY_BY_TOOL: Readonly<
  Record<string, { kind: ArtifactKind; autoOpen: boolean }>
> = {
  DeepGenomeAgent: { kind: "deep-genome", autoOpen: true },
  KnowledgeAgent: { kind: "cited-report", autoOpen: false },
  ReviewAgent: { kind: "cited-report", autoOpen: false },
  BriefGeneAgent: { kind: "cited-report", autoOpen: false },
  ...REMOTE_AGENT_ARTIFACT_POLICIES,
};

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
    ? (ARTIFACT_POLICY_BY_TOOL[message.tool_name]?.kind ?? null)
    : null;
}

export function shouldAutoOpenArtifact(
  message: ArtifactPolicyMessage
): boolean {
  return (
    artifactKindForMessage(message) !== null &&
    !!message.tool_name &&
    ARTIFACT_POLICY_BY_TOOL[message.tool_name]?.autoOpen === true
  );
}
