import type { ChatMessage } from "../types";

export interface MessageActionCapabilities {
  canRefresh: boolean;
  canReact: boolean;
  generatedFormats: string[];
}

const GENERATED_DOWNLOAD_TOOLS = new Set([
  "ChatAgent",
  "KnowledgeAgent",
  "DataAgent",
  "ReviewAgent",
]);

export function messageActionCapabilities(
  message: Pick<ChatMessage, "role" | "id" | "streaming" | "tool_name">
): MessageActionCapabilities {
  const serverBackedAssistant =
    message.role === "assistant" && !!message.id && !message.streaming;

  if (!serverBackedAssistant) {
    return {
      canRefresh: false,
      canReact: false,
      generatedFormats: [],
    };
  }

  if (!message.tool_name || !GENERATED_DOWNLOAD_TOOLS.has(message.tool_name)) {
    return {
      canRefresh: true,
      canReact: true,
      generatedFormats: [],
    };
  }

  return {
    canRefresh: true,
    canReact: true,
    generatedFormats:
      message.tool_name === "DataAgent"
        ? ["PDF", "Markdown", "Xlsx"]
        : ["PDF", "Markdown", "Word"],
  };
}
