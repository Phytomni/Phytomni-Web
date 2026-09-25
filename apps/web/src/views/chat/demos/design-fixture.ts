import type { AgentCaseDemoFixture } from "./types";

export const DESIGN_CASE_QUESTION =
  "Please help me design the protein structure based on evolution information for rice gene Os01g0177400.";

/** Design case tape: question + static zip download (no invented report). */
export const DESIGN_CASE_FIXTURE: AgentCaseDemoFixture = {
  tool: "DigitalDesignAgent",
  messages: [
    {
      role: "user",
      content: DESIGN_CASE_QUESTION,
    },
    {
      role: "assistant",
      content: "Sample task id: 3b5564b-772a-44f0-abc5-fb163e7d13c4",
      tool_name: "DigitalDesignAgent",
      download_path:
        "/static/downloads/7.Digital Design Agent/2.DigitalAgent/results/design_results.zip",
    },
  ],
};
