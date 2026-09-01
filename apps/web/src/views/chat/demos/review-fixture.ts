import { REVIEW_CASE } from "@/views/review-agent/review-case";
import { citedMessages } from "./messages";
import type { AgentCaseDemoFixture } from "./types";

export const REVIEW_CASE_FIXTURE: AgentCaseDemoFixture = {
  tool: "ReviewAgent",
  messages: citedMessages(
    "ReviewAgent",
    REVIEW_CASE.question,
    REVIEW_CASE.content,
    REVIEW_CASE.references
  ),
};
