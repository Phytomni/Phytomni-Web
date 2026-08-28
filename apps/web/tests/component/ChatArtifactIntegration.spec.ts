import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  initReducerState,
  reduceAGUIEvent,
} from "@/views/chat/streaming/eventReducer";

const testState = vi.hoisted(() => ({
  chatStates: null as ReturnType<
    typeof import("@/views/chat/composables/useChatStates").useChatStates
  > | null,
  copiedText: vi.fn(),
  downloadFile: vi.fn(),
  getFileDownUrl: vi.fn(),
  getAnswerCheck: vi.fn(),
  getAnalystAgentLog: vi.fn(),
}));

vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div />" },
  FilesCard: { name: "FilesCard", template: "<div />" },
  Prompts: { name: "Prompts", template: "<div />" },
}));

vi.mock("@/views/chat/composables/useChatStates", async (importOriginal) => {
  const actual =
    await importOriginal<
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
    getFileDownUrl: testState.getFileDownUrl,
  }),
}));

vi.mock("@/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chat")>();
  return {
    ...actual,
    getHistoryQuestionList: vi.fn(() => new Promise(() => undefined)),
    getAnswerCheck: testState.getAnswerCheck,
    getAnalystAgentLog: testState.getAnalystAgentLog,
    getUserTool: vi.fn(async () => ({
      code: 200,
      data: {
        permission: "",
        tool_list: [],
        permission_list: [],
        expert_enabled: false,
      },
    })),
  };
});

vi.mock(
  "@/views/chat/composables/useBotCapabilities",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/views/chat/composables/useBotCapabilities")
      >();
    return {
      ...actual,
      useBotCapabilities: (caller?: string) => {
        const state = actual.useBotCapabilities(caller);
        return {
          ...state,
          load: async () => {
            state.loaded.value = true;
            return state.capabilities.value;
          },
        };
      },
    };
  }
);

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({ meta: {}, query: {}, params: {} }),
    useRouter: () => ({ push: vi.fn(), back: vi.fn(), go: vi.fn() }),
  };
});

import ChatMessageContent from "@/views/chat/components/ChatMessageContent.vue";
import ChatIndex from "@/views/chat/ChatView.vue";
import BotReportState from "@/components/research/BotReportState.vue";
import CitedAnswer from "@/components/CitedAnswer.vue";
import { CANONICAL_AGENT_DISPLAY_ORDER } from "@/constants/agents";
import type { CanonicalAgentTool } from "@/constants/agents";
import enUS from "@/locales/langs/en-US";
import { SIDEBAR_COLLAPSED_PREFERENCE_KEY } from "@/views/chat/composables/useSidebarResponsive";
import type { ChatMessage } from "@/views/chat/types";
import {
  parseBotProjection,
  type BotRunProjection,
} from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import { createTestAppContext } from "../helpers/test-app-context";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/ChatView.vue"),
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
const ARTIFACT_PREVIEW_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/components/research/ResearchArtifactPreview.vue"
  ),
  "utf8"
);
const ARTIFACT_HEADER_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/components/research/ResearchArtifactHeader.vue"
  ),
  "utf8"
);
const ARTIFACT_SHELL_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/research/ResearchArtifactShell.vue"),
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

const knowledgeZeroReferenceRaw =
  '{"content":"Based on the provided documents, no supporting evidence was found.","doc_list":[]}';

const knowledgeZeroReferenceMessage: ChatMessage = {
  role: "assistant",
  id: "knowledge-empty-1",
  tool_name: "KnowledgeAgent",
  status: "SUCCEEDED",
  content: "Based on the provided documents, no supporting evidence was found.",
  doc_list: [],
  botProjection: parseBotProjection({
    agent: "KnowledgeAgent",
    status: "SUCCEEDED",
    answer: knowledgeZeroReferenceRaw,
  }),
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
  reportPresentation: true,
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

const overflowFileArtifact = {
  id: "overflow-file",
  name: "result.txt",
  kind: "file" as const,
};

function overflowMessageFor(tool: CanonicalAgentTool): ChatMessage {
  if (tool === "DeepGenomeAgent") {
    return { ...deepGenomeMessage, id: `overflow-${tool}` };
  }
  if (tool === "ChatAgent" || tool === "DataAgent") {
    return {
      role: "assistant",
      id: `overflow-${tool}`,
      tool_name: tool,
      status: "SUCCEEDED",
      content: `${tool} answer body`,
      artifacts: [overflowFileArtifact],
    };
  }
  if (
    tool === "AnalystAgent" ||
    tool === "InSilicoResearchAgent" ||
    tool === "DigitalDesignAgent" ||
    tool === "GeneNetworkAgent"
  ) {
    return {
      ...researchMessage,
      id: `overflow-${tool}`,
      tool_name: tool,
      content: `# Full ${tool} report\n\nComplete results.`,
    };
  }
  return {
    ...citedMessage,
    id: `overflow-${tool}`,
    tool_name: tool,
    content: `# Full ${tool} report\n\nEvidence-backed finding [1].`,
  };
}

function copiedNeedleFor(tool: CanonicalAgentTool): string {
  if (tool === "DeepGenomeAgent") return "Full DeepGenome report";
  if (tool === "ChatAgent" || tool === "DataAgent") {
    return `${tool} answer body`;
  }
  return `Full ${tool} report`;
}

async function chooseArtifactOverflow(
  wrapper: VueWrapper,
  command: string
): Promise<void> {
  await wrapper.get("[data-test=artifact-action]").trigger("click");
  await nextTick();
  const item = document.querySelector(
    `[data-test="artifact-action-${command}"]`
  );
  expect(item).toBeTruthy();
  (item as HTMLElement).click();
  await nextTick();
}

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
let appContext: ReturnType<typeof createTestAppContext>;

function mountContent(
  message: ChatMessage,
  artifactPreview: typeof preview | null = null
) {
  return appContext.mount(ChatMessageContent, {
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
        ScientificMarkdown: {
          props: ["source"],
          template: '<div data-test="markdown-body">{{ source }}</div>',
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
    markCitedSeen?: boolean;
    messagesA?: ChatMessage[];
    messagesB?: ChatMessage[];
  } = {}
) {
  setViewportWidth(width);
  const wrapper = appContext.mount(ChatIndex, {
    global: {
      stubs: {
        // Element Plus 2.14 dropdown poppers require the native Teleport
        // lifecycle; replacing it with a boolean stub causes recursive updates.
        RouterLink: {
          name: "RouterLink",
          props: ["to"],
          template: '<a :href="to"><slot /></a>',
        },
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
        ScientificMarkdown: {
          name: "ScientificMarkdown",
          props: ["source", "surface", "citationNamespace"],
          template:
            '<article data-test="markdown-body" :data-surface="surface" :class="[\'phy-markdown\', `phy-markdown--${surface}`]">{{ source }}</article>',
        },
        DeepGenomeResultViewer: {
          name: "DeepGenomeResultViewer",
          props: ["markdown", "showActions", "showReferences"],
          template:
            '<article data-test="deep-genome-inline" :data-show-actions="String(showActions)" :data-show-references="String(showReferences)">{{ markdown }}</article>',
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
    state.getChatState("A").handledArtifactIdentities.push("message:deep-1");
  }
  if (options.markCitedSeen !== false) {
    state.getChatState("A").handledArtifactIdentities.push("message:cited-1");
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
  appContext = createTestAppContext({ locale: "en-US" });
  testState.chatStates = null;
  testState.copiedText.mockReset();
  testState.downloadFile.mockReset();
  testState.getAnswerCheck.mockReset();
  testState.getAnalystAgentLog.mockReset();
  testState.getAnalystAgentLog.mockResolvedValue({
    code: 200,
    data: {
      state: "AVAILABLE",
      source: "BOT_RUN",
      text: "Synthetic Research execution log",
      truncated: false,
      can_request_legacy_refresh: false,
      error_code: null,
    },
  });
  localStorage.clear();
  localStorage.setItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY, "false");
  window.history.replaceState({}, "", "/chat");
});

afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("Chat history hydration surfaces", () => {
  it("renders loading, error, empty-history, and new conversation states", async () => {
    const { wrapper, state } = await mountProductionChat();
    const selected = state.getChatState("A");
    selected.renderedChat = null;
    selected.historyHydration = "loading";
    await nextTick();

    expect(wrapper.get('[role="status"]').text()).toContain(
      enUS.chat.history.loading
    );
    expect(wrapper.text()).not.toContain(enUS.chat.welcomeTitle);

    selected.historyHydration = "error";
    selected.historyErrorKind = "request";
    await nextTick();

    const error = wrapper.get('[data-testid="chat-history-error"]');
    expect(error.text()).toContain(enUS.chat.history.errorTitle);
    expect(error.text()).toContain(enUS.chat.history.errorSubtitle);
    expect(error.get("button").text()).toBe(enUS.chat.history.retry);

    selected.historyHydration = "history-empty";
    selected.historyErrorKind = null;
    await nextTick();

    const empty = wrapper.get('[data-testid="chat-history-empty"]');
    expect(empty.text()).toContain(enUS.chat.history.emptyTitle);
    expect(empty.text()).toContain(enUS.chat.history.emptySubtitle);
    expect(wrapper.text()).not.toContain(enUS.chat.welcomeTitle);

    selected.historyHydration = "new";
    selected.renderedChat = { messages: [] };
    await nextTick();

    expect(wrapper.text()).toContain(enUS.chat.welcomeTitle);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="chat-history-error"]').exists()).toBe(
      false
    );
  });

  it("retries the selected dialogue without mutating another dialogue", async () => {
    const { wrapper, state } = await mountProductionChat();
    const selected = state.getChatState("A");
    const background = state.getChatState("B");
    selected.renderedChat = null;
    selected.historyHydration = "error";
    selected.historyErrorKind = "request";
    background.historyHydration = "history-empty";
    background.historyErrorKind = null;
    background.renderedChat = null;
    testState.getAnswerCheck.mockRejectedValueOnce(new Error("offline"));
    await nextTick();

    await wrapper
      .get('[data-testid="chat-history-error"] button')
      .trigger("click");
    await flushPromises();

    expect(testState.getAnswerCheck).toHaveBeenCalledWith({ dialogue_id: "A" });
    expect(state.currentChatId.value).toBe("A");
    expect(background.historyHydration).toBe("history-empty");
    expect(background.historyErrorKind).toBeNull();
    expect(background.renderedChat).toBeNull();
  });
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
    expect(CHAT_SOURCE).toContain("messagePlainText(message)");
    expect(CHAT_SOURCE).toContain('"\\nReferences:\\n"');
    expect(CHAT_SOURCE).not.toMatch(
      /handleMessageCopy[\s\S]{0,500}artifactPreview/
    );
  });

  it("opts Chat artifacts into scientific labels without adding HTML sinks", () => {
    expect(CONTENT_SOURCE).toMatch(
      /<ResearchArtifactPreview[\s\S]{0,500}:format-scientific-agent-name=/
    );
    expect(CHAT_SOURCE).toMatch(
      /<ResearchArtifactShell[\s\S]{0,700}:format-scientific-agent-name=/
    );
    expect(CONTENT_SOURCE).toContain(
      "message.tool_name === 'InSilicoResearchAgent'"
    );
    expect(CHAT_SOURCE).toContain(
      "currentArtifactMessage.tool_name === 'InSilicoResearchAgent'"
    );
    for (const source of [
      ARTIFACT_PREVIEW_SOURCE,
      ARTIFACT_HEADER_SOURCE,
      ARTIFACT_SHELL_SOURCE,
    ]) {
      expect(source).not.toContain("v-html");
    }
  });
});

describe("Chat artifact shell integration", () => {
  it.each([
    {
      name: "cited report",
      message: citedMessage,
      identity: "message:cited-1",
    },
    {
      name: "research report",
      message: researchMessage,
      identity: "message:research-1",
    },
    {
      name: "DeepGenome report",
      message: deepGenomeMessage,
      identity: "message:deep-1",
    },
  ])(
    "auto-opens a new foreground $name once",
    async ({ message, identity }) => {
      const { state } = await mountProductionChat(1440, {
        markCitedSeen: false,
        markDeepSeen: false,
        messagesA: [message],
      });
      await nextTick();
      await nextTick();

      expect(state.getChatState("A").artifactOpen).toBe(true);
      expect(state.getChatState("A").activeArtifactIdentity).toBe(identity);
      expect(state.getChatState("A").handledArtifactIdentities).toContain(
        identity
      );
    }
  );

  it("auto-opens a new completed foreground DeepGenome id once", async () => {
    const { wrapper, state } = await mountProductionChat(1440, {
      markDeepSeen: false,
    });
    await nextTick();
    await nextTick();

    expect(state.getChatState("A").activeArtifactIdentity).toBe(
      "message:deep-1"
    );
    expect(state.getChatState("A").artifactOpen).toBe(true);
    expect(state.getChatState("A").handledArtifactIdentities).toContain(
      "message:deep-1"
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
    expect(state.getChatState("A").activeArtifactIdentity).toBeNull();

    state.getChatState("A").renderedChat = {
      dialogue_id: "A",
      messages: [{ ...deepGenomeMessage, id: "deep-2" }],
    };
    await nextTick();
    await nextTick();

    expect(state.getChatState("A").artifactOpen).toBe(true);
    expect(state.getChatState("A").activeArtifactIdentity).toBe(
      "message:deep-2"
    );
  });

  it.each(["KnowledgeAgent", "BriefGeneAgent"] as const)(
    "waits for a token-by-token %s stream to complete before auto-opening once",
    async (toolName) => {
      const streamKey = `turn-${toolName}`;
      let reduced = reduceAGUIEvent(initReducerState(), {
        type: "TextMessageContent",
        data: { delta: "#" },
      });
      const streamingMessage: ChatMessage = {
        role: "assistant",
        tool_name: toolName,
        content: "",
        blocks: reduced.blocks,
        streaming: true,
        streamPresentationKey: streamKey,
      };
      const { wrapper, state } = await mountProductionChat(1440, {
        markCitedSeen: false,
        markDeepSeen: false,
        messagesA: [streamingMessage],
      });
      await nextTick();
      await nextTick();

      const identity = `stream:${streamKey}`;
      expect(state.getChatState("A").artifactOpen).toBe(false);
      expect(state.getChatState("A").activeArtifactIdentity).toBeNull();
      expect(state.getChatState("A").handledArtifactIdentities).toEqual([]);

      for (const delta of [
        ` ${toolName}`,
        " report",
        "\n\nAccumulated ",
        "scientific evidence.",
      ]) {
        reduced = reduceAGUIEvent(reduced, {
          type: "TextMessageContent",
          data: { delta },
        });
        state.getChatState("A").renderedChat = {
          dialogue_id: "A",
          messages: [{ ...streamingMessage, blocks: reduced.blocks }],
        };
        await nextTick();
        await nextTick();
        expect(state.getChatState("A").artifactOpen).toBe(false);
        expect(state.getChatState("A").handledArtifactIdentities).toEqual([]);
      }

      reduced = reduceAGUIEvent(reduced, {
        type: "TextMessageEnd",
        data: {},
      });
      state.getChatState("A").renderedChat = {
        dialogue_id: "A",
        messages: [{ ...streamingMessage, blocks: reduced.blocks }],
      };
      await nextTick();
      await nextTick();
      expect(state.getChatState("A").artifactOpen).toBe(false);
      expect(state.getChatState("A").handledArtifactIdentities).toEqual([]);

      state.getChatState("A").renderedChat = {
        dialogue_id: "A",
        messages: [
          {
            ...streamingMessage,
            id: `row-${toolName}`,
            streaming: false,
            blocks: reduced.blocks,
          },
        ],
      };
      await nextTick();
      await nextTick();

      expect(state.getChatState("A").artifactOpen).toBe(true);
      expect(state.getChatState("A").activeArtifactIdentity).toBe(identity);
      expect(state.getChatState("A").handledArtifactIdentities).toEqual([
        identity,
      ]);

      await wrapper.get("[data-test=artifact-close]").trigger("click");
      await nextTick();
      expect(state.getChatState("A").artifactOpen).toBe(false);
    }
  );

  it("does not consume report identity for an interrupted first delta", async () => {
    const streamKey = "turn-interrupted-fragment";
    let reduced = reduceAGUIEvent(initReducerState(), {
      type: "TextMessageContent",
      data: { delta: "#" },
    });
    const streamingMessage: ChatMessage = {
      role: "assistant",
      tool_name: "KnowledgeAgent",
      content: "",
      blocks: reduced.blocks,
      streaming: true,
      streamPresentationKey: streamKey,
    };
    const { state } = await mountProductionChat(1440, {
      markCitedSeen: false,
      markDeepSeen: false,
      messagesA: [streamingMessage],
    });
    await nextTick();
    await nextTick();

    state.getChatState("A").renderedChat = {
      dialogue_id: "A",
      messages: [
        {
          ...streamingMessage,
          content: "Localized interruption copy",
          streaming: false,
          streamTerminalFailure: "interrupted",
        },
      ],
    };
    await nextTick();
    await nextTick();
    expect(state.getChatState("A").artifactOpen).toBe(false);
    expect(state.getChatState("A").activeArtifactIdentity).toBeNull();
    expect(state.getChatState("A").handledArtifactIdentities).toEqual([]);

    reduced = reduceAGUIEvent(initReducerState(), {
      type: "TextMessageContent",
      data: { delta: "OK" },
    });
    reduced = reduceAGUIEvent(reduced, { type: "TextMessageEnd", data: {} });
    state.getChatState("A").renderedChat = {
      dialogue_id: "A",
      messages: [
        {
          ...streamingMessage,
          id: "row-short-retry",
          blocks: reduced.blocks,
          streaming: false,
        },
      ],
    };
    await nextTick();
    await nextTick();
    expect(state.getChatState("A").artifactOpen).toBe(true);
    expect(state.getChatState("A").activeArtifactIdentity).toBe(
      `stream:${streamKey}`
    );
    expect(state.getChatState("A").handledArtifactIdentities).toEqual([
      `stream:${streamKey}`,
    ]);
  });

  it.each([
    {
      name: "empty streaming placeholder",
      message: {
        ...deepGenomeMessage,
        id: "streaming-deep",
        content: "",
        streaming: true,
      },
    },
    {
      name: "missing server id",
      message: { ...deepGenomeMessage, id: undefined },
    },
    {
      name: "failed result with a retained report",
      message: { ...deepGenomeMessage, id: "failed-deep", status: "FAILED" },
      expectOpen: true,
    },
    {
      name: "cancelled result with a retained report",
      message: {
        ...deepGenomeMessage,
        id: "cancelled-deep",
        status: "CANCELLED",
      },
      expectOpen: true,
    },
    {
      name: "running server task placeholder",
      message: {
        ...deepGenomeMessage,
        id: "running-deep",
        status: "RUNNING",
        content: "Server task created: task-123",
      },
      expectOpen: false,
    },
    {
      name: "running cached complete file",
      message: {
        ...deepGenomeMessage,
        id: "running-cached-deep",
        status: "RUNNING",
        content:
          "# Smoc Analysis\n\nThe analysis of chromatin accessibility for the Os01g0822900 promoter.",
      },
      expectOpen: false,
    },
  ])(
    "handles a $name report according to usable content",
    async ({ name, message, expectOpen = false }) => {
      const { wrapper, state } = await mountProductionChat(1440, {
        markDeepSeen: false,
        messagesA: [message],
      });
      await nextTick();
      await nextTick();

      expect(state.getChatState("A").artifactOpen).toBe(expectOpen);
      expect(state.getChatState("A").handledArtifactIdentities).toEqual(
        expectOpen
          ? ["message:cited-1", `message:${message.id}`]
          : ["message:cited-1"]
      );
      if (name === "running server task placeholder") {
        expect(wrapper.text()).not.toContain("Server task created");
        expect(wrapper.find('[data-test="deep-genome-inline"]').exists()).toBe(
          false
        );
        expect(wrapper.text()).not.toContain("No references available.");
      }
      if (name === "running cached complete file") {
        expect(wrapper.find('[data-test="agent-wait"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="artifact-open"]').exists()).toBe(
          false
        );
        expect(wrapper.text()).not.toContain("Smoc Analysis");
        expect(wrapper.text()).not.toContain("Os01g0822900");
      }
    }
  );

  it.each([
    ["RUNNING", ""],
    ["FAILED", enUS.chat.lifecycle.failed],
    ["CANCELLED", enUS.chat.lifecycle.cancelled],
    ["SUCCEEDED", enUS.chat.lifecycle.resultUnavailable],
  ])(
    "does not preview a %s DeepGenome row without a report when generic artifacts exist",
    async (status, expectedCopy) => {
      const id = `deep-artifacts-${status.toLowerCase()}`;
      const message: ChatMessage = {
        role: "assistant",
        id,
        tool_name: "DeepGenomeAgent",
        status,
        content: "",
        artifacts: [
          {
            id: "generic-artifact-1",
            name: "intermediate.txt",
            kind: "file",
          },
        ],
      };
      const { wrapper, state } = await mountProductionChat(1440, {
        markDeepSeen: false,
        messagesA: [message],
      });
      await nextTick();
      await nextTick();

      const row = wrapper.get(`[data-message-id="${id}"]`);
      if (status === "RUNNING") {
        expect(row.find('[data-test="agent-wait"]').exists()).toBe(true);
      } else {
        expect(row.text()).toContain(expectedCopy);
      }
      expect(row.find(".research-artifact-preview").exists()).toBe(false);
      expect(row.find('[data-test="artifact-open"]').exists()).toBe(false);
      expect(state.getChatState("A").artifactOpen).toBe(false);
      expect(state.getChatState("A").handledArtifactIdentities).toEqual([
        "message:cited-1",
      ]);
    }
  );

  it.each([
    {
      name: "running raw placeholder",
      message: {
        role: "assistant",
        id: "401",
        tool_name: "DeepGenomeAgent",
        status: "RUNNING",
        content: "Server task created: synthetic-child",
      } satisfies ChatMessage,
      lifecycleCopy: "",
      inlineReport: null,
      previewCount: 0,
      neutralPreviewCount: 0,
      showActions: null,
    },
    {
      name: "running cached file Markdown",
      message: {
        role: "assistant",
        id: "402",
        tool_name: "DeepGenomeAgent",
        status: "RUNNING",
        content: "# Synthetic revision report",
      } satisfies ChatMessage,
      lifecycleCopy: "",
      inlineReport: null,
      previewCount: 0,
      neutralPreviewCount: 0,
      showActions: null,
    },
    {
      name: "failed revision Markdown",
      message: {
        role: "assistant",
        id: "403",
        tool_name: "DeepGenomeAgent",
        status: "FAILED",
        content: "# Synthetic retained report",
      } satisfies ChatMessage,
      lifecycleCopy: enUS.chat.lifecycle.failed,
      inlineReport: null,
      previewCount: 1,
      neutralPreviewCount: 1,
      showActions: null,
    },
    {
      name: "successful final Markdown",
      message: {
        role: "assistant",
        id: "404",
        tool_name: "DeepGenomeAgent",
        status: "SUCCEEDED",
        content: "# Synthetic final report",
      } satisfies ChatMessage,
      lifecycleCopy: enUS.chat.lifecycle.succeeded,
      inlineReport: null,
      previewCount: 1,
      neutralPreviewCount: 1,
      showActions: null,
    },
  ])(
    "renders the production DeepGenome transition for $name",
    async ({
      message,
      lifecycleCopy,
      inlineReport,
      previewCount,
      neutralPreviewCount,
      showActions,
    }) => {
      const { wrapper, state } = await mountProductionChat(1440, {
        messagesA: [message],
      });
      state
        .getChatState("A")
        .handledArtifactIdentities.push(`message:${message.id}`);
      await nextTick();
      await nextTick();

      const row = wrapper.get(`[data-message-id="${message.id}"]`);
      if (lifecycleCopy) {
        expect(row.text()).toContain(lifecycleCopy);
      } else {
        expect(row.find('[data-test="agent-wait"]').exists()).toBe(true);
      }
      expect(row.findAll(".research-artifact-preview")).toHaveLength(
        previewCount
      );
      expect(row.findAll(".research-artifact-preview--neutral")).toHaveLength(
        neutralPreviewCount
      );
      expect(row.text()).not.toContain("Server task created");
      expect(row.text()).not.toContain("No references available.");

      const inline = row.find('[data-test="deep-genome-inline"]');
      expect(inline.exists()).toBe(inlineReport !== null);
      if (inlineReport !== null) {
        expect(inline.text()).toContain(inlineReport);
        expect(inline.attributes("data-show-actions")).toBe(showActions);
      } else {
        expect(row.text()).not.toContain(message.content);
      }
    }
  );

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
    expect(state.getChatState("B").handledArtifactIdentities).toEqual([
      "message:background-deep",
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
    expect(wrapper.get("[data-test=bot-report-content]").text()).toContain(
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
    expect(wrapper.get("[data-test=bot-report-content]").text()).toContain(
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

    state.getChatState("A").activeArtifactIdentity = "missing";
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

  it("loads the selected Research execution log once through the owner-scoped row id", async () => {
    const message = { ...researchMessage, id: "65" };
    const { wrapper, state } = await mountProductionChat(1440, {
      messagesA: [message],
    });
    await nextTick();
    await nextTick();

    if (!state.getChatState("A").artifactOpen) {
      await wrapper.get('[data-test="artifact-open"]').trigger("click");
    }
    await wrapper.get('[data-tab-id="activity"]').trigger("click");
    await flushPromises();

    expect(testState.getAnalystAgentLog).toHaveBeenCalledTimes(1);
    expect(testState.getAnalystAgentLog).toHaveBeenCalledWith({ id: "65" });
    expect(state.getChatState("A").logData["65"]?.text).toBe(
      "Synthetic Research execution log"
    );
    expect(wrapper.findComponent({ name: "ChatAnalystLog" }).exists()).toBe(
      true
    );

    await wrapper.get('[data-tab-id="content"]').trigger("click");
    await wrapper.get('[data-tab-id="activity"]').trigger("click");
    await flushPromises();
    expect(testState.getAnalystAgentLog).toHaveBeenCalledTimes(1);
  });

  it("loads and caches Research Activity while the current dialogue is sending", async () => {
    const message = { ...researchMessage, id: "66" };
    const { wrapper, state } = await mountProductionChat(1440, {
      messagesA: [message],
    });
    await nextTick();
    await nextTick();

    const chatState = state.getChatState("A");
    if (!chatState.artifactOpen) {
      await wrapper.get('[data-test="artifact-open"]').trigger("click");
    }
    chatState.isSending = true;
    await nextTick();

    await wrapper.get('[data-tab-id="activity"]').trigger("click");
    await flushPromises();

    expect(chatState.artifactTab).toBe("activity");
    expect(testState.getAnalystAgentLog).toHaveBeenCalledTimes(1);
    expect(testState.getAnalystAgentLog).toHaveBeenCalledWith({ id: "66" });
    expect(chatState.logData["66"]?.text).toBe(
      "Synthetic Research execution log"
    );

    chatState.isSending = false;
    await nextTick();
    await wrapper.get('[data-tab-id="content"]').trigger("click");
    await wrapper.get('[data-tab-id="activity"]').trigger("click");
    await flushPromises();

    expect(testState.getAnalystAgentLog).toHaveBeenCalledTimes(1);
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

  it("hydrates projection-only cancellation as CANCELLED when a report is retained", async () => {
    const retainedReport = "# Retained projection report";
    const message: ChatMessage = {
      ...researchMessage,
      id: "research-projection-cancelled",
      status: "CANCELLED",
      content: retainedReport,
      botProjection: {
        ...partialResearchProjection,
        status: "CANCELLED",
        reportStage: "final",
        reportCompleteness: "complete",
        intermediateReport: "",
        finalReport: retainedReport,
      },
    };
    const { wrapper } = await mountProductionChat(1440, {
      messagesA: [message],
    });

    await wrapper.get("[data-test=artifact-open]").trigger("click");
    const report = wrapper.findComponent(BotReportState);
    expect(report.exists()).toBe(true);
    expect(report.props("state")).toMatchObject({
      status: "CANCELLED",
    });
    expect(wrapper.get('[data-test="bot-report-content"]').text()).toContain(
      retainedReport
    );
  });

  it.each(["CANCELLED", "CANCELED"])(
    "hydrates status-only %s as CANCELLED when a report is retained",
    async (status) => {
      const retainedReport = `# Retained ${status} report`;
      const message: ChatMessage = {
        ...researchMessage,
        id: `research-status-${status.toLowerCase()}`,
        status,
        content: retainedReport,
      };
      const { wrapper } = await mountProductionChat(1440, {
        messagesA: [message],
      });

      await wrapper.get("[data-test=artifact-open]").trigger("click");
      const report = wrapper.findComponent(BotReportState);
      expect(report.exists()).toBe(true);
      expect(report.props("state")).toMatchObject({
        status: "CANCELLED",
      });
      expect(wrapper.get('[data-test="bot-report-content"]').text()).toContain(
        retainedReport
      );
    }
  );

  it("renders cited Knowledge answers outside the report lifecycle", async () => {
    const { wrapper } = await mountProductionChat(1440, {
      messagesA: [knowledgeZeroReferenceMessage],
    });

    await wrapper.get("[data-test=artifact-open]").trigger("click");
    expect(wrapper.findComponent(BotReportState).exists()).toBe(false);
    expect(wrapper.get("[data-test=markdown-body]").text()).toContain(
      "Based on the provided documents, no supporting evidence was found."
    );
    expect(wrapper.html()).not.toContain(knowledgeZeroReferenceRaw);
    expect(wrapper.text()).not.toContain("doc_list");

    expect(wrapper.find('[data-tab-id="evidence"]').exists()).toBe(false);
    expect(wrapper.find('[data-tab-id="activity"]').exists()).toBe(false);
    expect(wrapper.find('[data-tab-id="downloads"]').exists()).toBe(false);
  });

  it.each([
    ["KnowledgeAgent", citedMessage, true],
    [
      "BriefGeneAgent",
      {
        ...citedMessage,
        id: "brief-1",
        tool_name: "BriefGeneAgent",
      } satisfies ChatMessage,
      true,
    ],
    [
      "ReviewAgent",
      {
        ...citedMessage,
        id: "review-1",
        tool_name: "ReviewAgent",
      } satisfies ChatMessage,
      true,
    ],
    ["DeepGenomeAgent", deepGenomeMessage, false],
  ] as const)(
    "shows Report ready for a completed %s row without Bot report lifecycle",
    async (_tool, message, usesCitedAnswer) => {
      const { wrapper } = await mountProductionChat(1440, {
        messagesA: [{ ...message }],
      });
      await wrapper.get("[data-test=artifact-open]").trigger("click");
      await nextTick();

      expect(wrapper.get(".research-artifact-header__status").text()).toBe(
        enUS.chat.botReport.complete
      );
      expect(wrapper.text()).not.toContain(enUS.chat.botReport.waiting);
      expect(wrapper.findComponent(BotReportState).exists()).toBe(false);
      expect(wrapper.findComponent(CitedAnswer).exists()).toBe(usesCitedAnswer);
    }
  );

  it("renders cited Knowledge references outside the report lifecycle", async () => {
    const citedWithReference: ChatMessage = {
      ...knowledgeZeroReferenceMessage,
      id: "knowledge-reference-1",
      content: "One supporting source [1].",
      doc_list: [{ title: "Usable knowledge source" }],
      botProjection: parseBotProjection({
        agent: "KnowledgeAgent",
        status: "SUCCEEDED",
        answer:
          '{"content":"One supporting source [1].","doc_list":[{"title":"Usable knowledge source"}]}',
      }),
    };

    const cited = await mountProductionChat(1440, {
      messagesA: [citedWithReference],
    });
    await cited.wrapper.get("[data-test=artifact-open]").trigger("click");
    expect(cited.wrapper.findComponent(BotReportState).exists()).toBe(false);
    expect(cited.wrapper.findComponent(CitedAnswer).exists()).toBe(true);
    await cited.wrapper.get('[data-tab-id="evidence"]').trigger("click");
    expect(
      cited.wrapper.findAll(".research-evidence-panel__item")
    ).toHaveLength(1);
    expect(cited.wrapper.text()).toContain("Usable knowledge source");
  });

  it("renders malformed cited compatibility text without report lifecycle or anchors", async () => {
    const malformedCited: ChatMessage = {
      ...knowledgeZeroReferenceMessage,
      id: "knowledge-malformed-1",
      content: '{"content":"incomplete",',
      botProjection: parseBotProjection({
        agent: "KnowledgeAgent",
        status: "SUCCEEDED",
        answer: '{"content":"incomplete",',
      }),
    };
    const malformed = await mountProductionChat(1440, {
      messagesA: [malformedCited],
    });
    await malformed.wrapper.get("[data-test=artifact-open]").trigger("click");
    expect(malformed.wrapper.findComponent(BotReportState).exists()).toBe(
      false
    );
    expect(malformed.wrapper.get("[data-test=markdown-body]").text()).toContain(
      '{"content":"incomplete",'
    );
    expect(malformed.wrapper.find("a.citation-ref").exists()).toBe(false);
  });

  it.each([...CANONICAL_AGENT_DISPLAY_ORDER])(
    "copies the %s artifact from the overflow menu",
    async (tool) => {
      const message = overflowMessageFor(tool);
      const { wrapper, state } = await mountProductionChat(1440, {
        messagesA: [message],
      });

      if (tool === "ChatAgent" || tool === "DataAgent") {
        const chat = state.getChatState("A");
        chat.activeArtifactIdentity = `message:${message.id}`;
        chat.artifactOpen = true;
        await nextTick();
      } else {
        await wrapper.get("[data-test=artifact-open]").trigger("click");
      }

      testState.copiedText.mockClear();
      await chooseArtifactOverflow(wrapper, "copy");
      expect(testState.copiedText).toHaveBeenCalled();
      expect(String(testState.copiedText.mock.calls[0]?.[0])).toContain(
        copiedNeedleFor(tool)
      );
    }
  );

  it("exports a cited report from the overflow Download menu", async () => {
    const { wrapper } = await mountProductionChat(1440, {
      messagesA: [
        {
          ...citedMessage,
          id: "cited-download-1",
          tool_name: "ReviewAgent",
        },
      ],
    });
    await wrapper.get("[data-test=artifact-open]").trigger("click");
    testState.getFileDownUrl.mockClear();

    await chooseArtifactOverflow(wrapper, "download:PDF");
    expect(testState.getFileDownUrl).toHaveBeenCalledWith(
      "cited-download-1",
      "PDF"
    );
    expect(wrapper.find('[data-tab-id="activity"]').exists()).toBe(false);
    expect(wrapper.find('[data-tab-id="downloads"]').exists()).toBe(false);
  });

  it("closes the artifact panel from the overflow menu", async () => {
    const { wrapper, state } = await mountProductionChat(1440, {
      messagesA: [citedMessage],
    });
    await wrapper.get("[data-test=artifact-open]").trigger("click");
    expect(state.getChatState("A").artifactOpen).toBe(true);

    await chooseArtifactOverflow(wrapper, "close");
    expect(state.getChatState("A").artifactOpen).toBe(false);
  });

  it("keeps an ordinary Chat answer on the normal answer path", async () => {
    const ordinaryChat: ChatMessage = {
      role: "assistant",
      id: "chat-ordinary-1",
      tool_name: "ChatAgent",
      status: "SUCCEEDED",
      content: "Ordinary Chat answer",
      botProjection: parseBotProjection({
        agent: "ChatAgent",
        status: "SUCCEEDED",
        answer: "Ordinary Chat answer",
      }),
    };
    const ordinary = await mountProductionChat(1440, {
      messagesA: [ordinaryChat],
    });
    expect(ordinary.wrapper.get("[data-test=markdown-body]").text()).toContain(
      "Ordinary Chat answer"
    );
    expect(ordinary.wrapper.findComponent(BotReportState).exists()).toBe(false);
    expect(ordinary.wrapper.find("[data-test=artifact-open]").exists()).toBe(
      false
    );
  });

  it("wires production Chat to the artifact state, renderers, and adaptive slot", () => {
    expect(CHAT_SOURCE).toContain("useArtifactPanel({");
    expect(CHAT_SOURCE).toContain(':artifact-open="artifactOpen"');
    expect(CHAT_SOURCE).toContain("effectiveSidebarCollapsed");
    expect(CHAT_SOURCE).toContain("<template #artifact>");
    expect(CHAT_SOURCE).toContain("<DeepGenomeArtifact");
    expect(CHAT_SOURCE).toContain('message.status = "FINALIZING"');
    expect(CHAT_SOURCE).not.toContain('message.status = "RUNNING"');
    expect(CHAT_SOURCE).toContain(
      ':rendering-file-id="currentArtifactMessage.id"'
    );
    expect(CHAT_SOURCE).toContain(
      "currentArtifactPresentation?.kind === 'deep-genome'"
    );
    expect(DEEP_GENOME_ARTIFACT_SOURCE).toContain(
      ':rendering-file-id="renderingFileId"'
    );
    expect(DEEP_GENOME_ARTIFACT_SOURCE).toContain(':show-actions="false"');
    expect(DEEP_GENOME_ARTIFACT_SOURCE).toContain(':show-references="false"');
    expect(CHAT_SOURCE).toContain("<ResearchArtifactShell");
    expect(CHAT_SOURCE).toContain(':tabs="artifactTabs"');
    expect(CHAT_SOURCE).toContain("copyDownloadCloseArtifactMenuItems");
    expect(CHAT_SOURCE).toContain(':menu-items="artifactMenuItems"');
    expect(CHAT_SOURCE).toContain('@action="onArtifactMenu"');
    expect(CHAT_SOURCE).toContain('surface="artifact"');
    expect(CHAT_SOURCE).toContain("<CitedAnswer");
    expect(CHAT_SOURCE).toContain('reference-presentation="external"');
    expect(CHAT_SOURCE).toContain("<ResearchEvidencePanel");
    expect(CHAT_SOURCE).toContain('@citation-activate="activateEvidence"');
    expect(CHAT_SOURCE).toContain("evidencePanelRef");
    expect(CHAT_SOURCE).toContain("focusReferences(activation.indices)");
    expect(CHAT_SOURCE).not.toContain("<CitationReferenceList");
    expect(CHAT_SOURCE).toContain("artifactPreviewForMessage(message)");
    expect(CHAT_SOURCE).toContain("artifactPreviewTitleKey(");
    expect(CHAT_SOURCE).not.toContain('title: t("common.finished")');
    expect(CONTENT_SOURCE).toContain("<ResearchArtifactPreview");
    expect(CONTENT_SOURCE).toContain("@open=\"emit('open-artifact')\"");
  });

  it("does not relabel archive packing as compute RUNNING on any remote-agent surface", () => {
    const productSources = [
      resolve(
        __dirname,
        "../../src/views/digital-design-agent/DigitalDesignAgentView.vue"
      ),
      resolve(
        __dirname,
        "../../src/views/gene-network-agent/GeneNetworkAgentView.vue"
      ),
      resolve(
        __dirname,
        "../../src/views/analysis-agent/RemoteAnalysisAgentWorkspace.vue"
      ),
    ].map((path) => readFileSync(path, "utf8"));

    for (const source of productSources) {
      expect(source).toContain("function applyPendingArchiveDelivery");
      expect(source).not.toContain('status: "RUNNING", delivery');
    }
  });
});
