// Perceived-progress parameters for the chat wait card.
// Keyed by the frontend canonical agent name (available at send time).
// halfLifeMs (stage width τ) = upper bound of the expected range / 4
// ⇒ reaches 93.75% after 4 stages. etaMinMs/etaMaxMs are honest ranges,
// never used to invent stage copy.

export interface AgentProgressConfig {
  halfLifeMs: number;
  etaMinMs: number;
  etaMaxMs: number;
  /** Graph-derived wait copy. Revealed one key every etaMaxMs / n. */
  stageKeys: readonly string[];
}

export const AGENT_WAIT_PHASES = [
  "PREPARING",
  "RESOLVING_INPUTS",
  "PLANNING",
  "RUNNING",
  "FINALIZING",
] as const;

export type AgentWaitPhase = (typeof AGENT_WAIT_PHASES)[number];

const AGENT_WAIT_PHASE_SET: ReadonlySet<string> = new Set(AGENT_WAIT_PHASES);

export function isAgentWaitPhase(
  phase: string | null | undefined
): phase is AgentWaitPhase {
  return typeof phase === "string" && AGENT_WAIT_PHASE_SET.has(phase);
}

const HOUR_MS = 3_600_000;

export const AGENT_PROGRESS: Record<string, AgentProgressConfig> = {
  ChatAgent: {
    halfLifeMs: 7_500,
    etaMinMs: 5_000,
    etaMaxMs: 30_000,
    stageKeys: [
      "chat.progress.stages.chat.prepareContext",
      "chat.progress.stages.chat.generate",
      "chat.progress.stages.chat.followUp",
    ],
  },
  KnowledgeAgent: {
    halfLifeMs: 45_000,
    etaMinMs: 60_000,
    etaMaxMs: 180_000,
    stageKeys: [
      "chat.progress.stages.knowledge.processFiles",
      "chat.progress.stages.knowledge.retrieve",
      "chat.progress.stages.knowledge.prepareGenerate",
      "chat.progress.stages.knowledge.generate",
      "chat.progress.stages.knowledge.assemble",
      "chat.progress.stages.knowledge.prepareFollowUp",
      "chat.progress.stages.knowledge.followUp",
    ],
  },
  DataAgent: {
    halfLifeMs: 45_000,
    etaMinMs: 60_000,
    etaMaxMs: 180_000,
    stageKeys: [
      "chat.progress.stages.data.prepareRetrieve",
      "chat.progress.stages.data.searchKnowledge",
      "chat.progress.stages.data.collectRetrieve",
      "chat.progress.stages.data.prepareRewrite",
      "chat.progress.stages.data.rewriteQuery",
      "chat.progress.stages.data.applyRewrite",
      "chat.progress.stages.data.searchCatalog",
    ],
  },
  BriefGeneAgent: {
    halfLifeMs: 150_000,
    etaMinMs: 180_000,
    etaMaxMs: 600_000,
    stageKeys: [
      "chat.progress.stages.briefGene.parseQuery",
      "chat.progress.stages.briefGene.fetchAnnotation",
      "chat.progress.stages.briefGene.prepareRetrieve",
      "chat.progress.stages.briefGene.retrieveWorker",
      "chat.progress.stages.briefGene.retrieveReduce",
      "chat.progress.stages.briefGene.prepareGenerate",
      "chat.progress.stages.briefGene.generate",
      "chat.progress.stages.briefGene.prepareFollowUp",
      "chat.progress.stages.briefGene.followUp",
    ],
  },
  ReviewAgent: {
    halfLifeMs: 150_000,
    etaMinMs: 180_000,
    etaMaxMs: 600_000,
    stageKeys: [
      "chat.progress.stages.review.planPrep",
      "chat.progress.stages.review.planPost",
      "chat.progress.stages.review.retrieveDispatch",
      "chat.progress.stages.review.retrieveWorker",
      "chat.progress.stages.review.retrieveReduce",
      "chat.progress.stages.review.draftDispatch",
      "chat.progress.stages.review.draftWorker",
      "chat.progress.stages.review.draftReduce",
      "chat.progress.stages.review.reviewDispatch",
      "chat.progress.stages.review.reviewWorker",
      "chat.progress.stages.review.reviewReduce",
      "chat.progress.stages.review.reviseDispatch",
      "chat.progress.stages.review.reviseWorker",
      "chat.progress.stages.review.reviseReduce",
      "chat.progress.stages.review.summaryPrep",
      "chat.progress.stages.review.summaryPost",
      "chat.progress.stages.review.prepareFollowUp",
      "chat.progress.stages.review.followUp",
    ],
  },
  AnalystAgent: {
    halfLifeMs: 6 * HOUR_MS,
    etaMinMs: 1 * HOUR_MS,
    etaMaxMs: 24 * HOUR_MS,
    stageKeys: [
      "chat.progress.stages.analyst.parsePrep",
      "chat.progress.stages.analyst.parsePost",
      "chat.progress.stages.analyst.selectPrep",
      "chat.progress.stages.analyst.selectPost",
      "chat.progress.stages.analyst.methodPrep",
      "chat.progress.stages.analyst.methodKnowledge",
      "chat.progress.stages.analyst.methodPost",
      "chat.progress.stages.analyst.planPrep",
      "chat.progress.stages.analyst.planPost",
      "chat.progress.stages.analyst.checkPrep",
      "chat.progress.stages.analyst.checkPost",
      "chat.progress.stages.analyst.toolExtractPrep",
      "chat.progress.stages.analyst.toolExtractPost",
      "chat.progress.stages.analyst.toolRetrieve",
      "chat.progress.stages.analyst.submit",
      "chat.progress.stages.analyst.pool",
    ],
  },
  DeepGenomeAgent: {
    halfLifeMs: 18 * HOUR_MS,
    etaMinMs: 24 * HOUR_MS,
    etaMaxMs: 72 * HOUR_MS,
    stageKeys: [
      "chat.progress.stages.deepGenome.brief",
      "chat.progress.stages.deepGenome.prepare",
      "chat.progress.stages.deepGenome.tissues",
      "chat.progress.stages.deepGenome.cultivars",
      "chat.progress.stages.deepGenome.treatments",
      "chat.progress.stages.deepGenome.genotypes",
      "chat.progress.stages.deepGenome.singleCell",
      "chat.progress.stages.deepGenome.promoter",
      "chat.progress.stages.deepGenome.smep",
      "chat.progress.stages.deepGenome.smoc",
      "chat.progress.stages.deepGenome.protein",
      "chat.progress.stages.deepGenome.design",
      "chat.progress.stages.deepGenome.evolution",
      "chat.progress.stages.deepGenome.synthesize",
      "chat.progress.stages.deepGenome.experiment",
      "chat.progress.stages.deepGenome.protocol",
      "chat.progress.stages.deepGenome.discussion",
      "chat.progress.stages.deepGenome.summary",
      "chat.progress.stages.deepGenome.followUp",
    ],
  },
  DigitalDesignAgent: {
    halfLifeMs: 12 * HOUR_MS,
    etaMinMs: 12 * HOUR_MS,
    etaMaxMs: 48 * HOUR_MS,
    stageKeys: [
      "chat.progress.stages.design.prepare",
      "chat.progress.stages.design.protein",
      "chat.progress.stages.design.promoter",
      "chat.progress.stages.design.resume",
      "chat.progress.stages.design.wait",
    ],
  },
  GeneNetworkAgent: {
    halfLifeMs: 6 * HOUR_MS,
    etaMinMs: 6 * HOUR_MS,
    etaMaxMs: 24 * HOUR_MS,
    stageKeys: [
      "chat.progress.stages.network.prepare",
      "chat.progress.stages.network.submit",
      "chat.progress.stages.network.build",
      "chat.progress.stages.network.wait",
    ],
  },
  InSilicoResearchAgent: {
    halfLifeMs: 18 * HOUR_MS,
    etaMinMs: 24 * HOUR_MS,
    etaMaxMs: 72 * HOUR_MS,
    stageKeys: [
      "chat.progress.stages.research.validate",
      "chat.progress.stages.research.resolveInputs",
      "chat.progress.stages.research.extract",
      "chat.progress.stages.research.plan",
      "chat.progress.stages.research.prepare",
      "chat.progress.stages.research.run",
      "chat.progress.stages.research.resume",
      "chat.progress.stages.research.pack",
    ],
  },
};

export const DEFAULT_PROGRESS: AgentProgressConfig = AGENT_PROGRESS.ChatAgent;

export function progressConfigFor(name: string): AgentProgressConfig {
  return AGENT_PROGRESS[name] ?? DEFAULT_PROGRESS;
}

// progressAt: a continuous exponential asymptotic curve: min(98, 100·(1 − 2^(−t/τ))).
// Passes exactly through the stage boundaries (t=τ→50, 2τ→75, 3τ→87.5, 4τ→93.75),
// smooth throughout, capped at 98 before completing.
export function progressAt(elapsedMs: number, halfLifeMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.min(98, 100 * (1 - Math.pow(2, -elapsedMs / halfLifeMs)));
}

export const COT_FLUSH_STEP_MS = 90;

export function stepDurationMs(config: AgentProgressConfig): number {
  return config.etaMaxMs / Math.max(1, config.stageKeys.length);
}

export function revealedStageCount(
  elapsedMs: number,
  config: AgentProgressConfig,
  options: { forceAll?: boolean } = {}
): number {
  const total = config.stageKeys.length;
  if (total === 0) return 0;
  if (options.forceAll) return total;
  if (elapsedMs <= 0) return 1;
  return Math.min(total, Math.floor(elapsedMs / stepDurationMs(config)) + 1);
}

export function remainingCotFlushMs(
  elapsedMs: number,
  config: AgentProgressConfig
): number {
  const shown = revealedStageCount(elapsedMs, config);
  return Math.max(0, config.stageKeys.length - shown) * COT_FLUSH_STEP_MS;
}

export function stageKeyAt(
  elapsedMs: number,
  config: AgentProgressConfig,
  options: { forceLast?: boolean } = {}
): string {
  const keys = config.stageKeys;
  if (keys.length === 0) return "chat.progress.processing";
  const shown = revealedStageCount(elapsedMs, config, {
    forceAll: options.forceLast,
  });
  return keys[Math.max(0, shown - 1)] ?? keys[0] ?? "chat.progress.processing";
}

export type EtaUnit = "seconds" | "minutes" | "hours";

export interface EtaRange {
  unit: EtaUnit;
  min: number;
  max: number;
}

export const ETA_I18N_KEYS: Record<EtaUnit, string> = {
  seconds: "chat.progress.etaSeconds",
  minutes: "chat.progress.etaMinutes",
  hours: "chat.progress.etaHours",
};

export function etaRangeFor(config: AgentProgressConfig): EtaRange {
  if (config.etaMaxMs >= HOUR_MS) {
    return {
      unit: "hours",
      min: Math.max(1, Math.round(config.etaMinMs / HOUR_MS)),
      max: Math.max(1, Math.round(config.etaMaxMs / HOUR_MS)),
    };
  }
  if (config.etaMaxMs < 90_000) {
    return {
      unit: "seconds",
      min: Math.max(1, Math.round(config.etaMinMs / 1_000)),
      max: Math.max(1, Math.round(config.etaMaxMs / 1_000)),
    };
  }
  return {
    unit: "minutes",
    min: Math.max(1, Math.round(config.etaMinMs / 60_000)),
    max: Math.max(1, Math.round(config.etaMaxMs / 60_000)),
  };
}

const startedAtByKey = new Map<string, number>();

export function rememberProgressStartedAt(
  key: string,
  startedAt: number
): void {
  if (!key || !Number.isFinite(startedAt)) return;
  startedAtByKey.set(key, startedAt);
}

const MYSQL_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

export function parseProgressStartedAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const mysql = MYSQL_DATETIME.exec(trimmed);
  const normalized = mysql ? `${mysql[1]}T${mysql[2]}` : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function progressHintForWait(input: {
  sendStartedAt?: number | null;
  createdAt?: unknown;
}): number | null {
  if (
    typeof input.sendStartedAt === "number" &&
    Number.isFinite(input.sendStartedAt)
  ) {
    return input.sendStartedAt;
  }
  return parseProgressStartedAt(input.createdAt);
}

export function progressStartedAtFor(
  key: string,
  hint?: number | null
): number {
  if (typeof hint === "number" && Number.isFinite(hint)) {
    if (key) startedAtByKey.set(key, hint);
    return hint;
  }
  if (key) {
    const existing = startedAtByKey.get(key);
    if (existing != null) return existing;
    const now = Date.now();
    startedAtByKey.set(key, now);
    return now;
  }
  return Date.now();
}

export function resetProgressStartedAtForTests(): void {
  startedAtByKey.clear();
}
