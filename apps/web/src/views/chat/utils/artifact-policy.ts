import type { ArtifactKind, ChatMessage } from "../types";
import type { RemoteAgentTool } from "@/constants/agents";

/** Remote analysis artifacts share the result-archive renderer. */
export const REMOTE_AGENT_ARTIFACT_POLICIES: Record<
  RemoteAgentTool,
  { kind: ArtifactKind; autoOpen: boolean }
> = {
  AnalystAgent: { kind: "research", autoOpen: false },
  InSilicoResearchAgent: { kind: "research", autoOpen: true },
  DigitalDesignAgent: { kind: "research", autoOpen: false },
  GeneNetworkAgent: { kind: "research", autoOpen: false },
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
  BriefGeneAgent: { kind: "cited-report", autoOpen: false },
  ...REMOTE_AGENT_ARTIFACT_POLICIES,
};

type ArtifactPolicyMessage = Pick<
  ChatMessage,
  | "role"
  | "content"
  | "id"
  | "streaming"
  | "tool_name"
  | "status"
  | "artifacts"
  | "delivery"
>;

const REMOTE_ANALYSIS_TOOLS = new Set([
  "AnalystAgent",
  "InSilicoResearchAgent",
  "DigitalDesignAgent",
  "GeneNetworkAgent",
]);

const DEEP_GENOME_PLACEHOLDER_PATTERNS = [
  /^Server task created:\s*.*$/iu,
  /^Loading file content\.\.\.?$/iu,
  /^File content is empty or failed to load$/iu,
  /^Failed to load file/iu,
] as const;

export function isDeepGenomeTransportPlaceholder(
  content: ChatMessage["content"]
): boolean {
  if (typeof content !== "string") return false;
  const normalized = content.trim();
  return (
    normalized !== "" &&
    DEEP_GENOME_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

export function isMeaningfulDeepGenomeReport(
  content: ChatMessage["content"]
): boolean {
  if (typeof content !== "string") return false;
  const normalized = content.trim();
  return normalized !== "" && !isDeepGenomeTransportPlaceholder(normalized);
}

function isArtifactMessageEligible(message: ArtifactPolicyMessage): boolean {
  const hasResultContent =
    typeof message.content === "string" && message.content.trim() !== "";
  const hasResultDelivery =
    (message.artifacts?.length ?? 0) > 0 || message.delivery != null;
  return !(
    message.role !== "assistant" ||
    message.streaming === true ||
    message.id == null ||
    String(message.id).trim() === "" ||
    (!hasResultContent && !hasResultDelivery)
  );
}

function isSucceeded(message: ArtifactPolicyMessage): boolean {
  return (
    String(message.status || "")
      .trim()
      .toUpperCase() === "SUCCEEDED"
  );
}

export function isCompletedResearchMessage(
  message: ArtifactPolicyMessage
): boolean {
  return (
    isArtifactMessageEligible(message) &&
    message.tool_name === "InSilicoResearchAgent" &&
    isSucceeded(message)
  );
}

export function artifactKindForMessage(
  message: ArtifactPolicyMessage
): ArtifactKind {
  if (!isArtifactMessageEligible(message)) return null;
  if (
    message.tool_name &&
    REMOTE_ANALYSIS_TOOLS.has(message.tool_name) &&
    !isSucceeded(message)
  ) {
    return null;
  }
  if (
    message.tool_name === "DeepGenomeAgent" &&
    !isCompletedDeepGenomeMessage(message)
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

export function isCompletedDeepGenomeMessage(
  message: ArtifactPolicyMessage
): boolean {
  return (
    isArtifactMessageEligible(message) &&
    message.tool_name === "DeepGenomeAgent" &&
    String(message.status || "")
      .trim()
      .toUpperCase() === "SUCCEEDED" &&
    isMeaningfulDeepGenomeReport(message.content)
  );
}
