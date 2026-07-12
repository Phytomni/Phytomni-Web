import { describe, expect, it } from "vitest";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";
import {
  artifactKindForMessage,
  shouldAutoOpenArtifact,
} from "@/views/chat/utils/artifact-policy";
import type { ArtifactKind, ChatMessage } from "@/views/chat/types";

const ELIGIBLE_MESSAGE: ChatMessage = {
  role: "assistant",
  content: "Completed scientific result",
  id: "42",
};

const artifactByTool: Record<
  typeof CANONICAL_AGENT_TOOLS[number],
  ArtifactKind
> = {
  ChatAgent: null,
  KnowledgeAgent: "cited-report",
  DataAgent: null,
  ReviewAgent: "cited-report",
  BriefGeneAgent: "cited-report",
  AnalystAgent: null,
  DeepGenomeAgent: "deep-genome",
  InSilicoResearchAgent: "research",
  GeneNetworkAgent: null,
  DigitalDesignAgent: null,
};

const autoOpenByTool: Record<typeof CANONICAL_AGENT_TOOLS[number], boolean> = {
  ChatAgent: false,
  KnowledgeAgent: false,
  DataAgent: false,
  ReviewAgent: false,
  BriefGeneAgent: false,
  AnalystAgent: false,
  DeepGenomeAgent: true,
  InSilicoResearchAgent: true,
  GeneNetworkAgent: false,
  DigitalDesignAgent: false,
};

describe("artifact policy", () => {
  it.each(CANONICAL_AGENT_TOOLS)(
    "maps canonical %s results to the approved artifact kind",
    (toolName) => {
      const message = { ...ELIGIBLE_MESSAGE, tool_name: toolName };

      expect(artifactKindForMessage(message)).toBe(artifactByTool[toolName]);
      expect(shouldAutoOpenArtifact(message)).toBe(autoOpenByTool[toolName]);
    }
  );

  it.each([
    {
      name: "user message",
      message: {
        ...ELIGIBLE_MESSAGE,
        role: "user",
        tool_name: "DeepGenomeAgent",
      },
    },
    {
      name: "streaming placeholder",
      message: {
        ...ELIGIBLE_MESSAGE,
        streaming: true,
        tool_name: "DeepGenomeAgent",
      },
    },
    {
      name: "missing server id",
      message: {
        ...ELIGIBLE_MESSAGE,
        id: undefined,
        tool_name: "DeepGenomeAgent",
      },
    },
    {
      name: "empty server id",
      message: {
        ...ELIGIBLE_MESSAGE,
        id: "  ",
        tool_name: "DeepGenomeAgent",
      },
    },
    {
      name: "empty result",
      message: {
        ...ELIGIBLE_MESSAGE,
        content: "  ",
        tool_name: "DeepGenomeAgent",
      },
    },
    {
      name: "failed result without content",
      message: {
        ...ELIGIBLE_MESSAGE,
        content: "",
        status: "FAILED",
        tool_name: "InSilicoResearchAgent",
      },
    },
    {
      name: "Data table",
      message: {
        ...ELIGIBLE_MESSAGE,
        content: [{ gene: "AT1G01010" }],
        tableHeaders: [{ prop: "gene", label: "Gene" }],
        tool_name: "DataAgent",
      },
    },
    {
      name: "GeneNetwork image-only result",
      message: {
        ...ELIGIBLE_MESSAGE,
        content: "",
        download_path: "gene-network.png",
        tool_name: "GeneNetworkAgent",
      },
    },
    {
      name: "DigitalDesign image-only result",
      message: {
        ...ELIGIBLE_MESSAGE,
        content: "",
        download_path: "digital-design.png",
        tool_name: "DigitalDesignAgent",
      },
    },
  ])("rejects $name", ({ message }) => {
    expect(artifactKindForMessage(message)).toBeNull();
    expect(shouldAutoOpenArtifact(message)).toBe(false);
  });

  it.each([
    "DeepGenomeAgents",
    "DeepGenomeAgentLegacy",
    "InSilicoResearch",
    "KnowledgeAgent.v1",
    "BriefReviewAgent",
    "toString",
  ])("does not match non-canonical or substring tool name %s", (toolName) => {
    const message = { ...ELIGIBLE_MESSAGE, tool_name: toolName };

    expect(artifactKindForMessage(message)).toBeNull();
    expect(shouldAutoOpenArtifact(message)).toBe(false);
  });
});
