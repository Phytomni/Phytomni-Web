import type { Ref } from "vue";
import type { CanonicalAgentTool } from "@/constants/agents";
import {
  demoDialogueId,
  fixtureForDemoKey,
  type AgentCaseDemoEmptyCopy,
  type AgentCaseDemoFixture,
  type AgentCaseDemoKey,
} from "@/views/chat/demos/catalog";
import type { ChatUIState } from "@/views/chat/types";

export function applyAgentCaseDemo(options: {
  demoKey: AgentCaseDemoKey;
  currentChatId: Ref<string>;
  getChatState: (id: string) => ChatUIState;
  fixtureOverride?: AgentCaseDemoFixture | null;
}): {
  ok: boolean;
  tool: CanonicalAgentTool | null;
  empty?: AgentCaseDemoEmptyCopy;
  error?: { titleKey: string; bodyKey: string };
} {
  const fixture =
    options.fixtureOverride === undefined
      ? fixtureForDemoKey(options.demoKey)
      : options.fixtureOverride;
  const dialogueId = demoDialogueId(options.demoKey);
  const state = options.getChatState(dialogueId);
  options.currentChatId.value = dialogueId;
  state.historyHydration = "new";
  state.historyErrorKind = null;
  state.isSending = false;
  state.messageInput = "";
  state.fileList = [];
  state.mode = "expert";
  if (!fixture) {
    state.renderedChat = { messages: [] };
    return {
      ok: false,
      tool: null,
      error: {
        titleKey: "chat.cases.demoLoadError.title",
        bodyKey: "chat.cases.demoLoadError.body",
      },
    };
  }
  state.renderedChat = {
    messages: fixture.messages.map((row) => ({ ...row })),
  };
  state.selectedAgent = "";
  return { ok: true, tool: fixture.tool, empty: fixture.empty };
}

export function demoAskTarget(demoKey: AgentCaseDemoKey): {
  path: "/chat";
  chatMode: "expert";
  tool: CanonicalAgentTool;
  query: "";
} {
  const fixture = fixtureForDemoKey(demoKey);
  if (!fixture) {
    throw new Error("demo fixture missing");
  }
  return {
    path: "/chat",
    chatMode: "expert",
    tool: fixture.tool,
    query: "",
  };
}
