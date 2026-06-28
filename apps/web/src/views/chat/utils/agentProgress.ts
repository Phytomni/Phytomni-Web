// Source of the agent's perceived-progress parameters (design: see
// .claude/plans/2026-06-26-e2e-ux-remediation-design.md).
// Keyed by the frontend canonical agent name (available at send time, no need to
// map to a Bot slug). halfLifeMs (stage width τ) = upper bound of the expected
// range / 4 ⇒ reaches 93.75% after 4 stages.
export interface AgentProgressConfig {
  halfLifeMs: number;
  etaKey: string;
}

export const AGENT_PROGRESS: Record<string, AgentProgressConfig> = {
  ChatAgent: { halfLifeMs: 7500, etaKey: "chat.eta.fast" }, // ~5–30s
  KnowledgeAgent: { halfLifeMs: 45000, etaKey: "chat.eta.medium" }, // ~1–3min
  DataAgent: { halfLifeMs: 45000, etaKey: "chat.eta.medium" },
  BriefGeneAgent: { halfLifeMs: 150000, etaKey: "chat.eta.slow" }, // ~3–10min
  ReviewAgent: { halfLifeMs: 150000, etaKey: "chat.eta.slow" },
};

export const DEFAULT_PROGRESS: AgentProgressConfig = AGENT_PROGRESS.ChatAgent;

// progressConfigFor returns the progress config for an agent; an unknown/empty name falls back to the ChatAgent tier.
export function progressConfigFor(name: string): AgentProgressConfig {
  return AGENT_PROGRESS[name] ?? DEFAULT_PROGRESS;
}

// progressAt: a continuous exponential asymptotic curve: min(99, 100·(1 − 2^(−t/τ))).
// Passes exactly through the stage boundaries (t=τ→50, 2τ→75, 3τ→87.5, 4τ→93.75),
// smooth throughout, capped at 99.
export function progressAt(elapsedMs: number, halfLifeMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.min(99, 100 * (1 - Math.pow(2, -elapsedMs / halfLifeMs)));
}
