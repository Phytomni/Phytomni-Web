import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const testState = vi.hoisted(() => ({
  chatStates: null as ReturnType<
    typeof import("@/views/chat/composables/useChatStates").useChatStates
  > | null,
  copiedText: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div />" },
  FilesCard: { name: "FilesCard", template: "<div />" },
  Prompts: { name: "Prompts", template: "<div />" },
}));

vi.mock("@/views/chat/composables/useChatStates", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/views/chat/composables/useChatStates")
  >();
  return {
    ...actual,
    useChatStates: () => {
      const state = actual.useChatStates();
      testState.chatStates = state;
      return state;
    },
  };
});

vi.mock("@/views/chat/composables/useCopyDownload", () => ({
  useCopyDownload: () => ({
    fallbackCopyText: (text: string) => testState.copiedText(text),
    downloadFile: testState.downloadFile,
    getFileDownUrl: vi.fn(),
  }),
}));

vi.mock("@/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chat")>();
  return {
    ...actual,
    getHistoryQuestionList: vi.fn(() => new Promise(() => undefined)),
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), back: vi.fn(), go: vi.fn() }),
  };
});

import ChatMessageContent from "@/views/chat/components/ChatMessageContent.vue";
import ChatIndex from "@/views/chat/index.vue";
import BotReportState from "@/components/research/BotReportState.vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import { SIDEBAR_COLLAPSED_PREFERENCE_KEY } from "@/views/chat/composables/useSidebarResponsive";
import type { ChatMessage } from "@/views/chat/types";
import type { BotRunProjection } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
  "utf8"
);
const CONTENT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageContent.vue"),
  "utf8"
);
const DEEP_GENOME_ARTIFACT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/research/DeepGenomeArtifact.vue"),
  "utf8"
);
const citedMessage: ChatMessage = {
  role: "assistant",
  id: "cited-1",
  tool_name: "KnowledgeAgent",
  status: "SUCCEEDED",
  content: "# Full cited report\n\nEvidence-backed finding [1].",
  doc_list: [{ title: "Complete source document" }],
};

const researchMessage: ChatMessage = {
  role: "assistant",
  id: "research-1",
  tool_name: "InSilicoResearchAgent",
  status: "SUCCEEDED",
  content: "# Full research report\n\nComplete simulated experiment results.",
};

const partialResearchLifecycle: BotLifecycleState = {
  runId: "run-research-1",
  status: "RUNNING",
  reportRevision: 2,
  visibleReport: "# Partial report",
  intermediateReport: "# Partial report",
  finalReport: "",
  degraded: true,
  failures: ["Optional BriefGene analysis unavailable"],
  artifacts: [
    {
      outputDir: "/obs/bucket/run-research-1",
      paths: [
        "/obs/bucket/run-research-1/results.pdf",
        "/obs/bucket/run-research-1/../private.txt",
      ],
    },
    { outputDir: "/obs/bucket/run-research-1", paths: [] },
  ],
};

const partialResearchProjection: BotRunProjection = {
  runId: "run-research-projection-1",
  agent: "InSilicoResearchAgent",
  status: "RUNNING",
  reportStage: "intermediate",
  reportCompleteness: "partial",
  reportRevision: 2,
  reportUpdatedAt: "2026-07-17T10:00:00Z",
  intermediateReport: "# Projection partial report",
  finalReport: "",
  progress: {
    completed: 1,
    total: 2,
    failed: 0,
    pending: 1,
    briefGeneStatus: "",
  },
  degraded: false,
  degradedReason: null,
  failures: [],
  artifacts: partialResearchLifecycle.artifacts,
  requestId: null,
  trackingDegraded: false,
};

const projectionBackedResearchMessage: ChatMessage = {
  ...researchMessage,
  botProjection: partialResearchProjection,
};

const interopProjectionOnlyResearchMessage: ChatMessage = {
  ...researchMessage,
  botProjection: {
    ...partialResearchProjection,
    interop: {
      mode: "auto",
      status: "degraded",
      targetId: "mcp-peer",
      kind: "mcp",
      code: "degraded",
    },
    degradedInterop: true,
  },
};

const deepGenomeMessage: ChatMessage = {
  role: "assistant",
  id: "deep-1",
  tool_name: "DeepGenomeAgent",
  status: "SUCCEEDED",
  content: "# Full DeepGenome report",
  doc_list: [{ title: "DeepGenome source" }],
};

const deepGenomePreview = {
  title: "Finished",
  kind: "Deep Genome Agent",
  summary: "Deep genome analysis for a gene.",
  openLabel: "View",
};

const preview = {
  title: "Finished",
  kind: "Knowledge Agent",
  summary: "Expert-curated plant knowledge at your fingertips.",
  openLabel: "View",
};

const EMPTY_IMAGES = {} as Record<string, string[]>;
const EMPTY_LOADING = {} as Record<string, boolean>;

function mountContent(
  message: ChatMessage,
  artifactPreview: typeof preview | null = null
) {
  return mount(ChatMessageContent, {
    props: {
      message,
      index: 2,
      isLastMessage: true,
      artifactPreview,
      geneNetworkImages: EMPTY_IMAGES,
      geneNetworkImagesLoading: EMPTY_LOADING,
      digitalDesignImages: EMPTY_IMAGES,
      digitalDesignImagesLoading: EMPTY_LOADING,
    },
    global: {
      stubs: {
        StreamMessage: true,
        MarkdownViewer: {
          props: ["content"],
          template: '<div data-test="markdown-body">{{ content }}</div>',
        },
        CitedAnswer: {
          props: ["content"],
          template: '<div data-test="cited-body">{{ content }}</div>',
        },
        DeepGenomeResultViewer: {
          props: ["markdown"],
          template: '<div data-test="deep-genome-inline">{{ markdown }}</div>',
        },
        ElIcon: true,
        ElTable: true,
        ElTableColumn: true,
      },
      mocks: { $t: (key: string) => key },
    },
  });
}

const mountedWrappers: VueWrapper[] = [];
const globalI18n = config.global.plugins[0] as {
  global: {
    locale: { value: string };
    setLocaleMessage: (
      locale: string,
      messages: Record<string, unknown>
    ) => void;
  };
};

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function mountProductionChat(
  width = 1440,
  options: {
    markDeepSeen?: boolean;
    messagesA?: ChatMessage[];
    messagesB?: ChatMessage[];
  } = {}
) {
  setViewportWidth(width);
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(ChatIndex, {
    global: {
      plugins: [pinia],
      stubs: {
        ChatComposer: {
          name: "ChatComposer",
          props: ["modelValue"],
          emits: ["update:modelValue"],
          setup(
            _props: unknown,
            { expose }: { expose: (value: Record<string, unknown>) => void }
          ) {
            expose({
              openHeader: vi.fn(),
              closeHeader: vi.fn(),
              popoverVisible: false,
            });
            return {};
          },
          template:
            '<textarea data-testid="chat-composer" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        ChatMessageActions: {
          name: "ChatMessageActions",
          emits: ["copy"],
          template:
            '<button type="button" data-test="copy-source" @click="$emit(\'copy\')">copy</button>',
        },
        MarkdownViewer: {
          name: "MarkdownViewer",
          props: ["content", "surface", "ns"],
          template:
            '<article data-test="markdown-body" :data-surface="surface" :class="[\'phy-markdown\', `phy-markdown--${surface}`]">{{ content }}</article>',
        },
        DeepGenomeResultViewer: {
          name: "DeepGenomeResultViewer",
          props: ["markdown"],
          template:
            '<article data-test="deep-genome-inline">{{ markdown }}</article>',
        },
        ChatSidebarNav: true,
        ChatHistoryList: true,
        FollowUpQuestions: true,
        ChatActivity: true,
        ChatAnalystLog: true,
        StreamMessage: true,
        TransferProgress: true,
        SendProgress: true,
        ElTour: true,
        ElTourStep: true,
        ElBacktop: true,
        ElDialog: true,
        ElAvatar: true,
        ElIcon: true,
        ElTable: true,
        ElTableColumn: true,
        ElButton: {
          template: '<button type="button"><slot /></button>',
        },
        teleport: true,
      },
    },
  });
  mountedWrappers.push(wrapper);

  const state = testState.chatStates;
  if (!state) throw new Error("Chat state capture was not initialized");
  state.getChatState("A").renderedChat = {
    dialogue_id: "A",
    title: "Cited synthesis",
    messages: options.messagesA || [citedMessage, deepGenomeMessage],
  };
  // This fixture represents a history refresh whose DeepGenome id was already
  // observed; dedicated auto-open tests cover a genuinely new foreground row.
  if (options.markDeepSeen !== false) {
    state.getChatState("A").autoOpenedArtifactMessageIds.push("deep-1");
  }
  state.getChatState("A").messageInput = "draft A";
  state.getChatState("B").renderedChat = {
    dialogue_id: "B",
    title: "Research simulation",
    messages: options.messagesB || [researchMessage],
  };
  state.getChatState("B").messageInput = "draft B";
  state.currentChatId.value = "A";
  await nextTick();
  await nextTick();

  return { wrapper, state };
}

async function settleResponsiveLayout() {
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  globalI18n.global.setLocaleMessage("en-US", enUS);
  globalI18n.global.setLocaleMessage("zh-CN", zhCN);
  globalI18n.global.locale.value = "en-US";
  testState.chatStates = null;
  testState.copiedText.mockReset();
  testState.downloadFile.mockReset();
  localStorage.clear();
  localStorage.setItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY, "false");
  window.history.replaceState({}, "", "/chat");
});

afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("Chat artifact message ownership", () => {
  it("replaces an eligible cited body with one neutral localized preview", async () => {
    const wrapper = mountContent(citedMessage, preview);

    expect(wrapper.find(".research-artifact-preview--neutral").exists()).toBe(
      true
    );
    expect(wrapper.findAll("[data-test=artifact-open]")).toHaveLength(1);
    expect(wrapper.text()).toContain(preview.kind);
    expect(wrapper.text()).toContain(preview.title);
    expect(wrapper.text()).toContain(preview.summary);
    expect(wrapper.text()).not.toContain(citedMessage.content);
    expect(wrapper.find("[data-test=cited-body]").exists()).toBe(false);

    await wrapper.get("[data-test=artifact-open]").trigger("click");
    expect(wrapper.emitted("open-artifact")).toHaveLength(1);
  });

  it("renders DeepGenome as one neutral preview instead of an inline full report", async () => {
    const wrapper = mountContent(deepGenomeMessage, deepGenomePreview);

    expect(wrapper.find("[data-test=deep-genome-inline]").exists()).toBe(false);
    expect(wrapper.findAll("[data-test=artifact-open]")).toHaveLength(1);
    expect(wrapper.text()).toContain("Deep Genome Agent");
    expect(wrapper.text()).not.toContain("Full DeepGenome report");
    await wrapper.get("[data-test=artifact-open]").trigger("click");
    expect(wrapper.emitted("open-artifact")).toHaveLength(1);
  });

  it("keeps the existing copy action wired to complete message source", () => {
    expect(CHAT_SOURCE).toContain('@copy="handleMessageCopy(message, index)"');
    expect(CHAT_SOURCE).toContain("message.content +");
    expect(CHAT_SOURCE).toContain('"\\nReferences:\\n"');
    expect(CHAT_SOURCE).not.toMatch(
      /handleMessageCopy[\s\S]{0,500}artifactPreview/
    );
  });
});

describe("Chat artifact shell integration", () => {
  it("auto-opens a new completed foreground DeepGenome id once", async () => {
    const { wrapper, state } = await mountProductionChat(1440, {
      markDeepSeen: false,
    });
    await nextTick();
    await nextTick();

    expect(state.getChatState("A").activeArtifactMessageId).toBe("deep-1");
    expect(state.getChatState("A").artifactOpen).toBe(true);
    expect(state.getChatState("A").autoOpenedArtifactMessageIds).toContain(
      "deep-1"
    );

    await wrapper.get("[data-test=artifact-close]").trigger("click");
    expect(state.getChatState("A").artifactOpen).toBe(false);

    state.getChatState("A").renderedChat = {
      dialogue_id: "A",
      messages: [citedMessage, { ...deepGenomeMessage }],
    };
    await nextTick();
    await nextTick();

    expect(state.getChatState("A").artifactOpen).toBe(false);
    expect(state.getChatState("A").activeArtifactMessageId).toBeNull();
  });

  it.each([
    {
      name: "streaming placeholder",
      message: {
        ...deepGenomeMessage,
        id: "streaming-deep",
        content: "partial",
        streaming: true,
      },
    },
    {
      name: "missing server id",
      message: { ...deepGenomeMessage, id: undefined },
    },
    {
      name: "failed result",
      message: { ...deepGenomeMessage, id: "failed-deep", status: "FAILED" },
    },
    {
      name: "running server task",
      message: {
        ...deepGenomeMessage,
        id: "running-deep",
        status: "RUNNING",
        content: "Server task created: task-123",
      },
    },
  ])("does not auto-open a $name", async ({ message }) => {
    const { state } = await mountProductionChat(1440, {
      markDeepSeen: false,
      messagesA: [message],
    });
    await nextTick();
    await nextTick();

    expect(state.getChatState("A").artifactOpen).toBe(false);
    expect(state.getChatState("A").autoOpenedArtifactMessageIds).toEqual([]);
  });

  it("does not steal focus when a completed result appeared in a background dialogue", async () => {
    const { state } = await mountProductionChat(1440, {
      markDeepSeen: false,
      messagesA: [{ role: "user", content: "foreground" }],
      messagesB: [{ ...deepGenomeMessage, id: "background-deep" }],
    });
    await nextTick();
    await nextTick();

    expect(state.getChatState("A").artifactOpen).toBe(false);
    state.currentChatId.value = "B";
    await nextTick();
    await nextTick();
    expect(state.getChatState("B").artifactOpen).toBe(false);
    expect(state.getChatState("B").autoOpenedArtifactMessageIds).toEqual([
      "background-deep",
    ]);
  });

  it("temporarily collapses the rendered sidebar without changing its stored preference", async () => {
    const { wrapper } = await mountProductionChat();
    const renderedSidebar = () => wrapper.get(".phy-adaptive-sidebar");
    const sidebarContent = () => renderedSidebar().get(".sidebar");

    expect(renderedSidebar().classes()).not.toContain("is-collapsed");
    expect(sidebarContent().classes()).not.toContain("collapsed");
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe(
      "false"
    );

    await wrapper.get("[data-test=artifact-open]").trigger("click");
    await nextTick();

    expect(renderedSidebar().classes()).toContain("is-collapsed");
    expect(sidebarContent().classes()).toContain("collapsed");
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe(
      "false"
    );

    await wrapper.get("[data-test=artifact-close]").trigger("click");
    await nextTick();

    expect(renderedSidebar().classes()).not.toContain("is-collapsed");
    expect(sidebarContent().classes()).not.toContain("collapsed");
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe(
      "false"
    );
  });

  it("opens and closes a split artifact without mutating sidebar preference, scroll, or composer", async () => {
    const { wrapper } = await mountProductionChat();
    const transcript = wrapper.get("[data-testid=chat-transcript]").element;
    const composer = wrapper.get("[data-testid=chat-composer]").element;
    transcript.scrollTop = 417;

    expect(wrapper.findAll("[data-test=artifact-open]")).toHaveLength(2);
    expect(wrapper.find("[data-test=cited-body]").exists()).toBe(false);
    expect(wrapper.text()).toContain(preview.summary);
    expect(wrapper.text()).not.toContain(citedMessage.content);
    expect(wrapper.text()).not.toContain("Evidence-backed finding");
    const deepGenomeRow = wrapper.get('[data-message-id="deep-1"]');
    expect(deepGenomeRow.find("[data-test=deep-genome-inline]").exists()).toBe(
      false
    );
    expect(deepGenomeRow.find("[data-test=artifact-open]").exists()).toBe(true);
    expect(transcript.scrollTop).toBe(417);
    expect(composer).toHaveProperty("value", "draft A");

    await wrapper.get("[data-test=artifact-open]").trigger("click");
    transcript.scrollTop = 999;
    await settleResponsiveLayout();
    expect(wrapper.get(".phy-adaptive-shell").classes()).toContain(
      "phy-adaptive-shell--artifact-split"
    );
    expect(wrapper.get(".phy-adaptive-shell").classes()).toContain(
      "is-sidebar-collapsed"
    );
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe(
      "false"
    );
    const artifactBody = wrapper.get(
      '.phy-adaptive-shell__artifact [data-test="markdown-body"]'
    );
    expect(artifactBody.attributes("data-surface")).toBe("artifact");
    expect(artifactBody.classes()).toEqual(
      expect.arrayContaining(["phy-markdown", "phy-markdown--artifact"])
    );
    expect(artifactBody.text()).toContain("Full cited report");
    expect(wrapper.findAll("[data-test=markdown-body]")).toHaveLength(1);
    const evidencePanel = wrapper.get(".research-evidence-panel");
    const evidenceTabPanel = evidencePanel.element.closest(
      '[data-panel-id="evidence"]'
    );
    expect(evidenceTabPanel?.hasAttribute("hidden")).toBe(true);
    expect(evidencePanel.text()).toContain("Complete source document");
    expect(wrapper.findAll(".research-evidence-panel__item")).toHaveLength(1);
    expect(wrapper.find(".doc-list").exists()).toBe(false);
    expect(wrapper.get("[data-testid=chat-transcript]").element).toBe(
      transcript
    );
    expect(wrapper.get("[data-testid=chat-composer]").element).toBe(composer);
    expect(transcript.scrollTop).toBe(417);
    expect(composer).toHaveProperty("value", "draft A");

    await wrapper.get("[data-test=artifact-close]").trigger("click");
    transcript.scrollTop = 999;
    await settleResponsiveLayout();
    expect(wrapper.get(".phy-adaptive-shell").classes()).toContain(
      "phy-adaptive-shell--normal"
    );
    expect(wrapper.get(".phy-adaptive-shell").classes()).not.toContain(
      "is-sidebar-collapsed"
    );
    expect(wrapper.find("[data-test=markdown-body]").exists()).toBe(false);
    expect(wrapper.get("[data-testid=chat-transcript]").element).toBe(
      transcript
    );
    expect(wrapper.get("[data-testid=chat-composer]").element).toBe(composer);
    expect(transcript.scrollTop).toBe(417);
    expect(composer).toHaveProperty("value", "draft A");
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe(
      "false"
    );

    await wrapper.get("[data-test=copy-source]").trigger("click");
    expect(testState.copiedText).toHaveBeenCalledWith(
      `${citedMessage.content}\nReferences:\n1. Complete source document`
    );
    expect(testState.copiedText.mock.calls[0][0]).not.toContain(
      preview.summary
    );
  });

  it("uses the mobile full-surface hook while preserving the mounted transcript", async () => {
    const { wrapper } = await mountProductionChat(390);
    const transcript = wrapper.get("[data-testid=chat-transcript]").element;
    await wrapper.get("[data-test=artifact-open]").trigger("click");

    expect(wrapper.get(".phy-adaptive-shell").classes()).toContain(
      "phy-adaptive-shell--artifact-fullscreen"
    );
    expect(CHAT_SOURCE).toContain(
      ':artifact-fullscreen="artifactOpen && isMobileViewport"'
    );
    expect(wrapper.get("[data-testid=chat-transcript]").element).toBe(
      transcript
    );

    await wrapper.get("[data-test=artifact-back]").trigger("click");
    expect(wrapper.get(".phy-adaptive-shell").classes()).toContain(
      "phy-adaptive-shell--normal"
    );
    expect(wrapper.get("[data-testid=chat-transcript]").element).toBe(
      transcript
    );
  });

  it("restores open selection and composer per dialogue without cross-chat content", async () => {
    const { wrapper, state } = await mountProductionChat();
    await wrapper.get("[data-test=artifact-open]").trigger("click");
    expect(wrapper.get("[data-test=markdown-body]").text()).toContain(
      "Full cited report"
    );

    state.currentChatId.value = "B";
    await nextTick();
    expect(wrapper.find("[data-test=markdown-body]").exists()).toBe(false);
    expect(wrapper.get("[data-testid=chat-composer]").element).toHaveProperty(
      "value",
      "draft B"
    );
    expect(wrapper.text()).not.toContain("Full cited report");
    expect(wrapper.findAll("[data-test=artifact-open]")).toHaveLength(1);

    await wrapper.get("[data-test=artifact-open]").trigger("click");
    expect(wrapper.get("[data-test=markdown-body]").text()).toContain(
      "Full research report"
    );

    state.currentChatId.value = "A";
    await nextTick();
    expect(wrapper.get("[data-test=markdown-body]").text()).toContain(
      "Full cited report"
    );
    expect(wrapper.get("[data-testid=chat-composer]").element).toHaveProperty(
      "value",
      "draft A"
    );
    expect(wrapper.text()).not.toContain("Full research report");

    state.currentChatId.value = "B";
    await nextTick();
    expect(wrapper.get("[data-test=markdown-body]").text()).toContain(
      "Full research report"
    );
  });

  it("closes an invalid selection instead of showing stale artifact data", async () => {
    const { wrapper, state } = await mountProductionChat();
    const transcript = wrapper.get("[data-testid=chat-transcript]").element;
    transcript.scrollTop = 417;
    await wrapper.get("[data-test=artifact-open]").trigger("click");
    await settleResponsiveLayout();
    expect(wrapper.find("[data-test=markdown-body]").exists()).toBe(true);

    state.getChatState("A").activeArtifactMessageId = "missing";
    transcript.scrollTop = 999;
    await settleResponsiveLayout();
    expect(wrapper.find("[data-test=markdown-body]").exists()).toBe(false);
    expect(wrapper.get(".phy-adaptive-shell").classes()).toContain(
      "phy-adaptive-shell--normal"
    );
    expect(transcript.scrollTop).toBe(417);
  });

  it("renders lifecycle reports and validated artifact actions in the shared shell", async () => {
    const { wrapper } = await mountProductionChat(1440, {
      messagesA: [projectionBackedResearchMessage],
    });

    await wrapper.get("[data-test=artifact-open]").trigger("click");
    expect(wrapper.get("[data-report-status=degraded]").exists()).toBe(true);
    expect(wrapper.get("[data-test=bot-report-content]").text()).toContain(
      "Projection partial report"
    );
    expect(wrapper.text()).not.toContain("raw.phytomni_state");

    await wrapper.get('[data-tab-id="downloads"]').trigger("click");
    expect(wrapper.findAll('[data-test="bot-artifact-download"]')).toHaveLength(
      1
    );
    await wrapper.get('[data-test="bot-artifact-download"]').trigger("click");
    expect(testState.downloadFile).toHaveBeenCalledWith(
      "/obs/bucket/run-research-1"
    );
    expect(wrapper.html()).not.toContain("/private.txt");
  });

  it("preserves interop provenance when the artifact has only a projection", async () => {
    const { wrapper } = await mountProductionChat(1440, {
      messagesA: [interopProjectionOnlyResearchMessage],
    });

    await wrapper.get("[data-test=artifact-open]").trigger("click");
    const report = wrapper.findComponent(BotReportState);
    expect(report.exists()).toBe(true);
    expect(report.props("state")).toMatchObject({
      degradedInterop: true,
      interop: {
        mode: "auto",
        status: "degraded",
        targetId: "mcp-peer",
        kind: "mcp",
        code: "degraded",
      },
    });
  });

  it("wires production Chat to the artifact state, renderers, and adaptive slot", () => {
    expect(CHAT_SOURCE).toContain("useArtifactPanel({");
    expect(CHAT_SOURCE).toContain(':artifact-open="artifactOpen"');
    expect(CHAT_SOURCE).toContain("effectiveSidebarCollapsed");
    expect(CHAT_SOURCE).toContain("<template #artifact>");
    expect(CHAT_SOURCE).toContain("<DeepGenomeArtifact");
    expect(DEEP_GENOME_ARTIFACT_SOURCE).toContain(':show-actions="false"');
    expect(DEEP_GENOME_ARTIFACT_SOURCE).toContain(':show-references="false"');
    expect(CHAT_SOURCE).toContain("<ResearchArtifactShell");
    expect(CHAT_SOURCE).toContain('surface="artifact"');
    expect(CHAT_SOURCE).toContain("<CitedAnswer");
    expect(CHAT_SOURCE).toContain('reference-presentation="external"');
    expect(CHAT_SOURCE).toContain("<ResearchEvidencePanel");
    expect(CHAT_SOURCE).toContain(
      "@activate=\"selectArtifactTab('evidence')\""
    );
    expect(CHAT_SOURCE).not.toContain("<CitationReferenceList");
    expect(CHAT_SOURCE).toContain("artifactPreviewForMessage(message)");
    expect(CONTENT_SOURCE).toContain("<ResearchArtifactPreview");
    expect(CONTENT_SOURCE).toContain("@open=\"emit('open-artifact')\"");
  });
});
