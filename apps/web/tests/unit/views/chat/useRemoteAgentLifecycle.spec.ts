import { nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskLifecycle } from "@/api/types";
import type { BotRunProjection } from "@/views/chat/botProjection";
import type { BotRemoteAgentRunState } from "@/views/chat/composables/useBotRemoteAgentRun";
import { useRemoteAgentLifecycle } from "@/views/chat/composables/useRemoteAgentLifecycle";

const mocks = vi.hoisted(() => ({
  getTaskLifecycle: vi.fn(),
  getAnswerCheck: vi.fn(),
  abortRequest: vi.fn(),
}));

vi.mock("@/api/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/task")>();
  return { ...actual, getTaskLifecycle: mocks.getTaskLifecycle };
});

vi.mock("@/api/chat", () => ({
  getAnswerCheck: mocks.getAnswerCheck,
}));

vi.mock("@/utils/request", () => ({
  abortRequest: mocks.abortRequest,
}));

function projection(
  overrides: Partial<BotRunProjection> = {}
): BotRunProjection {
  return {
    runId: "run-network",
    agent: "GeneNetworkAgent",
    status: "RUNNING",
    reportPresentation: true,
    reportStage: "intermediate",
    reportCompleteness: "partial",
    reportRevision: 0,
    reportUpdatedAt: null,
    intermediateReport: "Preparing network",
    finalReport: "",
    progress: {
      completed: 0,
      total: 1,
      failed: 0,
      pending: 1,
      briefGeneStatus: "",
    },
    degraded: false,
    degradedReason: null,
    failures: [],
    artifacts: [],
    requestId: null,
    trackingDegraded: false,
    ...overrides,
  };
}

function runState(
  overrides: Partial<BotRemoteAgentRunState> = {}
): BotRemoteAgentRunState {
  const currentProjection = projection();
  return {
    runId: currentProjection.runId,
    status: "RUNNING",
    reportRevision: currentProjection.reportRevision,
    visibleReport: currentProjection.intermediateReport,
    intermediateReport: currentProjection.intermediateReport,
    finalReport: "",
    degraded: false,
    failures: [],
    artifacts: [],
    phase: "running",
    requestId: null,
    uploadTransfer: null,
    projection: currentProjection,
    dialogueId: "dialogue-42",
    messageId: "19",
    error: null,
    ...overrides,
  };
}

function lifecycle(
  overrides: Partial<AgentTaskLifecycle> = {}
): AgentTaskLifecycle {
  return {
    id: 19,
    phase: "RUNNING",
    terminal: false,
    child_task_count: 1,
    child_work_accepted: true,
    report_revision: 0,
    artifact_summary: {
      image_count: 0,
      output_directory_count: 0,
      has_report: true,
    },
    reconciliation: "FRESH",
    tracking_degraded: false,
    error_code: null,
    ...overrides,
  };
}

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 19,
    dialogue_id: "dialogue-42",
    tool_name: "GeneNetworkAgent",
    bot_run_id: "run-network",
    status: "RUNNING",
    report_revision: 1,
    answer: JSON.stringify({ intermediate_report: "Network intermediate" }),
    ...overrides,
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("useRemoteAgentLifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.clearAllMocks();
    mocks.abortRequest.mockReturnValue(true);
    mocks.getTaskLifecycle.mockResolvedValue({ data: lifecycle() });
    mocks.getAnswerCheck.mockResolvedValue({ code: 200, data: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["InSilicoResearchAgent", "run-research", "dialogue-research"],
    ["GeneNetworkAgent", "run-network", "dialogue-network"],
    ["DigitalDesignAgent", "run-design", "dialogue-design"],
  ] as const)(
    "starts shared lifecycle polling for %s with its positive Web row ID",
    async (tool, runId, dialogueId) => {
      const currentProjection = projection({ agent: tool, runId });
      const state = ref(
        runState({
          runId,
          projection: currentProjection,
          dialogueId,
          messageId: "19",
        })
      );
      const controller = useRemoteAgentLifecycle({
        tool,
        run: { state, hydrate: vi.fn() },
        dialogueId,
      });
      await flushAsync();

      expect(mocks.getTaskLifecycle).toHaveBeenCalledWith(
        "19",
        expect.stringContaining(`remote-${tool}-19-`)
      );
      controller.dispose();
    }
  );

  it("polls the full Research sequence before one terminal history hydration", async () => {
    const phases = [
      "PREPARING",
      "RESOLVING_INPUTS",
      "PLANNING",
      "RUNNING",
      "FINALIZING",
      "SUCCEEDED",
    ] as const;
    const researchProjection = projection({
      agent: "InSilicoResearchAgent",
      runId: "run-research",
      intermediateReport: "",
    });
    const state = ref(
      runState({
        runId: "run-research",
        visibleReport: "",
        intermediateReport: "",
        projection: researchProjection,
        dialogueId: "dialogue-research",
        messageId: "19",
      })
    );
    mocks.getTaskLifecycle.mockReset();
    mocks.getAnswerCheck.mockReset();
    for (const phase of phases) {
      mocks.getTaskLifecycle.mockResolvedValueOnce({
        data: lifecycle({
          phase,
          terminal: phase === "SUCCEEDED",
          artifact_summary: {
            image_count: 0,
            output_directory_count: 0,
            has_report: false,
          },
        }),
      });
    }
    mocks.getAnswerCheck.mockResolvedValue({
      code: 200,
      data: [
        historyRow({
          dialogue_id: "dialogue-research",
          tool_name: "InSilicoResearchAgent",
          bot_run_id: "run-research",
          status: "SUCCEEDED",
          report_revision: 0,
          answer: JSON.stringify({ final_report: "Final Research report" }),
        }),
      ],
    });
    const hydrate = vi.fn();
    const controller = useRemoteAgentLifecycle({
      tool: "InSilicoResearchAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-research",
    });

    for (const [index, phase] of phases.entries()) {
      if (index > 0) await vi.advanceTimersByTimeAsync(1000);
      await flushAsync();
      expect(controller.snapshot.value?.phase).toBe(phase);
      expect(mocks.getTaskLifecycle).toHaveBeenCalledTimes(index + 1);
      if (phase !== "SUCCEEDED") {
        expect(mocks.getAnswerCheck).not.toHaveBeenCalled();
        expect(hydrate).not.toHaveBeenCalled();
      }
    }

    expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();
    expect(hydrate).toHaveBeenCalledOnce();
    expect(hydrate).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-research",
        status: "SUCCEEDED",
        finalReport: "Final Research report",
      }),
      { dialogueId: "dialogue-research", messageId: "19" }
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getTaskLifecycle).toHaveBeenCalledTimes(phases.length);
    controller.dispose();
  });

  it.each(["FAILED", "CANCELLED"] as const)(
    "hydrates Research RUNNING to %s without transient success",
    async (terminalPhase) => {
      const researchProjection = projection({
        agent: "InSilicoResearchAgent",
        runId: "run-research-terminal",
      });
      const state = ref(
        runState({
          runId: "run-research-terminal",
          projection: researchProjection,
          dialogueId: "dialogue-research",
          messageId: "19",
        })
      );
      mocks.getTaskLifecycle
        .mockReset()
        .mockResolvedValueOnce({
          data: lifecycle({
            phase: "RUNNING",
            artifact_summary: {
              image_count: 0,
              output_directory_count: 0,
              has_report: false,
            },
          }),
        })
        .mockResolvedValueOnce({
          data: lifecycle({ phase: terminalPhase, terminal: true }),
        });
      mocks.getAnswerCheck.mockReset().mockResolvedValue({
        code: 200,
        data: [
          historyRow({
            dialogue_id: "dialogue-research",
            tool_name: "InSilicoResearchAgent",
            bot_run_id: "run-research-terminal",
            status: terminalPhase,
            answer: "",
          }),
        ],
      });
      const observedStatuses: string[] = [];
      const hydrate = vi.fn((next: BotRunProjection) => {
        observedStatuses.push(next.status);
      });
      const controller = useRemoteAgentLifecycle({
        tool: "InSilicoResearchAgent",
        run: { state, hydrate },
        dialogueId: "dialogue-research",
      });

      await flushAsync();
      expect(hydrate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      await flushAsync();

      expect(observedStatuses).toEqual([terminalPhase]);
      expect(observedStatuses).not.toContain("SUCCEEDED");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.getTaskLifecycle).toHaveBeenCalledTimes(2);
      controller.dispose();
    }
  );

  it("hydrates exact history only when lifecycle material changes and stops terminal polling", async () => {
    const state = ref(runState({ messageId: null }));
    const hydrate = vi.fn((next: BotRunProjection) => {
      state.value = {
        ...state.value,
        phase: next.status === "SUCCEEDED" ? "succeeded" : "running",
        projection: next,
      };
    });
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-42",
    });

    state.value = runState();
    await nextTick();
    await flushAsync();
    expect(mocks.getTaskLifecycle).toHaveBeenCalledWith(
      "19",
      expect.stringContaining("remote-GeneNetworkAgent-19-")
    );
    expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();
    expect(controller.snapshot.value).toEqual(lifecycle());

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();

    mocks.getTaskLifecycle.mockResolvedValueOnce({
      data: lifecycle({ report_revision: 1 }),
    });
    mocks.getAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [historyRow({ tool_name: "DigitalDesignAgent" }), historyRow()],
    });
    await vi.advanceTimersByTimeAsync(2000);
    await flushAsync();
    expect(hydrate).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "GeneNetworkAgent",
        runId: "run-network",
        intermediateReport: "Network intermediate",
      }),
      { dialogueId: "dialogue-42", messageId: "19" }
    );

    mocks.getTaskLifecycle.mockResolvedValueOnce({
      data: lifecycle({
        report_revision: 1,
        artifact_summary: {
          image_count: 1,
          output_directory_count: 1,
          has_report: true,
        },
      }),
    });
    mocks.getAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [historyRow({ download_path: "/obs/network" })],
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(hydrate).toHaveBeenCalledTimes(2);

    mocks.getTaskLifecycle.mockResolvedValueOnce({
      data: lifecycle({
        phase: "SUCCEEDED",
        terminal: true,
        report_revision: 2,
      }),
    });
    mocks.getAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [
        historyRow({
          status: "SUCCEEDED",
          report_revision: 2,
          answer: JSON.stringify({ final_report: "Network final" }),
        }),
      ],
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(hydrate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "SUCCEEDED",
        finalReport: "Network final",
      }),
      { dialogueId: "dialogue-42", messageId: "19" }
    );
    expect(controller.snapshot.value).toEqual(
      expect.objectContaining({ phase: "SUCCEEDED", terminal: true })
    );

    const terminalPolls = mocks.getTaskLifecycle.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getTaskLifecycle).toHaveBeenCalledTimes(terminalPolls);
    controller.dispose();
  });

  it("hydrates terminal history when the first lifecycle snapshot is terminal", async () => {
    const state = ref(runState());
    const hydrate = vi.fn();
    mocks.getTaskLifecycle.mockResolvedValueOnce({
      data: lifecycle({
        phase: "SUCCEEDED",
        terminal: true,
        report_revision: 2,
        artifact_summary: {
          image_count: 1,
          output_directory_count: 1,
          has_report: true,
        },
      }),
    });
    mocks.getAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [
        historyRow({
          status: "SUCCEEDED",
          report_revision: 2,
          answer: JSON.stringify({ final_report: "Network final" }),
          download_path: "/obs/bucket/network",
          image_paths: JSON.stringify(["/obs/bucket/network/network.png"]),
        }),
      ],
    });
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-42",
    });

    await flushAsync();

    expect(mocks.getAnswerCheck).toHaveBeenCalledWith({
      dialogue_id: "dialogue-42",
    });
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCEEDED",
        finalReport: "Network final",
        artifacts: [
          {
            outputDir: "/obs/bucket/network",
            paths: ["/obs/bucket/network/network.png"],
          },
        ],
      }),
      { dialogueId: "dialogue-42", messageId: "19" }
    );
    const terminalPolls = mocks.getTaskLifecycle.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getTaskLifecycle).toHaveBeenCalledTimes(terminalPolls);
    expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("hydrates the captured row when an earlier history row shares its run", async () => {
    const state = ref(runState());
    const hydrate = vi.fn();
    mocks.getTaskLifecycle.mockResolvedValueOnce({
      data: lifecycle({ phase: "SUCCEEDED", terminal: true }),
    });
    mocks.getAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [
        historyRow({
          id: 20,
          status: "SUCCEEDED",
          answer: JSON.stringify({ final_report: "Wrong row report" }),
        }),
        historyRow({
          status: "SUCCEEDED",
          answer: JSON.stringify({ final_report: "Captured row report" }),
        }),
      ],
    });
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-42",
    });

    await flushAsync();

    expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();
    expect(hydrate).toHaveBeenCalledOnce();
    expect(hydrate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCEEDED",
        finalReport: "Captured row report",
      }),
      { dialogueId: "dialogue-42", messageId: "19" }
    );
    controller.dispose();
  });

  it("retries terminal history when only a different row shares its run", async () => {
    const state = ref(runState());
    const hydrate = vi.fn();
    mocks.getTaskLifecycle.mockResolvedValueOnce({
      data: lifecycle({ phase: "FAILED", terminal: true }),
    });
    mocks.getAnswerCheck.mockResolvedValue({
      code: 200,
      data: [historyRow({ id: 20, status: "FAILED" })],
    });
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-42",
    });

    await flushAsync();
    expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();
    expect(hydrate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(3);
    expect(hydrate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    controller.dispose();
  });

  it("ignores an older nonterminal history response after terminal hydration", async () => {
    const pendingNonterminalHistory = deferred<unknown>();
    const state = ref(runState());
    mocks.getTaskLifecycle
      .mockReset()
      .mockResolvedValueOnce({
        data: lifecycle({ report_revision: 1 }),
      })
      .mockResolvedValueOnce({
        data: lifecycle({
          phase: "SUCCEEDED",
          terminal: true,
          report_revision: 2,
        }),
      });
    mocks.getAnswerCheck
      .mockReset()
      .mockReturnValueOnce(
        pendingNonterminalHistory.promise as ReturnType<
          typeof mocks.getAnswerCheck
        >
      )
      .mockResolvedValueOnce({
        code: 200,
        data: [
          historyRow({
            status: "SUCCEEDED",
            report_revision: 2,
            answer: JSON.stringify({ final_report: "Network final" }),
          }),
        ],
      });
    const hydrate = vi.fn((next: BotRunProjection) => {
      const succeeded = next.status === "SUCCEEDED";
      state.value = {
        ...state.value,
        status: succeeded ? "SUCCEEDED" : "RUNNING",
        phase: succeeded ? "succeeded" : "running",
        projection: next,
      };
    });
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-42",
    });
    await flushAsync();

    expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();
    expect(hydrate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();

    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(2);
    expect(hydrate).toHaveBeenCalledOnce();
    expect(state.value.status).toBe("SUCCEEDED");
    expect(state.value.phase).toBe("succeeded");
    expect(state.value.projection?.status).toBe("SUCCEEDED");

    pendingNonterminalHistory.resolve({
      code: 200,
      data: [historyRow({ report_revision: 1 })],
    });
    await flushAsync();

    expect(hydrate).toHaveBeenCalledOnce();
    expect(state.value.status).toBe("SUCCEEDED");
    expect(state.value.phase).toBe("succeeded");
    expect(state.value.projection?.status).toBe("SUCCEEDED");
    controller.dispose();
  });

  it.each([
    "throw",
    "non-200 response",
    "non-array data",
    "no exact tool and run match",
  ] as const)(
    "retries terminal history after %s and hydrates the exact snapshot once",
    async (failure) => {
      const state = ref(runState());
      const hydrate = vi.fn();
      mocks.getTaskLifecycle.mockReset().mockResolvedValueOnce({
        data: lifecycle({
          phase: "SUCCEEDED",
          terminal: true,
          report_revision: 2,
        }),
      });
      mocks.getAnswerCheck.mockReset();
      switch (failure) {
        case "throw":
          mocks.getAnswerCheck.mockRejectedValueOnce(
            new Error("history unavailable")
          );
          break;
        case "non-200 response":
          mocks.getAnswerCheck.mockResolvedValueOnce({ code: 503, data: [] });
          break;
        case "non-array data":
          mocks.getAnswerCheck.mockResolvedValueOnce({
            code: 200,
            data: {},
          });
          break;
        case "no exact tool and run match":
          mocks.getAnswerCheck.mockResolvedValueOnce({
            code: 200,
            data: [
              historyRow({ tool_name: "DigitalDesignAgent" }),
              historyRow({ bot_run_id: "run-other" }),
            ],
          });
          break;
      }
      mocks.getAnswerCheck.mockResolvedValueOnce({
        code: 200,
        data: [
          historyRow({
            status: "SUCCEEDED",
            report_revision: 2,
            answer: JSON.stringify({ final_report: "Network final" }),
          }),
        ],
      });

      const controller = useRemoteAgentLifecycle({
        tool: "GeneNetworkAgent",
        run: { state, hydrate },
        dialogueId: "dialogue-42",
      });
      await flushAsync();

      expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(1);
      expect(hydrate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(999);
      expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await flushAsync();

      expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(2);
      expect(hydrate).toHaveBeenCalledTimes(1);
      expect(hydrate).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-network",
          status: "SUCCEEDED",
          finalReport: "Network final",
        }),
        { dialogueId: "dialogue-42", messageId: "19" }
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(2);
      expect(hydrate).toHaveBeenCalledTimes(1);
      controller.dispose();
    }
  );

  it("exhausts terminal history reconciliation after three attempts", async () => {
    const state = ref(runState());
    const hydrate = vi.fn();
    mocks.getTaskLifecycle.mockReset().mockResolvedValueOnce({
      data: lifecycle({ phase: "FAILED", terminal: true }),
    });
    mocks.getAnswerCheck.mockReset().mockResolvedValue({
      code: 200,
      data: [historyRow({ bot_run_id: "run-other" })],
    });
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-42",
    });
    await flushAsync();

    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(3);
    expect(hydrate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    controller.dispose();
  });

  it.each([
    "reset",
    "dispose",
    "row replacement",
    "run replacement",
    "dialogue replacement",
  ] as const)("cancels a scheduled terminal retry after %s", async (change) => {
    const state = ref(runState());
    const hydrate = vi.fn();
    mocks.getTaskLifecycle
      .mockReset()
      .mockResolvedValueOnce({
        data: lifecycle({ phase: "SUCCEEDED", terminal: true }),
      })
      .mockImplementation(() => new Promise(() => undefined));
    mocks.getAnswerCheck.mockReset().mockResolvedValue({
      code: 503,
      data: [],
    });
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-42",
    });
    await flushAsync();

    expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    switch (change) {
      case "reset":
        controller.reset();
        break;
      case "dispose":
        controller.dispose();
        break;
      case "row replacement":
        state.value = { ...state.value, messageId: "20" };
        break;
      case "run replacement":
        state.value = {
          ...state.value,
          runId: "run-replacement",
          projection: projection({ runId: "run-replacement" }),
        };
        break;
      case "dialogue replacement":
        state.value = { ...state.value, dialogueId: "dialogue-replacement" };
        break;
    }
    await nextTick();

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();
    expect(hydrate).not.toHaveBeenCalled();
    if (change !== "dispose") controller.dispose();
  });

  it.each([
    "reset",
    "dispose",
    "row replacement",
    "run replacement",
    "dialogue replacement",
  ] as const)(
    "ignores an in-flight terminal history response after %s",
    async (change) => {
      const pendingHistory = deferred<unknown>();
      const state = ref(runState());
      const hydrate = vi.fn();
      mocks.getTaskLifecycle
        .mockReset()
        .mockResolvedValueOnce({
          data: lifecycle({ phase: "SUCCEEDED", terminal: true }),
        })
        .mockImplementation(() => new Promise(() => undefined));
      mocks.getAnswerCheck
        .mockReset()
        .mockReturnValueOnce(
          pendingHistory.promise as ReturnType<typeof mocks.getAnswerCheck>
        );
      const controller = useRemoteAgentLifecycle({
        tool: "GeneNetworkAgent",
        run: { state, hydrate },
        dialogueId: "dialogue-42",
      });
      await flushAsync();
      expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();

      switch (change) {
        case "reset":
          controller.reset();
          break;
        case "dispose":
          controller.dispose();
          break;
        case "row replacement":
          state.value = { ...state.value, messageId: "20" };
          break;
        case "run replacement":
          state.value = {
            ...state.value,
            runId: "run-replacement",
            projection: projection({ runId: "run-replacement" }),
          };
          break;
        case "dialogue replacement":
          state.value = { ...state.value, dialogueId: "dialogue-replacement" };
          break;
      }
      await nextTick();
      pendingHistory.resolve({
        code: 200,
        data: [
          historyRow({
            status: "SUCCEEDED",
            answer: JSON.stringify({ final_report: "Stale terminal report" }),
          }),
        ],
      });
      await flushAsync();

      expect(hydrate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();
      if (change !== "dispose") controller.dispose();
    }
  );

  it("keeps the dedicated workspace watcher active for pending delivery after scientific success", async () => {
    const state = ref(
      runState({
        phase: "succeeded",
        status: "SUCCEEDED",
        delivery: {
          schema_version: 1,
          required: true,
          status: "pending",
          revision: 1,
          name: null,
          size_bytes: null,
          error_code: null,
          retryable: false,
        },
      })
    );
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate: vi.fn() },
      dialogueId: "dialogue-42",
    });

    await flushAsync();
    expect(mocks.getTaskLifecycle).toHaveBeenCalledWith(
      "19",
      expect.stringContaining("remote-GeneNetworkAgent-19-")
    );
    controller.dispose();
  });

  it("ignores a history response that arrives after reset", async () => {
    let resolveHistory: ((value: unknown) => void) | undefined;
    mocks.getTaskLifecycle
      .mockResolvedValueOnce({ data: lifecycle() })
      .mockResolvedValueOnce({ data: lifecycle({ report_revision: 1 }) });
    mocks.getAnswerCheck.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        })
    );
    const state = ref(runState());
    const hydrate = vi.fn();
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-42",
    });
    await flushAsync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(2);

    controller.reset();
    state.value = runState({
      phase: "idle",
      projection: null,
      runId: null,
      messageId: null,
    });
    resolveHistory?.({ code: 200, data: [historyRow()] });
    await flushAsync();
    expect(hydrate).not.toHaveBeenCalled();

    controller.dispose();
  });

  it("ignores a history response that arrives after navigation disposal", async () => {
    let resolveHistory: ((value: unknown) => void) | undefined;
    mocks.getTaskLifecycle
      .mockResolvedValueOnce({ data: lifecycle() })
      .mockResolvedValueOnce({ data: lifecycle({ report_revision: 1 }) });
    mocks.getAnswerCheck.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        })
    );
    const state = ref(runState());
    const hydrate = vi.fn();
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-42",
    });
    await flushAsync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.getAnswerCheck).toHaveBeenCalledTimes(2);

    controller.dispose();
    resolveHistory?.({ code: 200, data: [historyRow()] });
    await flushAsync();
    expect(hydrate).not.toHaveBeenCalled();
  });

  it("ignores a late history response after the same row changes run identity", async () => {
    let resolveHistory: ((value: unknown) => void) | undefined;
    mocks.getTaskLifecycle
      .mockReset()
      .mockResolvedValueOnce({
        data: lifecycle({ report_revision: 1 }),
      })
      .mockImplementation(() => new Promise(() => undefined));
    mocks.getAnswerCheck.mockReset().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        })
    );
    const oldProjection = projection({
      agent: "InSilicoResearchAgent",
      runId: "run-research-old",
    });
    const state = ref(
      runState({
        runId: "run-research-old",
        projection: oldProjection,
        dialogueId: "dialogue-research",
        messageId: "19",
      })
    );
    const hydrate = vi.fn();
    const controller = useRemoteAgentLifecycle({
      tool: "InSilicoResearchAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-research",
    });
    await flushAsync();
    expect(mocks.getAnswerCheck).toHaveBeenCalledOnce();

    const nextProjection = projection({
      agent: "InSilicoResearchAgent",
      runId: "run-research-new",
    });
    state.value = runState({
      runId: "run-research-new",
      projection: nextProjection,
      dialogueId: "dialogue-research",
      messageId: "19",
    });
    await nextTick();
    expect(mocks.getTaskLifecycle).toHaveBeenCalledTimes(2);
    resolveHistory?.({
      code: 200,
      data: [
        historyRow({
          dialogue_id: "dialogue-research",
          tool_name: "InSilicoResearchAgent",
          bot_run_id: "run-research-old",
        }),
      ],
    });
    await flushAsync();

    expect(hydrate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("leaves tracking degraded and never guesses an invalid row or run identity", async () => {
    const degradedProjection = projection({
      runId: null,
      trackingDegraded: true,
    });
    const state = ref(
      runState({
        runId: null,
        projection: degradedProjection,
        messageId: "unsafe-row",
      })
    );
    const hydrate = vi.fn();
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate },
      dialogueId: "dialogue-42",
    });
    await flushAsync();

    expect(controller.snapshot.value).toBeNull();
    expect(state.value.projection?.trackingDegraded).toBe(true);
    expect(mocks.getTaskLifecycle).not.toHaveBeenCalled();
    expect(mocks.getAnswerCheck).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("continues polling beyond the former finite Research cutoff", async () => {
    const state = ref(runState());
    const controller = useRemoteAgentLifecycle({
      tool: "GeneNetworkAgent",
      run: { state, hydrate: vi.fn() },
      dialogueId: "dialogue-42",
    });
    await flushAsync();
    await vi.advanceTimersByTimeAsync(240_000);

    expect(mocks.getTaskLifecycle.mock.calls.length).toBeGreaterThan(12);
    controller.dispose();
  });
});
