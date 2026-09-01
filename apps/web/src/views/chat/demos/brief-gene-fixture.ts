import { BRIEF_GENE_CASE } from "@/views/brief-gene-agent/brief-gene-case";
import { citedMessages } from "./messages";
import type { AgentCaseDemoFixture } from "./types";

export const BRIEF_GENE_CASE_FIXTURE: AgentCaseDemoFixture = {
  tool: "BriefGeneAgent",
  messages: citedMessages(
    "BriefGeneAgent",
    BRIEF_GENE_CASE.question,
    BRIEF_GENE_CASE.content,
    BRIEF_GENE_CASE.references
  ),
};
