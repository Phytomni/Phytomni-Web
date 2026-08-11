import { describe, expect, it } from "vitest";
import {
  CANONICAL_AGENT_CASE_ROUTES,
  CANONICAL_AGENT_ROUTES,
} from "@/constants/agents";
import { createChatVisualFixtureRouter } from "../../visual/chat/fixture-router";

describe("Chat visual fixture router", () => {
  it("registers every live and case-card agent destination", () => {
    const paths = new Set(
      createChatVisualFixtureRouter()
        .getRoutes()
        .map((route) => route.path)
    );

    for (const path of [
      ...Object.values(CANONICAL_AGENT_ROUTES),
      ...Object.values(CANONICAL_AGENT_CASE_ROUTES),
    ]) {
      expect(paths).toContain(path);
    }
  });
});
