import type { AgentCaseDemoFixture } from "./types";

/** Analyst case tape: empty so slice 1 does not fake a report. */
export const ANALYST_CASE_FIXTURE: AgentCaseDemoFixture = {
  tool: "AnalystAgent",
  messages: [],
  empty: {
    titleKey: "chat.cases.demoEmpty.title",
    bodyKey: "chat.cases.demoEmpty.body",
  },
};
