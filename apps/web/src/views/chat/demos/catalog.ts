export * from "./types";

import { ANALYST_CASE_FIXTURE } from "./analyst-fixture";
import type { AgentCaseDemoFixture, AgentCaseDemoKey } from "./types";

const FIXTURES: Partial<Record<AgentCaseDemoKey, AgentCaseDemoFixture>> = {
  analyst: ANALYST_CASE_FIXTURE,
};

export function fixtureForDemoKey(
  key: AgentCaseDemoKey
): AgentCaseDemoFixture | null {
  return FIXTURES[key] ?? null;
}
