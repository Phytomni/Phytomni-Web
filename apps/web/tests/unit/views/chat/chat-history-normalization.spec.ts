import { describe, expect, it } from "vitest";
import {
  normalizeHistoryRows,
  resolveHistoryQuestion,
} from "@/views/chat/utils/chat-history-normalization";

describe("chat history normalization", () => {
  it("uses title_query for a legacy row without query", () => {
    expect(
      resolveHistoryQuestion(
        { title_query: "你的功能是什么?", answer: "" },
        "sidebar title"
      )
    ).toBe("你的功能是什么?");
  });

  it("drops non-record rows and never fabricates answer content", () => {
    expect(
      normalizeHistoryRows([null, "bad", { title_query: "Question" }])
    ).toHaveLength(1);
    expect(resolveHistoryQuestion({ title_query: "Question" }, "")).toBe(
      "Question"
    );
  });

  it("uses a non-empty conversation title only after row question fields", () => {
    expect(resolveHistoryQuestion({}, "  Sidebar title  ")).toBe(
      "Sidebar title"
    );
    expect(
      resolveHistoryQuestion(
        { query: "  canonical question ", title_query: "legacy question" },
        "sidebar title"
      )
    ).toBe("canonical question");
  });
});
