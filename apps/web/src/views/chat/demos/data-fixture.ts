import { DATA_CASE } from "@/views/data-agent/data-case";
import type { AgentCaseDemoFixture } from "./types";

export const DATA_CASE_FIXTURE: AgentCaseDemoFixture = {
  tool: "DataAgent",
  messages: DATA_CASE.flatMap((round) => [
    { role: "user", content: round.question },
    { role: "assistant", content: round.response, tool_name: "DataAgent" },
  ]),
};
