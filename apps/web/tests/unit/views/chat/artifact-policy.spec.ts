import { describe, expect, it } from "vitest";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";
import {
  artifactIdentityForMessage,
  artifactPresentationForMessage,
  artifactKindForMessage,
  isCompletedDeepGenomeMessage,
  isCompletedResearchMessage,
  isDeepGenomeTransportPlaceholder,
  isMeaningfulDeepGenomeReport,
} from "@/views/chat/utils/artifact-policy";
import type { ArtifactKind, ChatMessage } from "@/views/chat/types";
import {
  initReducerState,
  reduceAGUIEvent,
} from "@/views/chat/streaming/eventReducer";

const ELIGIBLE_MESSAGE: ChatMessage = {
  role: "assistant",
  content: "Completed scientific result",
  id: "42",
};

function reducedMarkdownBlocks(...deltas: string[]): ChatMessage["blocks"] {
  let state = initReducerState();
  for (const delta of deltas) {
    state = reduceAGUIEvent(state, {
      type: "TextMessageContent",
      data: { delta },
    });
  }
  return state.blocks;
}

function completedMarkdownBlocks(...deltas: string[]): ChatMessage["blocks"] {
  let state = initReducerState();
  for (const delta of deltas) {
    state = reduceAGUIEvent(state, {
      type: "TextMessageContent",
      data: { delta },
    });
  }
  state = reduceAGUIEvent(state, { type: "TextMessageEnd", data: {} });
  return state.blocks;
}

const artifactByTool: Record<
  (typeof CANONICAL_AGENT_TOOLS)[number],
  ArtifactKind
> = {
  ChatAgent: null,
  KnowledgeAgent: "cited-report",
  DataAgent: null,
  ReviewAgent: "cited-report",
  BriefGeneAgent: "cited-report",
  AnalystAgent: "research",
  DeepGenomeAgent: "deep-genome",
  InSilicoResearchAgent: "research",
  GeneNetworkAgent: "research",
  DigitalDesignAgent: "research",
};

describe("artifact policy", () => {
  const reportTools = [
    "KnowledgeAgent",
    "BriefGeneAgent",
    "ReviewAgent",
    "AnalystAgent",
    "DeepGenomeAgent",
    "InSilicoResearchAgent",
    "DigitalDesignAgent",
    "GeneNetworkAgent",
  ] as const;

  const reportMessage = (
    tool_name: string,
    overrides: Partial<ChatMessage> = {}
  ): ChatMessage => ({
    ...ELIGIBLE_MESSAGE,
    id: `${tool_name}-42`,
    tool_name,
    status: "FAILED",
    ...overrides,
  });

  it.each(reportTools)(
    "%s selects final, intermediate, then message content without lifecycle gates",
    (tool_name) => {
      const final = "  # Final report\n\nPreserve bytes.  ";
      const intermediate = "# Intermediate report";
      const message = "# Message report";
      expect(
        artifactPresentationForMessage(
          reportMessage(tool_name, {
            content: message,
            botLifecycle: {
              runId: "run-42",
              status: "FAILED",
              reportRevision: 3,
              visibleReport: final,
              finalReport: final,
              intermediateReport: intermediate,
              degraded: true,
              failures: ["analysis failed"],
              artifacts: [],
            },
          })
        )
      ).toMatchObject({
        kind:
          tool_name === "DeepGenomeAgent"
            ? "deep-genome"
            : tool_name === "AnalystAgent" ||
                tool_name === "InSilicoResearchAgent" ||
                tool_name === "DigitalDesignAgent" ||
                tool_name === "GeneNetworkAgent"
              ? "research"
              : "cited-report",
        report: final,
        source: "final",
        identity: `message:${tool_name}-42`,
      });

      expect(
        artifactPresentationForMessage(
          reportMessage(tool_name, {
            content: message,
            botProjection: {
              runId: "run-42",
              agent: tool_name,
              status: "INPUT_REQUIRED",
              workStage: null,
              reportPresentation: true,
              reportStage: "intermediate",
              reportCompleteness: "partial",
              reportRevision: 2,
              reportUpdatedAt: null,
              intermediateReport: intermediate,
              finalReport: "",
              progress: {
                completed: 0,
                total: 1,
                failed: 0,
                pending: 1,
                briefGeneStatus: "",
              },
              degraded: false,
              degradedReason: null,
              failures: [],
              artifacts: [],
              resultArchiveV1: false,
              requestId: null,
              trackingDegraded: false,
            },
          })
        )?.report
      ).toBe(intermediate);

      expect(
        artifactPresentationForMessage(
          reportMessage(tool_name, { content: message })
        )?.report
      ).toBe(message);
    }
  );

  it.each([
    "RUNNING",
    "INPUT_REQUIRED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "TIMED_OUT",
  ])(
    "keeps a substantive %s report eligible for every report tool",
    (status) => {
      for (const tool_name of reportTools) {
        const presentation = artifactPresentationForMessage(
          reportMessage(tool_name, {
            status,
            content:
              tool_name === "DeepGenomeAgent"
                ? "# Partial scientific report\n\nThe run retained evidence."
                : "# Retained report\n\nThe run retained evidence.",
          })
        );
        expect(presentation?.report).toContain("retained");
      }
    }
  );

  it("maps Review to cited-report and leaves Chat/Data inline", () => {
    expect(
      artifactPresentationForMessage(reportMessage("ReviewAgent"))?.kind
    ).toBe("cited-report");
    expect(
      artifactPresentationForMessage(
        reportMessage("ChatAgent", { content: "# Chat Markdown" })
      )
    ).toBeNull();
    expect(
      artifactPresentationForMessage(
        reportMessage("DataAgent", { content: "# Data Markdown" })
      )
    ).toBeNull();
  });

  it.each(["KnowledgeAgent", "BriefGeneAgent"] as const)(
    "waits for a completed %s stream before making its report View-eligible",
    (tool_name) => {
      const content = `# ${tool_name} report\n\nAccumulated scientific evidence.`;
      const streaming = reportMessage(tool_name, {
        id: undefined,
        streaming: true,
        streamPresentationKey: `turn-${tool_name}`,
        content: "",
        blocks: reducedMarkdownBlocks(content),
      });
      const completed = {
        ...streaming,
        id: `row-${tool_name}`,
        streaming: false,
      };

      const expected = {
        kind: "cited-report",
        report: content,
        source: "message",
        identity: `stream:turn-${tool_name}`,
      };
      expect(artifactPresentationForMessage(streaming)).toBeNull();
      expect(artifactPresentationForMessage(completed)).toEqual(expected);
    }
  );

  it.each(["run-error", "interrupted", "cancelled"] as const)(
    "rejects an incomplete Markdown fragment after %s",
    (streamTerminalFailure) => {
      expect(
        artifactPresentationForMessage(
          reportMessage("KnowledgeAgent", {
            content: "Localized stream failure copy",
            streaming: false,
            streamPresentationKey: `fragment-${streamTerminalFailure}`,
            streamTerminalFailure,
            blocks: reducedMarkdownBlocks("#"),
          })
        )
      ).toBeNull();
    }
  );

  it("keeps a completed short stream report without a length threshold", () => {
    expect(
      artifactPresentationForMessage(
        reportMessage("KnowledgeAgent", {
          content: "",
          streaming: false,
          streamPresentationKey: "short-completed",
          blocks: completedMarkdownBlocks("OK"),
        })
      )
    ).toEqual({
      kind: "cited-report",
      report: "OK",
      source: "message",
      identity: "stream:short-completed",
    });
  });

  it.each(["ChatAgent", "DataAgent"] as const)(
    "keeps a substantive streaming %s response inline",
    (tool_name) => {
      expect(
        artifactPresentationForMessage(
          reportMessage(tool_name, {
            streaming: true,
            streamPresentationKey: `turn-${tool_name}`,
            content: "",
            blocks: reducedMarkdownBlocks(
              "# Direct response\n\nSubstantive inline content."
            ),
          })
        )
      ).toBeNull();
    }
  );

  it("ignores status-only Markdown and non-Markdown stream blocks", () => {
    expect(
      artifactPresentationForMessage(
        reportMessage("KnowledgeAgent", {
          id: undefined,
          content: "",
          streaming: true,
          streamPresentationKey: "turn-status-only",
          blocks: reducedMarkdownBlocks("RUNNING"),
        })
      )
    ).toBeNull();
    expect(
      artifactPresentationForMessage(
        reportMessage("KnowledgeAgent", {
          id: undefined,
          content: "",
          streaming: true,
          streamPresentationKey: "turn-activity-only",
          blocks: [
            { type: "reasoning", authority: "web", text: "private thought" },
            { type: "step", authority: "web", label: "FAILED" },
            { type: "tool", authority: "web", toolName: "search" },
          ],
        })
      )
    ).toBeNull();
  });

  it.each(["run-error", "interrupted", "cancelled"] as const)(
    "never promotes %s stream terminal copy without retained Markdown",
    (streamTerminalFailure) => {
      const message = reportMessage("KnowledgeAgent", {
        content: "Localized stream failure copy",
        streamPresentationKey: `terminal-${streamTerminalFailure}`,
      }) as ChatMessage & {
        streamTerminalFailure?: typeof streamTerminalFailure;
      };
      message.streamTerminalFailure = streamTerminalFailure;

      expect(artifactPresentationForMessage(message)).toBeNull();
    }
  );

  it("uses retained stream Markdown instead of RunError content", () => {
    const message = reportMessage("BriefGeneAgent", {
      content: "upstream failure",
      blocks: completedMarkdownBlocks(
        "# Retained gene report\n\nEvidence accumulated before failure."
      ),
      streamPresentationKey: "failed-with-report",
    }) as ChatMessage & { streamTerminalFailure?: "run-error" };
    message.streamTerminalFailure = "run-error";

    expect(artifactPresentationForMessage(message)).toEqual({
      kind: "cited-report",
      report: "# Retained gene report\n\nEvidence accumulated before failure.",
      source: "message",
      identity: "stream:failed-with-report",
    });
  });

  it("keeps persisted history reports eligible without runtime failure copy", () => {
    expect(
      artifactPresentationForMessage(
        reportMessage("KnowledgeAgent", {
          id: "history-failed-report",
          status: "FAILED",
          content: "# Persisted partial report\n\nRetained evidence.",
          streaming: false,
        })
      )
    ).toEqual({
      kind: "cited-report",
      report: "# Persisted partial report\n\nRetained evidence.",
      source: "message",
      identity: "message:history-failed-report",
    });
  });

  it.each([
    "",
    "   ",
    "RUNNING",
    "FAILED",
    "SUCCEEDED",
    "No references available.",
  ])("does not create a View from status-only content %j", (content) => {
    expect(
      artifactPresentationForMessage(
        reportMessage("KnowledgeAgent", { content })
      )
    ).toBeNull();
  });

  it("rejects DeepGenome transport placeholders but accepts failed partial text", () => {
    for (const content of [
      "Server task created: child-task-123",
      "Loading file content...",
      "File content is empty or failed to load",
      "Failed to load file, please try again later",
    ]) {
      expect(
        artifactPresentationForMessage(
          reportMessage("DeepGenomeAgent", { content })
        )
      ).toBeNull();
    }
    expect(
      artifactPresentationForMessage(
        reportMessage("DeepGenomeAgent", {
          content:
            "# Partial report\n\nFailure occurred after evidence collection.",
        })
      )?.report
    ).toContain("Failure occurred");
  });

  it("does not create an empty View from image or artifact metadata", () => {
    for (const tool_name of reportTools) {
      expect(
        artifactPresentationForMessage(
          reportMessage(tool_name, {
            content: "",
            artifacts: [{ id: "image-1", name: "result.png", kind: "image" }],
            download_path: "result.png",
          })
        )
      ).toBeNull();
    }
  });

  it("prefers stream identity, then row id, then Bot run id", () => {
    expect(
      artifactIdentityForMessage(
        reportMessage("KnowledgeAgent", {
          streamPresentationKey: " stream-1 ",
          id: "row-1",
          botLifecycle: { runId: "run-1" } as ChatMessage["botLifecycle"],
        })
      )
    ).toBe("stream:stream-1");
    expect(
      artifactIdentityForMessage(
        reportMessage("KnowledgeAgent", {
          streamPresentationKey: "",
          id: "row-1",
          botLifecycle: { runId: "run-1" } as ChatMessage["botLifecycle"],
        })
      )
    ).toBe("message:row-1");
    expect(
      artifactIdentityForMessage(
        reportMessage("KnowledgeAgent", {
          id: undefined,
          botLifecycle: { runId: "run-1" } as ChatMessage["botLifecycle"],
        })
      )
    ).toBe("run:run-1");
    expect(
      artifactPresentationForMessage(
        reportMessage("KnowledgeAgent", { id: undefined })
      )
    ).toBeNull();
  });

  it.each([
    "",
    "   ",
    "Server task created: child-task-123",
    "Loading file content...",
    "File content is empty or failed to load",
    "Failed to load file, please try again later",
  ])("rejects DeepGenome transport placeholder %j", (content) => {
    expect(isMeaningfulDeepGenomeReport(content)).toBe(false);
  });

  it.each([
    "Server task created: child-task-123",
    "Loading file content...",
    "File content is empty or failed to load",
    "Failed to load file, please try again later",
  ])("recognizes DeepGenome transport placeholder %j", (content) => {
    expect(isDeepGenomeTransportPlaceholder(content)).toBe(true);
  });

  it.each(["", "   ", "# Gene report\n\nSynthetic evidence."])(
    "does not classify %j as a DeepGenome transport placeholder",
    (content) => {
      expect(isDeepGenomeTransportPlaceholder(content)).toBe(false);
    }
  );

  it("accepts a real DeepGenome Markdown report", () => {
    expect(
      isMeaningfulDeepGenomeReport("# Gene report\n\nSynthetic evidence.")
    ).toBe(true);
  });

  it.each(["RUNNING", "FAILED", "CANCELLED", "TIMED_OUT"])(
    "marks a substantive %s DeepGenome report as View-eligible",
    (status) => {
      expect(
        isCompletedDeepGenomeMessage({
          ...ELIGIBLE_MESSAGE,
          tool_name: "DeepGenomeAgent",
          status,
        })
      ).toBe(true);
    }
  );

  it("marks only a meaningful identified DeepGenome row complete", () => {
    expect(
      isCompletedDeepGenomeMessage({
        ...ELIGIBLE_MESSAGE,
        tool_name: "DeepGenomeAgent",
        status: "SUCCEEDED",
      })
    ).toBe(true);

    for (const message of [
      {
        ...ELIGIBLE_MESSAGE,
        content: "Server task created: child-task-123",
        tool_name: "DeepGenomeAgent",
        status: "SUCCEEDED",
      },
      {
        ...ELIGIBLE_MESSAGE,
        id: undefined,
        tool_name: "DeepGenomeAgent",
        status: "SUCCEEDED",
      },
    ]) {
      expect(isCompletedDeepGenomeMessage(message)).toBe(false);
    }
  });

  it.each([
    "RUNNING",
    "INPUT_REQUIRED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "TIMED_OUT",
  ])("exposes a report-backed Research artifact at %j", (status) => {
    const message = {
      ...ELIGIBLE_MESSAGE,
      tool_name: "InSilicoResearchAgent",
      status,
    };

    expect(isCompletedResearchMessage(message)).toBe(true);
    expect(artifactKindForMessage(message)).toBe("research");
  });

  it.each(["succeeded", " SUCCEEDED "])(
    "normalizes terminal status %j for remote analysis artifacts",
    (status) => {
      expect(
        artifactKindForMessage({
          ...ELIGIBLE_MESSAGE,
          tool_name: "AnalystAgent",
          status,
        })
      ).toBe("research");
    }
  );

  it("renders a substantive Review result as a cited report View", () => {
    const message = {
      ...ELIGIBLE_MESSAGE,
      tool_name: "ReviewAgent",
      status: "SUCCEEDED",
    };

    expect(artifactKindForMessage(message)).toBe("cited-report");
  });

  it.each(CANONICAL_AGENT_TOOLS)(
    "maps canonical %s results to the approved artifact kind",
    (toolName) => {
      const message = {
        ...ELIGIBLE_MESSAGE,
        tool_name: toolName,
        ...(toolName === "DeepGenomeAgent" ||
        toolName === "InSilicoResearchAgent" ||
        toolName === "AnalystAgent" ||
        toolName === "DigitalDesignAgent" ||
        toolName === "GeneNetworkAgent"
          ? { status: "SUCCEEDED" }
          : {}),
      };

      expect(artifactKindForMessage(message)).toBe(artifactByTool[toolName]);
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
      name: "empty streaming placeholder",
      message: {
        ...ELIGIBLE_MESSAGE,
        content: "",
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
  });
});
