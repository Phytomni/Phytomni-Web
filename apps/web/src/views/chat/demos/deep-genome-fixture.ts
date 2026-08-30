import {
  DEEP_GENOME_CASE_MARKDOWN,
  DEEP_GENOME_CASE_QUESTION,
  DEEP_GENOME_CASE_REFERENCES,
  DEEP_GENOME_CASE_RESOURCES,
} from "@/views/deep-genome-agent/deep-genome-case";
import { citedMessages } from "./messages";
import type { AgentCaseDemoFixture } from "./types";

export const DEEP_GENOME_CASE_FIXTURE: AgentCaseDemoFixture = {
  tool: "DeepGenomeAgent",
  messages: citedMessages(
    "DeepGenomeAgent",
    DEEP_GENOME_CASE_QUESTION,
    DEEP_GENOME_CASE_MARKDOWN,
    DEEP_GENOME_CASE_REFERENCES,
    DEEP_GENOME_CASE_RESOURCES
  ),
};
