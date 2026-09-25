import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { AxiosHeaders } from "axios";
import { nextTick } from "vue";
import { expectLifecyclePhase } from "../../../helpers/lifecycle-phase";

const testState = vi.hoisted(() => ({
  chatStates: null as ReturnType<
    typeof import("@/views/chat/composables/useChatStates").useChatStates
  > | null,
}));

vi.mock("vue-element-plus-x", () => ({
  FilesCard: { name: "FilesCard", template: "<div />" },
  MentionSender: { name: "MentionSender", template: "<div />" },
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

vi.mock("@/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chat")>();
  return {
    ...actual,
    getHistoryQuestionList: vi.fn(() => new Promise(() => undefined)),
    getFileDownUrlApi: vi.fn(),
  };
});

vi.mock("@/api/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/task")>();
  return {
    ...actual,
    getTaskLifecycle: vi.fn(() => new Promise(() => undefined)),
  };
});

vi.mock("@/utils/request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/request")>();
  return {
    ...actual,
    default: vi.fn().mockRejectedValue(new Error("offline test transport")),
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), back: vi.fn(), go: vi.fn() }),
    useRoute: () => ({
      name: "chat",
      path: "/chat",
      meta: {},
      params: {},
      query: {},
      matched: [],
    }),
  };
});

import ChatView, {
  releaseDialogueUploads,
  removeDeletedChat,
} from "@/views/chat/ChatView.vue";
import { buildChat } from "../../../helpers/chatBuilders";
import { createTestAppContext } from "../../../helpers/test-app-context";
import { initBotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import { parseBotProjection } from "@/views/chat/botProjection";
import { decodeChatHistory } from "@/api/types";
import { getFileDownUrlApi } from "@/api/chat";
import { historyAssistantMetadata } from "@/views/chat/composables/useSelectChat";
import {
  decodeCitationDocuments,
  parseAgentAnswer,
} from "@/views/chat/utils/format";
import DeepGenomeArtifact from "@/components/research/DeepGenomeArtifact.vue";
import golden from "../../../fixtures/report-integrity/public-projection.json";

describe("ChatView lifecycle cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("reconciles cached complete report state in the mounted preview and View panel", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const wrapper = createTestAppContext({ locale: "en-US" }).mount(ChatView, {
      global: {
        stubs: {
          RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
          ScientificMarkdown: {
            props: ["source"],
            template: "<article>{{ source }}</article>",
          },
          ChatComposer: {
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
            template: "<div />",
          },
          ChatMessageActions: {
            emits: ["copy"],
            template:
              '<button data-test="report-copy" @click="$emit(\'copy\')">Copy</button>',
          },
          ChatSidebarNav: true,
          ChatHistoryList: true,
          FollowUpQuestions: true,
          ChatActivity: true,
          ChatAnalystLog: true,
          StreamMessage: true,
          TransferProgress: true,
          ElTour: true,
          ElTourStep: true,
          ElBacktop: true,
          ElDialog: true,
        },
      },
    });
    const state = testState.chatStates;
    if (!state) throw new Error("Chat state capture was not initialized");
    const message = {
      role: "assistant",
      id: "4000",
      tool_name: "InSilicoResearchAgent",
      status: "SUCCEEDED",
      content: "",
      botLifecycle: {
        ...initBotLifecycleState(),
        status: "SUCCEEDED" as const,
        reportRevision: 2,
        finalReport: "# Retained scientific result [1]",
        visibleReport: "# Retained scientific result [1]",
      },
      botProjection: parseBotProjection({
        agent: "InSilicoResearchAgent",
        status: "SUCCEEDED",
        report_revision: 3,
        report: { state: "degraded", degraded: true, source_artifact_count: 2 },
        report_warning_codes: ["report_synthesis_failed"],
      }),
    };
    state.getChatState("report-integrity").renderedChat = {
      dialogue_id: "report-integrity",
      messages: [message],
    };
    state.currentChatId.value = "report-integrity";
    await nextTick();
    await nextTick();
    expect(wrapper.get(".research-artifact-preview__title").text()).toBe(
      "Partial report available"
    );
    expect(
      wrapper
        .get(".research-artifact-preview")
        .element.closest(".phy-bubble-assistant")
    ).toBeNull();
    await wrapper.get('[data-test="report-copy"]').trigger("click");
    expect(writeText).toHaveBeenCalledWith("# Retained scientific result [1]");
    await wrapper.get(".research-artifact-preview button").trigger("click");
    await nextTick();
    expect(wrapper.get(".bot-report-state__status-label").text()).toBe(
      "Partial report available"
    );
    expect(
      wrapper.get('.bot-report-state [data-test="bot-report-content"]').text()
    ).toContain("Retained scientific result");
    expect(wrapper.find('[data-test="bot-report-warnings"]').exists()).toBe(
      true
    );

    const fixture = golden.cases.find(
      (entry) => entry.id === "partial-failed-deep-genome"
    );
    if (!fixture) throw new Error("Partial golden is missing");
    const [row] = decodeChatHistory([fixture.history]);
    if (!row?.projection) throw new Error("Partial projection is missing");
    const answer = parseAgentAnswer(row.answer);
    state.getChatState("report-integrity").renderedChat = {
      dialogue_id: "report-integrity",
      messages: [
        {
          ...historyAssistantMetadata(row),
          role: "assistant",
          id: row.id,
          tool_name: row.tool_name,
          status: row.status,
          content: String(answer.content),
          doc_list: decodeCitationDocuments(answer.doc_list),
        },
      ],
    };
    await nextTick();
    await nextTick();
    const expectedCopy =
      row.projection.intermediateReport +
      "\nReferences:\n1. Synthetic evidence.\nGoogle Scholar: https://scholar.google.com/scholar?q=Synthetic+evidence";
    await wrapper.get('[data-test="report-copy"]').trigger("click");
    expect(writeText).toHaveBeenLastCalledWith(expectedCopy);
    await wrapper.get(".research-artifact-preview button").trigger("click");
    const artifact = wrapper.getComponent(DeepGenomeArtifact);
    expect(artifact.props("markdown")).toBe(row.projection.intermediateReport);
    artifact.vm.$emit("action", "copy");
    await nextTick();
    expect(writeText).toHaveBeenLastCalledWith(expectedCopy);

    const createURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:partial-report");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.mocked(getFileDownUrlApi).mockResolvedValue({
      data: new Blob([row.projection.intermediateReport], {
        type: "text/markdown",
      }),
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "text/markdown",
        "content-disposition": 'attachment; filename="partial.md"',
      },
      config: { headers: new AxiosHeaders() },
    });
    artifact.vm.$emit("action", "download:Markdown");
    await flushPromises();
    const [form, options] =
      vi.mocked(getFileDownUrlApi).mock.calls.at(-1) ?? [];
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("id")).toBe(row.id);
    expect((form as FormData).get("document_format")).toBe("Markdown");
    expect(options).toMatchObject({ suppressErrorToast: true });
    expect(click).toHaveBeenCalledOnce();
    const downloaded = createURL.mock.calls[0]?.[0];
    expect(downloaded).toBeInstanceOf(Blob);
    expect(await (downloaded as Blob).text()).toBe(
      row.projection.intermediateReport
    );
    wrapper.unmount();
    vi.unstubAllGlobals();
  });
  it("removes the deleted dialogue state and poller ownership through the ChatView deletion path", () => {
    const deleted = buildChat({ id: 1, dialogue_id: "deleted-dialogue" });
    const retained = buildChat({ id: 2, dialogue_id: "retained-dialogue" });
    const disposeDialogue = vi.fn();
    const removeChatState = vi.fn();

    const remaining = removeDeletedChat({
      chatList: [deleted, retained],
      deletedChat: deleted,
      disposeDialogue,
      removeChatState,
    });

    expect(disposeDialogue).toHaveBeenCalledWith("deleted-dialogue");
    expect(removeChatState).toHaveBeenCalledWith("deleted-dialogue");
    expect(remaining).toEqual([retained]);
  });

  it("releases incomplete uploads when leaving a dialogue", () => {
    const cancelDialogue = vi.fn();
    releaseDialogueUploads("leaving-dialogue", cancelDialogue);
    expect(cancelDialogue).toHaveBeenCalledWith("leaving-dialogue");
    cancelDialogue.mockClear();
    releaseDialogueUploads("", cancelDialogue);
    releaseDialogueUploads(undefined, cancelDialogue);
    expect(cancelDialogue).not.toHaveBeenCalled();
  });

  it("keeps canonical reference copy identical across assistant message shapes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const context = createTestAppContext({ locale: "en-US" });
    const wrapper = context.mount(ChatView, {
      global: {
        stubs: {
          RouterLink: {
            name: "RouterLink",
            props: ["to"],
            template: '<a :href="to"><slot /></a>',
          },
          ChatComposer: {
            name: "ChatComposer",
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
            template: "<div />",
          },
          ChatMessageActions: {
            name: "ChatMessageActions",
            emits: ["copy"],
            template:
              '<button data-testid="action-copy" type="button" @click="$emit(\'copy\')">Copy</button>',
          },
          ScientificMarkdown: true,
          DeepGenomeResultViewer: true,
          ChatSidebarNav: true,
          ChatHistoryList: true,
          FollowUpQuestions: true,
          ChatActivity: true,
          ChatAnalystLog: true,
          StreamMessage: true,
          TransferProgress: true,
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

    const state = testState.chatStates;
    if (!state) throw new Error("Chat state capture was not initialized");
    const dialogueId = "canonical-copy-dialogue";
    state.currentChatId.value = dialogueId;
    state.getChatState(dialogueId).renderedChat = {
      dialogue_id: dialogueId,
      messages: [
        {
          role: "assistant",
          content: "Answer text.",
          doc_list: [
            {
              citation: {
                runs: [
                  { text: "Journal", italic: true },
                  { text: " " },
                  { text: "12", bold: true },
                ],
                links: [
                  {
                    label: "PubMed",
                    href: "https://pubmed.ncbi.nlm.nih.gov/123/",
                  },
                ],
              },
              au: "Legacy Author",
              ti: "Legacy Title",
              asset_id: "private-asset-id",
            },
            { citation: null, asset_id: "private-rejected-slot" },
          ],
        },
      ],
    };
    await nextTick();

    await wrapper.get('[data-testid="action-copy"]').trigger("click");
    await Promise.resolve();

    const expected =
      "Answer text.\nReferences:\n1. Journal 12\nPubMed: https://pubmed.ncbi.nlm.nih.gov/123/\n\n2. Reference details unavailable.";
    expect(writeText).toHaveBeenCalledWith(expected);
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).not.toContain("private-asset-id");
    expect(copied).not.toContain("private-rejected-slot");
    expect(copied).not.toContain("Legacy Author");
    expect(copied).not.toContain("Legacy Title");
    expect(copied).not.toContain('{"citation"');

    const docList =
      state.getChatState(dialogueId).renderedChat.messages[0].doc_list;
    const assistantShapes = [
      {
        role: "assistant",
        id: "history-row",
        content: "Answer text.",
        doc_list: docList,
      },
      {
        role: "assistant",
        content: "",
        blocks: [
          {
            type: "markdown" as const,
            authority: "agent" as const,
            text: "Answer text.",
            complete: true,
          },
        ],
        doc_list: docList,
      },
      {
        role: "assistant",
        content: "",
        blocks: [
          {
            type: "markdown" as const,
            authority: "agent" as const,
            text: "Answer text.",
            complete: true,
          },
          { type: "agent-surface" as const, authority: "agent" as const },
        ],
        doc_list: docList,
      },
      {
        role: "assistant",
        content: "Answer text.",
        instantMessage: true,
        doc_list: docList,
      },
    ];
    for (const message of assistantShapes) {
      writeText.mockClear();
      state.getChatState(dialogueId).renderedChat = {
        dialogue_id: dialogueId,
        messages: [message],
      };
      await nextTick();
      await wrapper.get('[data-testid="action-copy"]').trigger("click");
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(expected);
    }

    writeText.mockClear();
    state.getChatState(dialogueId).renderedChat = {
      dialogue_id: dialogueId,
      messages: [
        { role: "user", content: "User question.", doc_list: docList },
        {
          role: "assistant",
          content: "Rendered table",
          original: "Gene\nOs01g",
          tableHeaders: [{ prop: "gene", label: "Gene" }],
          doc_list: docList,
        },
      ],
    };
    await nextTick();
    const copyActions = wrapper.findAll('[data-testid="action-copy"]');
    await copyActions[0].trigger("click");
    await copyActions[1].trigger("click");
    await Promise.resolve();
    expect(writeText.mock.calls.map(([text]) => text)).toEqual([
      "User question.",
      "Gene\nOs01g",
    ]);
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("renders report-backed Research previews regardless of lifecycle status", async () => {
    const context = createTestAppContext({ locale: "en-US" });
    const wrapper = context.mount(ChatView, {
      global: {
        stubs: {
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
            template: "<div />",
          },
          ChatMessageActions: true,
          ScientificMarkdown: true,
          DeepGenomeResultViewer: true,
          ChatSidebarNav: true,
          ChatHistoryList: true,
          FollowUpQuestions: true,
          ChatActivity: true,
          ChatAnalystLog: true,
          StreamMessage: true,
          TransferProgress: true,
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

    const state = testState.chatStates;
    if (!state) throw new Error("Chat state capture was not initialized");
    state.getChatState("research-dialogue").renderedChat = {
      dialogue_id: "research-dialogue",
      messages: [
        {
          role: "assistant",
          id: "research-running-1",
          tool_name: "InSilicoResearchAgent",
          status: "RUNNING",
          content: "# Partial Research report",
          artifacts: [
            {
              id: "intermediate-artifact",
              name: "intermediate.txt",
              kind: "file",
            },
          ],
        },
      ],
    };
    state.currentChatId.value = "research-dialogue";
    await nextTick();
    await nextTick();

    const row = wrapper.get('[data-message-id="research-running-1"]');
    expect(row.find(".research-artifact-preview").exists()).toBe(true);
    expectLifecyclePhase(row, "Validating the research request");
    expect(row.get(".research-artifact-preview__title").text()).toBe("Running");
    expect(row.text()).not.toContain("Finished");

    state.getChatState("research-dialogue").renderedChat = {
      dialogue_id: "research-dialogue",
      messages: [
        {
          role: "assistant",
          id: "82",
          tool_name: "InSilicoResearchAgent",
          status: "TIMEOUT",
          content: "",
          doc_list: [],
        },
      ],
    };
    await nextTick();
    await nextTick();

    const historyTimeout = wrapper.get('[data-message-id="82"]');
    expectLifecyclePhase(historyTimeout, "Timed out");
    expect(historyTimeout.find(".research-artifact-preview").exists()).toBe(
      false
    );
    expect(historyTimeout.text()).not.toContain("No references available.");
    expect(historyTimeout.text()).not.toContain("Finished");
    expect(historyTimeout.text()).not.toContain("Failed");

    state.getChatState("research-dialogue").renderedChat = {
      dialogue_id: "research-dialogue",
      messages: [
        {
          role: "assistant",
          id: "83",
          tool_name: "InSilicoResearchAgent",
          status: "RUNNING",
          content: "",
          doc_list: [],
        },
      ],
    };
    state.getChatState("research-dialogue").agentRunLifecycles["83"] = {
      id: 83,
      phase: "TIMED_OUT",
      terminal: true,
      child_task_count: 1,
      child_work_accepted: true,
      report_revision: 1,
      artifact_summary: {
        image_count: 0,
        output_directory_count: 0,
        has_report: false,
      },
      reconciliation: "FRESH",
      tracking_degraded: false,
      error_code: null,
    };
    await nextTick();
    await nextTick();

    const polledTimeout = wrapper.get('[data-message-id="83"]');
    expectLifecyclePhase(polledTimeout, "Timed out");
    expect(polledTimeout.find(".research-artifact-preview").exists()).toBe(
      false
    );
    expect(polledTimeout.text()).not.toContain("No references available.");
    expect(polledTimeout.text()).not.toContain("Finished");
    expect(polledTimeout.text()).not.toContain("Failed");

    wrapper.unmount();
  });

  it("does not lock the composer on sendFailed or first-turn Stop drafts without a row id", async () => {
    const context = createTestAppContext({ locale: "en-US" });
    const wrapper = context.mount(ChatView, {
      global: {
        stubs: {
          RouterLink: {
            name: "RouterLink",
            props: ["to"],
            template: '<a :href="to"><slot /></a>',
          },
          ChatComposer: {
            name: "ChatComposer",
            props: ["isSending"],
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
              '<div data-testid="composer-sending">{{ isSending }}</div>',
          },
          ChatMessageActions: true,
          ScientificMarkdown: true,
          DeepGenomeResultViewer: true,
          ChatSidebarNav: true,
          ChatHistoryList: true,
          FollowUpQuestions: true,
          ChatActivity: true,
          ChatAnalystLog: true,
          StreamMessage: true,
          TransferProgress: true,
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

    const state = testState.chatStates;
    if (!state) throw new Error("Chat state capture was not initialized");
    const dialogueId = "draft-unlock-dialogue";
    state.currentChatId.value = dialogueId;
    const chatState = state.getChatState(dialogueId);
    chatState.isSending = false;
    chatState.generationStopped = false;

    chatState.renderedChat = {
      dialogue_id: dialogueId,
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "chat.sendFailed",
          tool_name: "",
          status: "",
          instantMessage: true,
        },
      ],
    };
    await nextTick();
    expect(wrapper.get('[data-testid="composer-sending"]').text()).toBe(
      "false"
    );

    chatState.renderedChat = {
      dialogue_id: dialogueId,
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "chat.generationStopped",
          instantMessage: true,
        },
      ],
    };
    await nextTick();
    expect(wrapper.get('[data-testid="composer-sending"]').text()).toBe(
      "false"
    );

    chatState.renderedChat = {
      dialogue_id: dialogueId,
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "",
          tool_name: "",
          status: "RUNNING",
          id: "5",
        },
      ],
    };
    await nextTick();
    expect(wrapper.get('[data-testid="composer-sending"]').text()).toBe("true");

    wrapper.unmount();
  });
});
