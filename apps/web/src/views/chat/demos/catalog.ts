export * from "./types";

import { ANALYST_CASE_FIXTURE } from "./analyst-fixture";
import { BRIEF_GENE_CASE_FIXTURE } from "./brief-gene-fixture";
import { DATA_CASE_FIXTURE } from "./data-fixture";
import { DEEP_GENOME_CASE_FIXTURE } from "./deep-genome-fixture";
import { DESIGN_CASE_FIXTURE } from "./design-fixture";
import { KNOWLEDGE_CASE_FIXTURE } from "./knowledge-fixture";
import { NETWORK_CASE_FIXTURE } from "./network-fixture";
import { REVIEW_CASE_FIXTURE } from "./review-fixture";
import type { AgentCaseDemoFixture, AgentCaseDemoKey } from "./types";

const FIXTURES: Partial<Record<AgentCaseDemoKey, AgentCaseDemoFixture>> = {
  knowledge: KNOWLEDGE_CASE_FIXTURE,
  data: DATA_CASE_FIXTURE,
  analyst: ANALYST_CASE_FIXTURE,
  review: REVIEW_CASE_FIXTURE,
  network: NETWORK_CASE_FIXTURE,
  "brief-gene": BRIEF_GENE_CASE_FIXTURE,
  "deep-genome": DEEP_GENOME_CASE_FIXTURE,
  design: DESIGN_CASE_FIXTURE,
};

export function fixtureForDemoKey(
  key: AgentCaseDemoKey
): AgentCaseDemoFixture | null {
  return FIXTURES[key] ?? null;
}
