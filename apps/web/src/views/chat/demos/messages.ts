import type { CanonicalAgentTool } from "@/constants/agents";
import type { ChatMessage } from "@/views/chat/types";

export function citedMessages(
  tool: CanonicalAgentTool,
  question: string,
  content: string,
  references: ChatMessage["doc_list"],
  resources?: ChatMessage["resources"]
): ChatMessage[] {
  return [
    { role: "user", content: question },
    {
      role: "assistant",
      content,
      tool_name: tool,
      doc_list: references,
      ...(resources && resources.length > 0 ? { resources } : {}),
      showFollowUpQuestions: false,
    },
  ];
}
