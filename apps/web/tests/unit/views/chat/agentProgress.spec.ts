import { describe, it, expect } from "vitest";
import {
  AGENT_PROGRESS,
  DEFAULT_PROGRESS,
  progressConfigFor,
  progressAt,
} from "@/views/chat/utils/agentProgress";

describe("agentProgress", () => {
  it("halves remaining space each half-life (50/75/87.5%)", () => {
    expect(progressAt(7500, 7500)).toBeCloseTo(50, 5);
    expect(progressAt(15000, 7500)).toBeCloseTo(75, 5);
    expect(progressAt(22500, 7500)).toBeCloseTo(87.5, 5);
  });
  it("caps at 99 and never reaches 100 on its own", () => {
    expect(progressAt(10 ** 9, 7500)).toBe(99);
    expect(progressAt(0, 7500)).toBeCloseTo(0, 5);
  });
  it("maps known agents to their half-life", () => {
    expect(AGENT_PROGRESS.ChatAgent.halfLifeMs).toBe(7500);
    expect(AGENT_PROGRESS.KnowledgeAgent.halfLifeMs).toBe(45000);
    expect(AGENT_PROGRESS.ReviewAgent.halfLifeMs).toBe(150000);
  });
  it("falls back to ChatAgent config for unknown/empty agent", () => {
    expect(progressConfigFor("NopeAgent")).toBe(DEFAULT_PROGRESS);
    expect(progressConfigFor("")).toBe(DEFAULT_PROGRESS);
    expect(progressConfigFor("DataAgent")).toBe(AGENT_PROGRESS.DataAgent);
  });
});
