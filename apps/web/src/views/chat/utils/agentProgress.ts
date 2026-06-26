// 同步 agent 的感知进度参数源(设计见 .claude/plans/2026-06-26-e2e-ux-remediation-design.md)。
// 键用前端规范 agent 名(发送流当场即有,无需映射到 Bot slug)。
// halfLifeMs(阶段宽 τ)= 预期区间上界 / 4 ⇒ 4 个阶段后到 93.75%。
export interface AgentProgressConfig {
  halfLifeMs: number;
  etaKey: string;
}

export const AGENT_PROGRESS: Record<string, AgentProgressConfig> = {
  ChatAgent: { halfLifeMs: 7500, etaKey: "chat.eta.fast" }, // 约 5–30s
  KnowledgeAgent: { halfLifeMs: 45000, etaKey: "chat.eta.medium" }, // 约 1–3min
  DataAgent: { halfLifeMs: 45000, etaKey: "chat.eta.medium" },
  BriefGeneAgent: { halfLifeMs: 150000, etaKey: "chat.eta.slow" }, // 约 3–10min
  ReviewAgent: { halfLifeMs: 150000, etaKey: "chat.eta.slow" },
};

export const DEFAULT_PROGRESS: AgentProgressConfig = AGENT_PROGRESS.ChatAgent;

// progressConfigFor 取某 agent 的进度配置;未知/空名回退 ChatAgent 档。
export function progressConfigFor(name: string): AgentProgressConfig {
  return AGENT_PROGRESS[name] ?? DEFAULT_PROGRESS;
}

// progressAt 连续指数渐近曲线:min(99, 100·(1 − 2^(−t/τ)))。
// 精确穿过阶段边界(t=τ→50, 2τ→75, 3τ→87.5, 4τ→93.75),全程平滑、封顶 99。
export function progressAt(elapsedMs: number, halfLifeMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.min(99, 100 * (1 - Math.pow(2, -elapsedMs / halfLifeMs)));
}
