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

  it("breaks text into separate markdown blocks when a tool interleaves", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "TextMessageContent", data: { delta: "before " } });
    s = reduceAGUIEvent(s, { type: "ToolCallStart", data: { tool_name: "knowledge_search" } });
    s = reduceAGUIEvent(s, { type: "TextMessageContent", data: { delta: "after" } });
    const md = s.blocks.filter((b) => b.type === "markdown");
    expect(md.map((b) => b.text)).toEqual(["before ", "after"]);
  });

  it("patches count onto the MOST RECENT tool block", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "ToolCallStart", data: { tool_name: "first" } });
    s = reduceAGUIEvent(s, { type: "ToolCallStart", data: { tool_name: "second" } });
    s = reduceAGUIEvent(s, { type: "ToolCallResult", data: { result_summary: { count: 7 } } });
    const tools = s.blocks.filter((b) => b.type === "tool");
    expect(tools[0].count).toBeUndefined();
    expect(tools[1].count).toBe(7);
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

  it("pushes an agent-surface block from phyto.a2ui confirm", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "RunStarted", data: { run_id: "r1" } });
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: {
        name: "phyto.a2ui",
        value: {
          catalog_version: "v1.0",
          surface_id: "surf-1",
          widget: "confirm",
          props: {
            title: "OK?",
            confirm_label: "Confirm",
            cancel_label: "Cancel",
          },
        },
      },
    });
    const b = s.blocks.find((x) => x.type === "agent-surface");
    expect(b?.authority).toBe("agent");
    expect(b?.interactive).toBe(true);
    expect(b?.a2ui).toEqual({
      surface: {
        catalog_version: "v1.0",
        surface_id: "surf-1",
        widget: "confirm",
        props: {
          title: "OK?",
          confirm_label: "Confirm",
          cancel_label: "Cancel",
        },
      },
      state: { status: "ready", round: 1 },
    });
    expect(b?.surfaceId).toBe("surf-1");
    expect(b?.widget).toBe("confirm");
    expect(b?.props).toEqual({
      title: "OK?",
      confirm_label: "Confirm",
      cancel_label: "Cancel",
    });
  });

  it("keeps the decoded A2UI surface typed beside temporary aliases", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: {
        name: "phyto.a2ui",
        value: {
          catalog_version: "v1.0",
          surface_id: "form-1",
          widget: "form",
          props: {
            title: "Details",
            fields: [
              {
                name: "gene",
                label: "Gene",
                type: "text",
                required: true,
              },
            ],
          },
        },
      },
    });

    const block = s.blocks.find((x) => x.type === "agent-surface");
    expect(block?.a2ui?.surface.widget).toBe("form");
    expect(block?.a2ui?.surface.props).toEqual({
      title: "Details",
      fields: [
        {
          name: "gene",
          label: "Gene",
          type: "text",
          required: true,
        },
      ],
    });
    expect(block?.a2ui?.state).toEqual({ status: "ready", round: 1 });
    expect(block?.surfaceId).toBe(block?.a2ui?.surface.surface_id);
    expect(block?.widget).toBe(block?.a2ui?.surface.widget);
    expect(block?.props).toBe(block?.a2ui?.surface.props);
  });

  it("skips phyto.a2ui with unknown widget without adding a block", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: {
        name: "phyto.a2ui",
        value: {
          catalog_version: "v1.0",
          surface_id: "s",
          widget: "chart",
          props: {},
        },
      },
    });
    expect(s.blocks.filter((b) => b.type === "agent-surface")).toHaveLength(0);
  });

  it("skips phyto.a2ui when catalog is below v1", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: {
        name: "phyto.a2ui",
        value: {
          catalog_version: "v0.9.1",
          surface_id: "s",
          widget: "form",
          props: {},
        },
      },
    });
    expect(s.blocks.filter((b) => b.type === "agent-surface")).toHaveLength(0);
  });

  it("marks interactive agent-surface blocks failed on RunError", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: {
        name: "phyto.a2ui",
        value: {
          catalog_version: "v1.0",
          surface_id: "s",
          widget: "choice",
          props: {
            title: "Pick",
            options: [{ id: "a", label: "A" }],
            multiple: false,
          },
        },
      },
    });
    s = reduceAGUIEvent(s, { type: "RunError", data: { message: "boom" } });
    const b = s.blocks.find((x) => x.type === "agent-surface");
    expect(b?.failed).toBe(true);
    expect(s.error?.message).toBe("boom");
  });
});
