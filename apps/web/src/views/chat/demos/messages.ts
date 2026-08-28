import type { CanonicalAgentTool } from "@/constants/agents";
import type { ChatMessage } from "@/views/chat/types";

export function citedMessages(
  tool: CanonicalAgentTool,
  question: string,
  content: string,
  references: ChatMessage["doc_list"]
): ChatMessage[] {
  return [
    { role: "user", content: question },
    {
      role: "assistant",
      content,
      tool_name: tool,
      doc_list: references,
      showFollowUpQuestions: false,
    },
  ];
}
