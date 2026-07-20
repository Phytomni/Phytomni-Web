import { describe, it, expect, vi, afterEach } from "vitest";
import {
  initReducerState,
  reduceAGUIEvent,
} from "@/views/chat/streaming/eventReducer";

describe("reduceAGUIEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accumulates TextMessageContent into one markdown block", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "TextMessageContent",
      data: { delta: "hello " },
    });
    s = reduceAGUIEvent(s, {
      type: "TextMessageContent",
      data: { delta: "world" },
    });
    const md = s.blocks.find((b) => b.type === "markdown");
    expect(md?.text).toBe("hello world");
    expect(md?.authority).toBe("web");
  });

  it("drops non-string text deltas instead of stringifying hostile payloads", () => {
    const state = reduceAGUIEvent(initReducerState(), {
      type: "TextMessageContent",
      data: { delta: { toString: () => "injected" } },
    });
    expect(state.blocks).toEqual([]);
  });

  it("captures run_id from RunStarted", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "RunStarted", data: { run_id: "r9" } });
    expect(s.runId).toBe("r9");
  });

  it("does not treat message start/end markers as run terminal events", () => {
    let state = reduceAGUIEvent(initReducerState(), {
      type: "TextMessageStart",
      data: {},
    });
    state = reduceAGUIEvent(state, { type: "TextMessageEnd", data: {} });
    expect(state.done).toBe(false);
  });

  it("does not clobber a captured run_id with a later blank RunStarted", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "RunStarted", data: { run_id: "r9" } });
    s = reduceAGUIEvent(s, { type: "RunStarted", data: { run_id: "" } });
    expect(s.runId).toBe("r9");
  });

  it("appends a tool block on ToolCallStart and patches count on ToolCallResult", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "ToolCallStart",
      data: { tool_call_id: "t1", tool_name: "knowledge_search" },
    });
    s = reduceAGUIEvent(s, {
      type: "ToolCallResult",
      data: { tool_call_id: "t1", result_summary: { count: 12 } },
    });
    const tool = s.blocks.find((b) => b.type === "tool");
    expect(tool?.toolName).toBe("knowledge_search");
    expect(tool?.count).toBe(12);
  });

  it("breaks text into separate markdown blocks when a tool interleaves", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "TextMessageContent",
      data: { delta: "before " },
    });
    s = reduceAGUIEvent(s, {
      type: "ToolCallStart",
      data: { tool_name: "knowledge_search" },
    });
    s = reduceAGUIEvent(s, {
      type: "TextMessageContent",
      data: { delta: "after" },
    });
    const md = s.blocks.filter((b) => b.type === "markdown");
    expect(md.map((b) => b.text)).toEqual(["before ", "after"]);
  });

  it("patches count onto the MOST RECENT tool block", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "ToolCallStart",
      data: { tool_name: "first" },
    });
    s = reduceAGUIEvent(s, {
      type: "ToolCallStart",
      data: { tool_name: "second" },
    });
    s = reduceAGUIEvent(s, {
      type: "ToolCallResult",
      data: { result_summary: { count: 7 } },
    });
    const tools = s.blocks.filter((b) => b.type === "tool");
    expect(tools[0].count).toBeUndefined();
    expect(tools[1].count).toBe(7);
  });

  it("adds a reasoning block from ReasoningMessageContent", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "ReasoningMessageContent",
      data: { delta: "weighing retrieval hits" },
    });
    expect(s.blocks.find((b) => b.type === "reasoning")?.text).toBe(
      "weighing retrieval hits"
    );
  });

  it("appends a step block from StepStarted", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "StepStarted",
      data: { step_name: "retrieval" },
    });
    expect(s.blocks.find((b) => b.type === "step")?.label).toBe("retrieval");
  });

  it("marks done and captures follow_up on RunFinished + phyto.follow_up", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: { name: "phyto.follow_up", value: ["q1", "q2"] },
    });
    s = reduceAGUIEvent(s, { type: "RunFinished", data: { run_id: "r9" } });
    expect(s.followUp).toEqual(["q1", "q2"]);
    expect(s.done).toBe(true);
  });

  it("keeps only string follow-up entries", () => {
    const state = reduceAGUIEvent(initReducerState(), {
      type: "Custom",
      data: {
        name: "phyto.follow_up",
        value: ["q1", 7, null, { question: "q2" }],
      },
    });
    expect(state.followUp).toEqual(["q1"]);
  });

  it("captures doc_list from phyto.references (P1 cited streaming)", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: {
        name: "phyto.references",
        value: { doc_list: [{ title: "T1" }] },
      },
    });
    expect(s.references).toEqual([{ title: "T1" }]);
  });

  it("drops non-object citation rows at the stream boundary", () => {
    const state = reduceAGUIEvent(initReducerState(), {
      type: "Custom",
      data: {
        name: "phyto.references",
        value: { doc_list: [{ title: "T1" }, "not-a-document", null] },
      },
    });
    expect(state.references).toEqual([{ title: "T1" }]);
  });

  it("captures error from RunError", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, { type: "RunError", data: { message: "boom" } });
    expect(s.error?.message).toBe("boom");
  });

  it("keeps the first terminal RunError instead of duplicating a synthetic error", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "RunError",
      data: { message: "upstream boom" },
    });
    s = reduceAGUIEvent(s, {
      type: "RunError",
      data: { message: "chat.streamInterrupted" },
    });
    s = reduceAGUIEvent(s, { type: "RunFinished", data: {} });

    expect(s.done).toBe(true);
    expect(s.error?.message).toBe("upstream boom");
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
    expect(b).not.toHaveProperty("surfaceId");
    expect(b).not.toHaveProperty("widget");
    expect(b).not.toHaveProperty("props");
  });

  it("keeps the decoded A2UI surface as the only block representation", () => {
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
    expect(block).not.toHaveProperty("surfaceId");
    expect(block).not.toHaveProperty("widget");
    expect(block).not.toHaveProperty("props");
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

  it("expires ready and submitting agent surfaces on RunError", () => {
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
    expect(b?.a2ui?.state).toEqual({
      status: "expired",
      round: 1,
      code: "run_failed",
    });
    expect(s.error?.message).toBe("boom");
  });

  it("preserves the submitting action identity while expiring on RunError", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: {
        name: "phyto.a2ui",
        value: {
          catalog_version: "v1.0",
          surface_id: "submitting-surface",
          widget: "confirm",
          props: {
            title: "Continue?",
            confirm_label: "Yes",
            cancel_label: "No",
          },
        },
      },
    });
    const block = s.blocks[0];
    block.a2ui = {
      ...block.a2ui!,
      state: {
        status: "submitting",
        round: 1,
        envelope: {
          surface_id: "submitting-surface",
          widget: "confirm",
          action_id: "action-7",
          run_id: "run-7",
          payload: { accepted: true },
        },
      },
    };

    const next = reduceAGUIEvent(s, {
      type: "RunError",
      data: { message: "boom" },
    });
    expect(next.blocks[0].a2ui?.state).toEqual({
      status: "expired",
      round: 1,
      actionId: "action-7",
      code: "run_failed",
    });
  });

  it("skips a duplicate surface in the same message with a fixed reason", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const value = {
      catalog_version: "v1.0",
      surface_id: "duplicate-surface",
      widget: "confirm",
      props: {
        title: "Continue?",
        confirm_label: "Confirm",
        cancel_label: "Cancel",
      },
    };
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: { name: "phyto.a2ui", value },
    });
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: { name: "phyto.a2ui", value },
    });

    expect(
      s.blocks.filter((block) => block.type === "agent-surface")
    ).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      "[phyto.a2ui] skipped frame: duplicate_surface_id"
    );
  });

  it("does not create a partial block for malformed A2UI frames", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: {
        name: "phyto.a2ui",
        value: {
          catalog_version: "v1.0",
          surface_id: "malformed",
          widget: "form",
        },
      },
    });

    expect(s.blocks).toEqual([]);
    expect(
      s.blocks.some((block) => block.type === "agent-surface" && !block.a2ui)
    ).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not expire resolved, expired, or protocol-error surfaces on RunError", () => {
    const surfaces = [
      {
        status: "resolved" as const,
        round: 1 as const,
        actionId: "a1",
        resolution: "submitted" as const,
      },
      { status: "expired" as const, round: 1 as const, code: "old_error" },
      {
        status: "protocol_error" as const,
        round: 1 as const,
        code: "bad_frame",
      },
    ];
    let s = initReducerState();
    for (const state of surfaces) {
      s = reduceAGUIEvent(s, {
        type: "Custom",
        data: {
          name: "phyto.a2ui",
          value: {
            catalog_version: "v1.0",
            surface_id: `surface-${state.status}`,
            widget: "confirm",
            props: {
              title: "Continue?",
              confirm_label: "Yes",
              cancel_label: "No",
            },
          },
        },
      });
      const block = s.blocks.at(-1);
      if (block?.a2ui) block.a2ui = { ...block.a2ui, state };
    }
    const before = s.blocks.map((block) => block.a2ui?.state);
    const next = reduceAGUIEvent(s, {
      type: "RunError",
      data: { message: "boom" },
    });

    expect(next.blocks.map((block) => block.a2ui?.state)).toEqual(before);
  });

  it("keeps a valid input-required surface open when RunFinished arrives", () => {
    let s = initReducerState();
    s = reduceAGUIEvent(s, {
      type: "Custom",
      data: {
        name: "phyto.a2ui",
        value: {
          catalog_version: "v1.0",
          surface_id: "input-required",
          widget: "choice",
          props: {
            title: "Pick",
            options: [{ id: "a", label: "A" }],
            multiple: false,
          },
        },
      },
    });
    s = reduceAGUIEvent(s, { type: "RunFinished", data: { run_id: "run-1" } });

    expect(s.blocks[0].a2ui?.state).toEqual({ status: "ready", round: 1 });
  });
});
