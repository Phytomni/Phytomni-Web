import { describe, expect, it, vi } from "vitest";
import ChatMessageContent from "@/views/chat/components/ChatMessageContent.vue";
import type { AgentTaskLifecycle } from "@/api/types";
import type { ChatMessage } from "@/views/chat/types";
import { mountWithApp } from "../helpers/test-app-context";

vi.mock("@/components/MarkdownViewer.vue", () => ({
  default: {
    props: ["content"],
    template: '<div data-test="markdown-viewer">{{ content }}</div>',
  },
}));
vi.mock("@/components/CitedAnswer.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/DeepGenomeResultViewer.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/research/ResearchArtifactPreview.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/views/chat/components/StreamMessage.vue", () => ({
  default: { template: "<div />" },
}));

const lifecycle = (phase: AgentTaskLifecycle["phase"]): AgentTaskLifecycle => ({
  id: 901,
  phase,
  terminal: ["SUCCEEDED", "FAILED", "CANCELLED"].includes(phase),
  child_task_count: phase === "PREPARING" ? 0 : 1,
  child_work_accepted: phase !== "PREPARING",
  report_revision: phase === "PREPARING" ? 0 : 2,
  artifact_summary: {
    image_count: 0,
    output_directory_count: 0,
    has_report: phase === "SUCCEEDED",
  },
  reconciliation: "FRESH",
  tracking_degraded: false,
  error_code: null,
});

function mountContent(message: Partial<ChatMessage>, run: AgentTaskLifecycle) {
  return mountWithApp(ChatMessageContent, {
    props: {
      message: {
        id: "message-1",
        role: "assistant",
        content: "### Analysis report\n\nSynthetic result.",
        ...message,
      } as ChatMessage,
      index: 0,
      isLastMessage: true,
      geneNetworkImages: {},
      geneNetworkImagesLoading: {},
      digitalDesignImages: {},
      digitalDesignImagesLoading: {},
      lifecycle: run,
    },
    global: {
      stubs: {
        CitedAnswer: true,
        DeepGenomeResultViewer: true,
        "el-icon": true,
        "el-table": true,
        "el-table-column": true,
        ResearchArtifactPreview: true,
        StreamMessage: true,
      },
    },
  });
}

describe("ChatMessageContent lifecycle status", () => {
  it("shows a lifecycle status for analysis agents without image branches", () => {
    const wrapper = mountContent(
      { tool_name: "AnalystAgent" },
      lifecycle("SUCCEEDED")
    );

    expect(wrapper.find(".agent-lifecycle").text()).toBe("Succeeded");
    expect(wrapper.get('[data-test="markdown-viewer"]').text()).toContain(
      "Synthetic result."
    );
  });

  it("does not duplicate lifecycle status for specialized image agents", () => {
    const wrapper = mountContent(
      { tool_name: "GeneNetworkAgent", content: "" },
      lifecycle("PREPARING")
    );

    expect(wrapper.findAll(".agent-lifecycle")).toHaveLength(1);
    expect(wrapper.find(".agent-lifecycle").text()).toBe("Preparing");
  });
});
