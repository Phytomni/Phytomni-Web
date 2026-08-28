import { describe, expect, it } from "vitest";
import {
  applyAgentCaseDemo,
  demoAskTarget,
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
});
