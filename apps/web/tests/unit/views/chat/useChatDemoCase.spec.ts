import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import {
  applyAgentCaseDemo,
  askThisAgentFromDemo,
  demoAskTarget,
  routeDemoKey,
} from "@/views/chat/composables/useChatDemoCase";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { demoDialogueId } from "@/views/chat/demos/catalog";

describe("useChatDemoCase", () => {
  it("hydrates demo:knowledge from the catalog and does not touch chatList", () => {
    const { currentChatId, getChatState } = useChatStates();
    const chatList: unknown[] = [];
    const applied = applyAgentCaseDemo({
      demoKey: "knowledge",
      currentChatId,
      getChatState,
    });
    expect(applied.ok).toBe(true);
    expect(currentChatId.value).toBe(demoDialogueId("knowledge"));
    expect(chatList).toEqual([]);
    const state = getChatState(currentChatId.value);
    expect(state.renderedChat?.messages.length).toBeGreaterThan(0);
    expect(state.historyHydration).toBe("new");
    expect(state.isSending).toBe(false);
  });

  it("hydrates analyst as empty messages plus empty keys", () => {
    const { currentChatId, getChatState } = useChatStates();
    const applied = applyAgentCaseDemo({
      demoKey: "analyst",
      currentChatId,
      getChatState,
    });
    expect(applied.ok).toBe(true);
    expect(applied.empty?.titleKey).toBe("chat.cases.demoEmpty.title");
    expect(getChatState(currentChatId.value).renderedChat?.messages).toEqual(
      []
    );
  });

  it("returns load-error keys when the fixture is missing", () => {
    const { currentChatId, getChatState } = useChatStates();
    const applied = applyAgentCaseDemo({
      demoKey: "knowledge",
      currentChatId,
      getChatState,
      fixtureOverride: null,
    });
    expect(applied.ok).toBe(false);
    expect(applied.error?.titleKey).toBe("chat.cases.demoLoadError.title");
  });

  it("builds the ask-this-agent target without the example question", () => {
    expect(demoAskTarget("knowledge")).toEqual({
      path: "/chat",
      chatMode: "expert",
      tool: "KnowledgeAgent",
      query: "",
    });
  });

  it("reads demoKey from route meta and ignores unknown keys", () => {
    expect(routeDemoKey({ meta: { demoKey: "knowledge" } })).toBe("knowledge");
    expect(routeDemoKey({ meta: { demoKey: "research" } })).toBeNull();
    expect(routeDemoKey({ meta: {} })).toBeNull();
  });

  it("asks this agent into a new Expert chat with the tool and an empty draft", async () => {
    const chatMode = ref<"instant" | "expert">("instant");
    const messageInput = ref("sample question");
    const selectedAgent = ref("");
    const startNewChat = vi.fn(() => {
      chatMode.value = "instant";
      messageInput.value = "leftover";
      selectedAgent.value = "";
    });
    const router = {
      push: vi.fn().mockResolvedValue(undefined),
    };

    await askThisAgentFromDemo({
      demoKey: "knowledge",
      router,
      startNewChat,
      chatMode,
      messageInput,
      selectedAgent,
      authorizedAgentTools: ["KnowledgeAgent"],
    });

    expect(router.push).toHaveBeenCalledWith({ name: "chat" });
    expect(startNewChat).toHaveBeenCalledTimes(1);
    expect(chatMode.value).toBe("expert");
    expect(selectedAgent.value).toBe("KnowledgeAgent");
    expect(messageInput.value).toBe("");
  });
});
