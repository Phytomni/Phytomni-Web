import type { CanonicalAgentTool } from "@/constants/agents";
import type { ChatMessage } from "@/views/chat/types";

export const AGENT_CASE_DEMO_KEYS = [
  "knowledge",
  "data",
  "analyst",
  "review",
  "network",
  "brief-gene",
  "deep-genome",
  "design",
] as const;

export type AgentCaseDemoKey = (typeof AGENT_CASE_DEMO_KEYS)[number];

export const DEMO_DIALOGUE_PREFIX = "demo:" as const;

export interface AgentCaseDemoEmptyCopy {
  titleKey: string;
  bodyKey: string;
}

/** Tape loaded into ChatView for a `/cases/…` demo dialogue. */
export interface AgentCaseDemoFixture {
  tool: CanonicalAgentTool;
  messages: ChatMessage[];
  empty?: AgentCaseDemoEmptyCopy;
}

const AGENT_CASE_DEMO_KEY_SET: ReadonlySet<string> = new Set(
  AGENT_CASE_DEMO_KEYS
);

export function isAgentCaseDemoKey(value: unknown): value is AgentCaseDemoKey {
  return typeof value === "string" && AGENT_CASE_DEMO_KEY_SET.has(value);
}

export function demoDialogueId(key: AgentCaseDemoKey): string {
  return `${DEMO_DIALOGUE_PREFIX}${key}`;
}

export function isDemoDialogueId(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(DEMO_DIALOGUE_PREFIX);
}
