import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

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
  };
});

import ChatView, { removeDeletedChat } from "@/views/chat/ChatView.vue";
import { buildChat } from "../../../helpers/chatBuilders";
import { createTestAppContext } from "../../../helpers/test-app-context";

describe("ChatView lifecycle cleanup", () => {
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

  it("renders Research active and timeout lifecycle states without Finished previews", async () => {
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
    expect(row.find(".research-artifact-preview").exists()).toBe(false);
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
    expect(historyTimeout.get(".agent-lifecycle").text()).toBe("Timed out");
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
    expect(polledTimeout.get(".agent-lifecycle").text()).toBe("Timed out");
    expect(polledTimeout.find(".research-artifact-preview").exists()).toBe(
      false
    );
    expect(polledTimeout.text()).not.toContain("No references available.");
    expect(polledTimeout.text()).not.toContain("Finished");
    expect(polledTimeout.text()).not.toContain("Failed");

    wrapper.unmount();
  });
});
