import type { Ref } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import type { CanonicalAgentTool } from "@/constants/agents";
import {
  demoDialogueId,
  fixtureForDemoKey,
  isAgentCaseDemoKey,
  type AgentCaseDemoEmptyCopy,
  type AgentCaseDemoFixture,
  type AgentCaseDemoKey,
} from "@/views/chat/demos/catalog";
import type { ChatUIState } from "@/views/chat/types";

export function routeDemoKey(
  route: Pick<RouteLocationNormalizedLoaded, "meta">
): AgentCaseDemoKey | null {
  return isAgentCaseDemoKey(route.meta.demoKey) ? route.meta.demoKey : null;
}

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

export async function askThisAgentFromDemo(options: {
  demoKey: AgentCaseDemoKey;
  router: { push: (to: { name: string }) => Promise<unknown> };
  startNewChat: () => void;
  chatMode: { value: "instant" | "expert" };
  messageInput: { value: string };
  selectedAgent: { value: string };
  authorizedAgentTools: readonly string[];
}): Promise<void> {
  const target = demoAskTarget(options.demoKey);
  await options.router.push({ name: "chat" });
  options.startNewChat();
  options.chatMode.value = target.chatMode;
  options.messageInput.value = target.query;
  if (options.authorizedAgentTools.includes(target.tool)) {
    options.selectedAgent.value = target.tool;
  }
}
