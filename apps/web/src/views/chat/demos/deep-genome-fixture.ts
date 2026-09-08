import {
  DEEP_GENOME_CASE_MARKDOWN,
  DEEP_GENOME_CASE_QUESTION,
  DEEP_GENOME_CASE_REFERENCES,
  DEEP_GENOME_CASE_RESOURCES,
} from "@/views/deep-genome-agent/deep-genome-case";
import { citedMessages } from "./messages";
import type { AgentCaseDemoFixture } from "./types";
import referenceMaterials from "@/views/agent-cases/citations/deep-genome-materials.generated.json";

export const DEEP_GENOME_CASE_FIXTURE: AgentCaseDemoFixture = {
  tool: "DeepGenomeAgent",
  messages: citedMessages(
    "DeepGenomeAgent",
    DEEP_GENOME_CASE_QUESTION,
    DEEP_GENOME_CASE_MARKDOWN,
    DEEP_GENOME_CASE_REFERENCES,
    DEEP_GENOME_CASE_RESOURCES,
    referenceMaterials
  ).map((message) =>
    message.role === "assistant"
      ? {
          ...message,
          casePresentationKey: "deep-genome-os01g0177400",
          status: "SUCCEEDED",
        }
      : message
  ),
};
