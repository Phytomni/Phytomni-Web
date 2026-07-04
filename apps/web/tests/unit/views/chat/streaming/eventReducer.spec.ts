import { describe, it, expect } from "vitest";
import { initReducerState, reduceAGUIEvent } from "@/views/chat/streaming/eventReducer";

describe("reduceAGUIEvent", () => {
  it("accumulates TextMessageContent into one markdown block", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "TextMessageContent", data: { delta: "hello " } });
    s = reduceAGUIEvent(s, { type: "TextMessageContent", data: { delta: "world" } });
    const md = s.blocks.find((b) => b.type === "markdown");
    expect(md?.text).toBe("hello world");
    expect(md?.authority).toBe("web");
  });

  it("captures run_id from RunStarted", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "RunStarted", data: { run_id: "r9" } });
    expect(s.runId).toBe("r9");
  });

  it("does not clobber a captured run_id with a later blank RunStarted", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "RunStarted", data: { run_id: "r9" } });
    s = reduceAGUIEvent(s, { type: "RunStarted", data: { run_id: "" } });
    expect(s.runId).toBe("r9");
  });

  it("appends a tool block on ToolCallStart and patches count on ToolCallResult", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "ToolCallStart", data: { tool_call_id: "t1", tool_name: "knowledge_search" } });
    s = reduceAGUIEvent(s, { type: "ToolCallResult", data: { tool_call_id: "t1", result_summary: { count: 12 } } });
    const tool = s.blocks.find((b) => b.type === "tool");
    expect(tool?.toolName).toBe("knowledge_search");
    expect(tool?.count).toBe(12);
  });

  it("adds a reasoning block from ReasoningMessageContent", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "ReasoningMessageContent", data: { delta: "weighing retrieval hits" } });
    expect(s.blocks.find((b) => b.type === "reasoning")?.text).toBe("weighing retrieval hits");
  });

  it("appends a step block from StepStarted", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "StepStarted", data: { step_name: "retrieval" } });
    expect(s.blocks.find((b) => b.type === "step")?.label).toBe("retrieval");
  });

  it("marks done and captures follow_up on RunFinished + phyto.follow_up", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "Custom", data: { name: "phyto.follow_up", value: ["q1", "q2"] } });
    s = reduceAGUIEvent(s, { type: "RunFinished", data: { run_id: "r9" } });
    expect(s.followUp).toEqual(["q1", "q2"]);
    expect(s.done).toBe(true);
  });

  it("captures doc_list from phyto.references (P1 cited streaming)", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: { name: "phyto.references", value: { doc_list: [{ title: "T1" }] } },
    });
    expect(s.references).toEqual([{ title: "T1" }]);
  });

  it("captures error from RunError", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "RunError", data: { message: "boom" } });
    expect(s.error?.message).toBe("boom");
  });
});
