import { describe, it, expect, afterEach } from "vitest";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import {
  AGENT_PROGRESS,
  DEFAULT_PROGRESS,
  progressConfigFor,
  progressAt,
  etaRangeFor,
  isAgentWaitPhase,
  parseProgressStartedAt,
  progressHintForWait,
  progressStartedAtFor,
  rememberProgressStartedAt,
  resetProgressStartedAtForTests,
  remainingCotFlushMs,
  revealedStageCount,
  stageKeyAt,
} from "@/views/chat/utils/agentProgress";

const messageAt = (messages: unknown, path: string) =>
  path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object" && key in node) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, messages);

describe("agentProgress", () => {
  afterEach(() => {
    resetProgressStartedAtForTests();
  });

  it("halves remaining space each half-life (50/75/87.5%)", () => {
    expect(progressAt(7500, 7500)).toBeCloseTo(50, 5);
    expect(progressAt(15000, 7500)).toBeCloseTo(75, 5);
    expect(progressAt(22500, 7500)).toBeCloseTo(87.5, 5);
  });

  it("caps at 98 and never reaches 100 on its own", () => {
    expect(progressAt(10 ** 9, 7500)).toBe(98);
    expect(progressAt(0, 7500)).toBeCloseTo(0, 5);
  });

  it("covers every canonical agent with a half-life and honest eta range", () => {
    expect(AGENT_PROGRESS.ChatAgent.halfLifeMs).toBe(7500);
    expect(AGENT_PROGRESS.KnowledgeAgent.halfLifeMs).toBe(45000);
    expect(AGENT_PROGRESS.DataAgent.halfLifeMs).toBe(45000);
    expect(AGENT_PROGRESS.ReviewAgent.halfLifeMs).toBe(150000);
    expect(AGENT_PROGRESS.BriefGeneAgent.halfLifeMs).toBe(150000);
    for (const tool of CANONICAL_AGENT_TOOLS) {
      expect(AGENT_PROGRESS[tool], tool).toBeDefined();
      expect(AGENT_PROGRESS[tool].halfLifeMs).toBeGreaterThan(0);
      expect(AGENT_PROGRESS[tool].etaMinMs).toBeGreaterThan(0);
      expect(AGENT_PROGRESS[tool].etaMaxMs).toBeGreaterThanOrEqual(
        AGENT_PROGRESS[tool].etaMinMs
      );
      expect(AGENT_PROGRESS[tool]).not.toHaveProperty("etaKey");
    }
    expect(DEFAULT_PROGRESS).not.toHaveProperty("etaKey");
    expect(AGENT_PROGRESS.DigitalDesignAgent.halfLifeMs).toBeGreaterThan(
      AGENT_PROGRESS.ChatAgent.halfLifeMs
    );
    expect(AGENT_PROGRESS.DeepGenomeAgent.halfLifeMs).toBeGreaterThan(
      AGENT_PROGRESS.ChatAgent.halfLifeMs
    );
    expect(AGENT_PROGRESS.InSilicoResearchAgent.halfLifeMs).toBeGreaterThan(
      AGENT_PROGRESS.KnowledgeAgent.halfLifeMs
    );
  });

  it("formats eta as seconds, minutes, or hours from the agent range", () => {
    expect(etaRangeFor(AGENT_PROGRESS.ChatAgent)).toEqual({
      unit: "seconds",
      min: 5,
      max: 30,
    });
    expect(etaRangeFor(AGENT_PROGRESS.KnowledgeAgent)).toEqual({
      unit: "minutes",
      min: 1,
      max: 3,
    });
    expect(etaRangeFor(AGENT_PROGRESS.AnalystAgent)).toEqual({
      unit: "hours",
      min: 1,
      max: 24,
    });
    expect(etaRangeFor(AGENT_PROGRESS.DigitalDesignAgent)).toEqual({
      unit: "hours",
      min: 12,
      max: 48,
    });
    expect(etaRangeFor(AGENT_PROGRESS.GeneNetworkAgent)).toEqual({
      unit: "hours",
      min: 6,
      max: 24,
    });
    expect(etaRangeFor(AGENT_PROGRESS.DeepGenomeAgent)).toEqual({
      unit: "hours",
      min: 24,
      max: 72,
    });
    expect(etaRangeFor(AGENT_PROGRESS.InSilicoResearchAgent)).toEqual({
      unit: "hours",
      min: 24,
      max: 72,
    });
  });

  it("reveals graph steps evenly across the estimated total duration", () => {
    const chat = AGENT_PROGRESS.ChatAgent;
    expect(revealedStageCount(0, chat)).toBe(1);
    expect(stageKeyAt(0, chat)).toBe(
      "chat.progress.stages.chat.prepareContext"
    );
    expect(revealedStageCount(10_000, chat)).toBe(2);
    expect(stageKeyAt(10_000, chat)).toBe("chat.progress.stages.chat.generate");
    expect(revealedStageCount(30_000, chat)).toBe(3);
    expect(stageKeyAt(0, chat, { forceLast: true })).toBe(
      "chat.progress.stages.chat.followUp"
    );
    expect(remainingCotFlushMs(0, chat)).toBe(180);
    expect(AGENT_PROGRESS.DigitalDesignAgent.stageKeys).toHaveLength(5);
    expect(AGENT_PROGRESS.GeneNetworkAgent.stageKeys).toHaveLength(4);
    expect(AGENT_PROGRESS.DeepGenomeAgent.stageKeys.length).toBeGreaterThan(10);
    expect(AGENT_PROGRESS.ReviewAgent.stageKeys.length).toBeGreaterThan(10);
    for (const [name, config] of Object.entries(AGENT_PROGRESS)) {
      for (const key of config.stageKeys) {
        expect(messageAt(enUS, key), `${name} ${key} en`).toEqual(
          expect.any(String)
        );
        expect(messageAt(zhCN, key), `${name} ${key} zh`).toEqual(
          expect.any(String)
        );
      }
    }
  });

  it("treats preparing through finalizing as wait phases", () => {
    expect(isAgentWaitPhase("RUNNING")).toBe(true);
    expect(isAgentWaitPhase("FINALIZING")).toBe(true);
    expect(isAgentWaitPhase("SUCCEEDED")).toBe(false);
    expect(isAgentWaitPhase("TIMED_OUT")).toBe(false);
    expect(isAgentWaitPhase(null)).toBe(false);
  });

  it("reuses a remembered start time so refresh does not reset the curve", () => {
    rememberProgressStartedAt("row-1", 1_700_000_000_000);
    expect(progressStartedAtFor("row-1")).toBe(1_700_000_000_000);
    expect(progressStartedAtFor("row-1", 1_800_000_000_000)).toBe(
      1_800_000_000_000
    );
  });

  it("parses history created_at into an epoch start time", () => {
    expect(parseProgressStartedAt("2026-08-19T13:52:46Z")).toBe(
      Date.parse("2026-08-19T13:52:46Z")
    );
    expect(parseProgressStartedAt("2026-08-19 21:52:46")).toBe(
      Date.parse("2026-08-19T21:52:46")
    );
    expect(parseProgressStartedAt("")).toBeNull();
    expect(parseProgressStartedAt("not-a-date")).toBeNull();
  });

  it("keeps live sendStartedAt and reconstructs a reload from created_at", () => {
    const createdAt = "2026-08-19T13:52:46Z";
    const createdMs = Date.parse(createdAt);
    expect(
      progressHintForWait({
        sendStartedAt: 1_700_000_000_000,
        createdAt,
      })
    ).toBe(1_700_000_000_000);
    expect(
      progressHintForWait({
        sendStartedAt: null,
        createdAt,
      })
    ).toBe(createdMs);
    const elapsed = 9.34 * 3_600_000;
    expect(
      Math.round(progressAt(elapsed, AGENT_PROGRESS.AnalystAgent.halfLifeMs))
    ).toBe(66);
  });

  it("falls back to ChatAgent config for unknown/empty agent", () => {
    expect(progressConfigFor("NopeAgent")).toBe(DEFAULT_PROGRESS);
    expect(progressConfigFor("")).toBe(DEFAULT_PROGRESS);
    expect(progressConfigFor("DataAgent")).toBe(AGENT_PROGRESS.DataAgent);
    expect(progressConfigFor("DigitalDesignAgent")).toBe(
      AGENT_PROGRESS.DigitalDesignAgent
    );
  });
});
