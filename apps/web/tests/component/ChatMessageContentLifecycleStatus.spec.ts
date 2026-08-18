import { describe, expect, it, vi, afterEach } from "vitest";
import { nextTick } from "vue";
import ChatMessageContent from "@/views/chat/components/ChatMessageContent.vue";
import type { AgentTaskLifecycle } from "@/api/types";
import type { ChatMessage } from "@/views/chat/types";
import { expectLifecyclePhase } from "../helpers/lifecycle-phase";
import { mountWithApp } from "../helpers/test-app-context";
import { resetProgressStartedAtForTests } from "@/views/chat/utils/agentProgress";

vi.mock("@/components/ScientificMarkdown.vue", () => ({
  default: {
    props: ["source"],
    template: '<div data-test="scientific-markdown">{{ source }}</div>',
  },
}));
vi.mock("@/components/ScientificMarkdownTypewriter.vue", () => ({
  default: {
    props: ["source"],
    template: '<div data-test="scientific-markdown">{{ source }}</div>',
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
  terminal: ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"].includes(phase),
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

function mountContent(
  message: Partial<ChatMessage>,
  run: AgentTaskLifecycle,
  extra: Record<string, unknown> = {}
) {
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
      ...extra,
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
  afterEach(() => {
    vi.useRealTimers();
    resetProgressStartedAtForTests();
  });

  it("keeps Analyst wait-only while the answer is still the task-created ack", () => {
    const wrapper = mountContent(
      {
        tool_name: "AnalystAgent",
        content:
          "Task created successfully:a20b8246-9acc-11f1-bbb4-fa163e7f72d1",
        status: "RUNNING",
      },
      lifecycle("RUNNING")
    );

    expect(wrapper.find('[data-test="agent-wait"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="send-progress"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Task created successfully");
    expect(wrapper.find('[data-test="scientific-markdown"]').exists()).toBe(
      false
    );
  });

  it("shows a lifecycle status for analysis agents without image branches", () => {
    const wrapper = mountContent(
      { tool_name: "AnalystAgent" },
      lifecycle("SUCCEEDED")
    );

    expectLifecyclePhase(wrapper, "Succeeded");
    expect(wrapper.get('[data-test="scientific-markdown"]').text()).toContain(
      "Synthetic result."
    );
  });

  it.each([
    "DigitalDesignAgent",
    "AnalystAgent",
    "InSilicoResearchAgent",
    "GeneNetworkAgent",
    "DeepGenomeAgent",
  ] as const)(
    "shows Finalizing for %s after compute succeeds and the archive is still packing",
    (tool_name) => {
      const wrapper = mountContent(
        {
          tool_name,
          content: tool_name === "DeepGenomeAgent" ? "# Report" : "",
          status: "FINALIZING",
        },
        lifecycle("FINALIZING")
      );

      expect(wrapper.find('[data-test="agent-wait"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="progress-label"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="send-progress"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="progress-label"]').text()).not.toBe(
        "Running"
      );
    }
  );

  it("does not duplicate lifecycle status for specialized image agents", () => {
    const wrapper = mountContent(
      { tool_name: "GeneNetworkAgent", content: "" },
      lifecycle("PREPARING")
    );

    expect(wrapper.findAll(".agent-lifecycle")).toHaveLength(1);
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Preparing network analysis"
    );
    expect(wrapper.find('[data-test="send-progress"]').exists()).toBe(true);
  });

  it("keeps the leading DeepGenome lifecycle as the only live region", () => {
    const wrapper = mountContent(
      { tool_name: "DeepGenomeAgent", content: "" },
      lifecycle("RUNNING")
    );

    expect(wrapper.findAll(".agent-lifecycle")).toHaveLength(1);
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Writing the gene background"
    );
    expect(wrapper.find('[data-test="send-progress"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="progress-eta"]').text()).toMatch(/24–72/);
  });

  it("does not surface a cached complete DeepGenome file while wait progress is still running", () => {
    const cachedFile = `# Smoc Analysis

The analysis of chromatin accessibility for the Os01g0822900 promoter.`;
    const wrapper = mountContent(
      {
        tool_name: "DeepGenomeAgent",
        status: "RUNNING",
        content: cachedFile,
        doc_list: [{ title: "Cached DeepGenome source" }],
      },
      lifecycle("RUNNING"),
      {
        artifactPreview: {
          title: "Running",
          kind: "Deep Genome Agent",
          summary: "Decodes plant genomes for smarter breeding strategies.",
          openLabel: "View",
        },
      }
    );

    expect(wrapper.find('[data-test="agent-wait"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Writing the gene background"
    );
    expect(
      wrapper.findComponent({ name: "ResearchArtifactPreview" }).exists()
    ).toBe(false);
    expect(wrapper.find('[data-test="artifact-open"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Smoc Analysis");
    expect(wrapper.text()).not.toContain("Os01g0822900");
  });

  it("shows a wait card for Design without a finished result", () => {
    const wrapper = mountContent(
      { tool_name: "DigitalDesignAgent", content: "" },
      lifecycle("RUNNING")
    );

    expect(wrapper.find('[data-test="agent-wait"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Preparing protein and promoter design tasks"
    );
    expect(wrapper.find('[data-test="progress-eta"]').text()).toMatch(/12–48/);
    expect(wrapper.find(".phy-bubble-assistant").exists()).toBe(true);
  });

  it("renders a passed Research timeout lifecycle as its exact status", () => {
    const wrapper = mountContent(
      { tool_name: "InSilicoResearchAgent", content: "" },
      lifecycle("TIMED_OUT")
    );

    expectLifecyclePhase(wrapper, "Timed out");
    expect(wrapper.find(".research-artifact-preview").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Failed");
  });

  it("flushes remaining DeepGenome CoT before showing a cached file that just succeeded", async () => {
    vi.useFakeTimers();
    resetProgressStartedAtForTests();
    const startedAt = Date.now();
    const cachedFile = `# Smoc Analysis

The analysis of chromatin accessibility for the Os01g0822900 promoter.`;
    const wrapper = mountContent(
      {
        tool_name: "DeepGenomeAgent",
        status: "RUNNING",
        content: cachedFile,
      },
      lifecycle("RUNNING"),
      { progressStartedAt: startedAt }
    );
    expect(wrapper.find('[data-test="agent-wait"]').exists()).toBe(true);
    expect(
      wrapper.findComponent({ name: "ResearchArtifactPreview" }).exists()
    ).toBe(false);

    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        status: "SUCCEEDED",
      },
      lifecycle: lifecycle("SUCCEEDED"),
      artifactPreview: {
        title: "Finished",
        kind: "Deep Genome Agent",
        summary: "Decodes plant genomes for smarter breeding strategies.",
        openLabel: "View",
      },
    });
    await nextTick();
    expect(wrapper.find('[data-test="agent-wait"]').exists()).toBe(true);
    expect(
      wrapper.findComponent({ name: "ResearchArtifactPreview" }).exists()
    ).toBe(false);

    vi.advanceTimersByTime(90 * 19);
    await nextTick();
    expect(
      wrapper.findComponent({ name: "ResearchArtifactPreview" }).exists()
    ).toBe(true);
    expect(wrapper.text()).not.toContain("Smoc Analysis");
  });

  it("flushes remaining CoT before showing the official result", async () => {
    vi.useFakeTimers();
    resetProgressStartedAtForTests();
    const startedAt = Date.now();
    const wrapper = mountContent(
      { tool_name: "AnalystAgent", content: "" },
      lifecycle("RUNNING"),
      { progressStartedAt: startedAt }
    );
    expect(wrapper.find('[data-test="agent-wait"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="scientific-markdown"]').exists()).toBe(
      false
    );
    expect(wrapper.findAll(".send-progress__cot-item")).toHaveLength(1);

    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        content: "### Analysis report\n\nSynthetic result.",
      },
      lifecycle: lifecycle("SUCCEEDED"),
    });
    await nextTick();
    expect(wrapper.find('[data-test="scientific-markdown"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-test="agent-wait"]').exists()).toBe(true);
    expect(wrapper.findAll(".send-progress__cot-item")).toHaveLength(1);

    vi.advanceTimersByTime(90 * 16);
    await nextTick();
    expect(wrapper.get('[data-test="scientific-markdown"]').text()).toContain(
      "Synthetic result."
    );
    expect(wrapper.findAll(".send-progress__cot-item")).toHaveLength(16);
  });
});
