import { KNOWLEDGE_CASE } from "@/views/knowledge-agent/knowledge-case";
import { citedMessages } from "./messages";
import type { AgentCaseDemoFixture } from "./types";

export const KNOWLEDGE_CASE_FIXTURE: AgentCaseDemoFixture = {
  tool: "KnowledgeAgent",
  messages: citedMessages(
    "KnowledgeAgent",
    KNOWLEDGE_CASE.question,
    KNOWLEDGE_CASE.content,
    KNOWLEDGE_CASE.references
  ),
};
