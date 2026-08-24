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
  "BriefGeneAgent",
  "DeepGenomeAgent",
]);

export function generatedFormatsForTool(
  tool: string | null | undefined
): string[] {
  if (!tool || !GENERATED_DOWNLOAD_TOOLS.has(tool)) return [];
  return tool === "DataAgent"
    ? ["PDF", "Markdown", "Xlsx"]
    : ["PDF", "Markdown", "Word"];
}

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

  return {
    canRefresh: true,
    canReact: true,
    generatedFormats: generatedFormatsForTool(message.tool_name),
  };
}
