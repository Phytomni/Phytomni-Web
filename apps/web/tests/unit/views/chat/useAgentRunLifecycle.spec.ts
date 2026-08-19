import {
  decodeAgentTaskLifecycle,
  type AgentTaskLifecycle,
  type ApiEnvelope,
} from "@/api/types";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/request", () => ({
  abortRequest: vi.fn(),
}));

import { abortRequest } from "@/utils/request";
import {
  type LifecycleScheduler,
  useAgentRunLifecycle,
} from "@/views/chat/composables/useAgentRunLifecycle";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type VisibilityListener = () => void;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function lifecycle(
  overrides: Partial<AgentTaskLifecycle> = {}
): AgentTaskLifecycle {
  return {
    id: 42,
    phase: "PREPARING",
    terminal: false,
    child_task_count: 0,
    child_work_accepted: false,
    report_revision: 0,
    artifact_summary: {
      image_count: 0,
      output_directory_count: 0,
      has_report: false,
    },
    reconciliation: "FRESH",
    tracking_degraded: false,
    error_code: null,
    ...overrides,
  };
}

function response(data: AgentTaskLifecycle): ApiEnvelope<AgentTaskLifecycle> {
  return { code: 200, data };
}

function testScheduler(delays: number[] = []): LifecycleScheduler {
  return {
    setTimeout(callback, delay) {
      delays.push(delay);
      return setTimeout(callback, delay);
    },
    clearTimeout(timer) {
      clearTimeout(timer);
    },
  };
}

function visibilityDocument(): {
  documentRef: Pick<
    Document,
    "hidden" | "addEventListener" | "removeEventListener"
  >;
  setHidden: (hidden: boolean) => void;
  listenerCount: () => number;
} {
  let hidden = false;
  const listeners = new Set<VisibilityListener>();
  return {
    documentRef: {
      get hidden() {
        return hidden;
      },
      addEventListener(event, listener) {
        if (event === "visibilitychange")
          listeners.add(listener as VisibilityListener);
      },
      removeEventListener(event, listener) {
        if (event === "visibilitychange")
          listeners.delete(listener as VisibilityListener);
      },
    },
    setHidden(next) {
      hidden = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(abortRequest).mockReset();
});

describe("useAgentRunLifecycle", () => {
  it.each([
    "PREPARING",
    "RESOLVING_INPUTS",
    "PLANNING",
    "RUNNING",
    "FINALIZING",
  ] as const)("decodes %s as a nonterminal lifecycle phase", (phase) => {
    const decoded = decodeAgentTaskLifecycle(lifecycle({ phase }));
    expect(decoded.phase).toBe(phase);
    expect(decoded.terminal).toBe(false);
  });

  it.each([
    ["SUCCEEDED", true],
    ["FAILED", true],
    ["CANCELLED", true],
  ] as const)("decodes %s as terminal=%s", (phase, terminal) => {
    const decoded = decodeAgentTaskLifecycle(lifecycle({ phase, terminal }));
    expect(decoded.phase).toBe(phase);
    expect(decoded.terminal).toBe(true);
  });

  it("polls every Research preparation phase and stops at the sole success", async () => {
    vi.useFakeTimers();
    const phases = [
      "PREPARING",
      "RESOLVING_INPUTS",
      "PLANNING",
      "RUNNING",
      "FINALIZING",
      "SUCCEEDED",
    ] as const;
    const fetchLifecycle = vi.fn();
    for (const phase of phases) {
      fetchLifecycle.mockResolvedValueOnce(
        response(lifecycle({ phase, terminal: phase === "SUCCEEDED" }))
      );
    }
    const poller = useAgentRunLifecycle({
      scope: "research-sequence",
      fetchLifecycle,
      jitter: () => 0,
    });

    poller.watchRow("42");
    await flush();
    expect(poller.snapshots.value["42"]?.phase).toBe("PREPARING");

    for (const phase of phases.slice(1)) {
      await vi.advanceTimersByTimeAsync(1000);
      await flush();
      expect(poller.snapshots.value["42"]?.phase).toBe(phase);
      expect(fetchLifecycle).toHaveBeenCalledTimes(phases.indexOf(phase) + 1);
    }

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchLifecycle).toHaveBeenCalledTimes(phases.length);
    poller.dispose();
  });

  it("schedules unchanged nonterminal rows with capped exponential delays", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const onSnapshot = vi.fn();
    const fetchLifecycle = vi.fn().mockResolvedValue(response(lifecycle()));
    const poller = useAgentRunLifecycle({
      scope: "chat:1",
      fetchLifecycle,
      jitter: () => 0,
      scheduler: testScheduler(delays),
      onSnapshot,
    });

    poller.watchRow("42");
    await flush();
    expect(fetchLifecycle).toHaveBeenCalledTimes(1);
    expect(onSnapshot).not.toHaveBeenCalled();

    for (const delay of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(delay);
      expect(fetchLifecycle).toHaveBeenCalledTimes(delays.length);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000]);
    expect(onSnapshot).not.toHaveBeenCalled();
    poller.dispose();
  });

  it.each([
    ["report revision", { report_revision: 1 }],
    [
      "report flag",
      {
        artifact_summary: {
          image_count: 0,
          output_directory_count: 0,
          has_report: true,
        },
      },
    ],
    [
      "image artifact",
      {
        artifact_summary: {
          image_count: 1,
          output_directory_count: 0,
          has_report: false,
        },
      },
    ],
    [
      "output directory",
      {
        artifact_summary: {
          image_count: 0,
          output_directory_count: 1,
          has_report: false,
        },
      },
    ],
  ] as const)(
    "emits a material first snapshot for %s",
    async (_name, overrides) => {
      const onSnapshot = vi.fn();
      const poller = useAgentRunLifecycle({
        scope: "first-material",
        fetchLifecycle: vi
          .fn()
          .mockResolvedValue(
            response(lifecycle({ phase: "RUNNING", ...overrides }))
          ),
        onSnapshot,
        jitter: () => 0,
      });

      poller.watchRow("42");
      await flush();

      expect(onSnapshot).toHaveBeenCalledOnce();
      expect(onSnapshot).toHaveBeenCalledWith(
        "42",
        expect.objectContaining({ phase: "RUNNING" }),
        undefined
      );
      poller.dispose();
    }
  );

  it("does not emit a plain preparing first snapshot", async () => {
    const onSnapshot = vi.fn();
    const poller = useAgentRunLifecycle({
      scope: "first-empty",
      fetchLifecycle: vi.fn().mockResolvedValue(response(lifecycle())),
      onSnapshot,
      jitter: () => 0,
    });

    poller.watchRow("42");
    await flush();

    expect(onSnapshot).not.toHaveBeenCalled();
    poller.dispose();
  });

  it("resets the nominal delay only when lifecycle progress changes", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const fetchLifecycle = vi
      .fn()
      .mockResolvedValueOnce(response(lifecycle()))
      .mockResolvedValueOnce(response(lifecycle()))
      .mockResolvedValueOnce(
        response(lifecycle({ child_task_count: 1, child_work_accepted: true }))
      );
    const updates: Array<[AgentTaskLifecycle, AgentTaskLifecycle | undefined]> =
      [];
    const poller = useAgentRunLifecycle({
      scope: "chat:1",
      fetchLifecycle,
      jitter: () => 0,
      scheduler: testScheduler(delays),
      onSnapshot: (_rowId, next, previous) => updates.push([next, previous]),
    });

    poller.watchRow("42");
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(delays).toEqual([1000, 2000, 1000]);
    expect(updates).toHaveLength(1);
    expect(updates[0][0].child_task_count).toBe(1);
    poller.dispose();
  });

  it.each(["SUCCEEDED", "CANCELLED"] as const)(
    "stops %s rows permanently",
    async (phase) => {
      vi.useFakeTimers();
      const onSnapshot = vi.fn();
      const fetchLifecycle = vi
        .fn()
        .mockResolvedValue(response(lifecycle({ phase, terminal: true })));
      const poller = useAgentRunLifecycle({
        scope: "chat:1",
        fetchLifecycle,
        onSnapshot,
        jitter: () => 0,
        scheduler: testScheduler(),
      });

      poller.watchRow("42");
      await flush();
      await vi.advanceTimersByTimeAsync(60000);

      expect(fetchLifecycle).toHaveBeenCalledOnce();
      expect(poller.snapshots.value["42"].terminal).toBe(true);
      expect(onSnapshot).toHaveBeenCalledTimes(1);
      expect(onSnapshot).toHaveBeenCalledWith(
        "42",
        expect.objectContaining({ phase, terminal: true }),
        undefined
      );
      poller.dispose();
    }
  );

  it("preserves prior progress through failures and degraded reconciliation", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const prior = lifecycle({ phase: "RUNNING", child_task_count: 2 });
    const degraded = lifecycle({
      phase: "RUNNING",
      child_task_count: 2,
      reconciliation: "DEGRADED",
      error_code: "bot_transport_failed",
    });
    const fetchLifecycle = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response(degraded))
      .mockResolvedValueOnce(
        response(lifecycle({ phase: "RUNNING", child_task_count: 3 }))
      );
    const updates = vi.fn();
    const poller = useAgentRunLifecycle({
      scope: "chat:1",
      fetchLifecycle,
      onSnapshot: updates,
      jitter: () => 0,
      scheduler: testScheduler(delays),
    });

    poller.watchRow("42", prior);
    await flush();
    expect(poller.snapshots.value["42"]).toEqual(prior);
    expect(delays).toEqual([2000]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(poller.snapshots.value["42"]).toEqual(degraded);
    expect(updates).not.toHaveBeenCalled();
    expect(delays).toEqual([2000, 4000]);

    await vi.advanceTimersByTimeAsync(4000);
    expect(poller.snapshots.value["42"].child_task_count).toBe(3);
    expect(updates).toHaveBeenCalledOnce();
    expect(delays).toEqual([2000, 4000, 1000]);
    poller.dispose();
  });

  it("keeps polling while hidden and still polls immediately when visible", async () => {
    vi.useFakeTimers();
    const document = visibilityDocument();
    const fetchLifecycle = vi.fn().mockResolvedValue(response(lifecycle()));
    const poller = useAgentRunLifecycle({
      scope: "chat:1",
      fetchLifecycle,
      jitter: () => 0,
      scheduler: testScheduler(),
      documentRef: document.documentRef,
    });

    poller.watchRow("42");
    await flush();
    expect(fetchLifecycle).toHaveBeenCalledOnce();

    document.setHidden(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchLifecycle.mock.calls.length).toBeGreaterThan(1);

    const hiddenCalls = fetchLifecycle.mock.calls.length;
    document.setHidden(false);
    await flush();
    expect(fetchLifecycle.mock.calls.length).toBeGreaterThan(hiddenCalls);
    poller.dispose();
    expect(document.listenerCount()).toBe(0);
  });

  it("fences late responses after unwatch and a new watch token", async () => {
    const first = deferred<ApiEnvelope<AgentTaskLifecycle>>();
    const second = deferred<ApiEnvelope<AgentTaskLifecycle>>();
    const fetchLifecycle = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const poller = useAgentRunLifecycle({ scope: "chat:1", fetchLifecycle });

    poller.watchRow("42", lifecycle({ report_revision: 1 }));
    poller.unwatchRow("42");
    poller.watchRow("42", lifecycle({ report_revision: 2 }));
    first.resolve(response(lifecycle({ report_revision: 99 })));
    await flush();

    expect(poller.snapshots.value["42"].report_revision).toBe(2);
    second.resolve(response(lifecycle({ report_revision: 3 })));
    await flush();
    expect(poller.snapshots.value["42"].report_revision).toBe(3);
    poller.dispose();
  });

  it("keeps at most three lifecycle requests active and aborts on disposal", async () => {
    const requests = [
      deferred<ApiEnvelope<AgentTaskLifecycle>>(),
      deferred<ApiEnvelope<AgentTaskLifecycle>>(),
      deferred<ApiEnvelope<AgentTaskLifecycle>>(),
      deferred<ApiEnvelope<AgentTaskLifecycle>>(),
    ];
    const fetchLifecycle = vi.fn(
      (rowId: string) => requests[Number(rowId) - 1].promise
    );
    const document = visibilityDocument();
    const poller = useAgentRunLifecycle({
      scope: "safe scope",
      fetchLifecycle,
      maxConcurrent: 3,
      documentRef: document.documentRef,
    });

    for (const rowId of ["1", "2", "3", "4"]) poller.watchRow(rowId);
    expect(fetchLifecycle).toHaveBeenCalledTimes(3);
    expect(fetchLifecycle.mock.calls.map(([rowId]) => rowId)).toEqual([
      "1",
      "2",
      "3",
    ]);

    requests[0].resolve(response(lifecycle({ id: 1 })));
    await flush();
    expect(fetchLifecycle).toHaveBeenCalledTimes(4);
    poller.dispose();

    expect(vi.mocked(abortRequest)).toHaveBeenCalledTimes(3);
    expect(
      vi
        .mocked(abortRequest)
        .mock.calls.every(([requestId]) => requestId.startsWith("safe-scope-"))
    ).toBe(true);
    expect(document.listenerCount()).toBe(0);
  });

  it.each([
    [-1, 1000],
    [2, 1200],
  ])("clamps jitter %d before applying it", async (jitter, expectedDelay) => {
    const delays: number[] = [];
    const poller = useAgentRunLifecycle({
      scope: "chat:1",
      fetchLifecycle: vi.fn().mockResolvedValue(response(lifecycle())),
      jitter: () => jitter,
      scheduler: testScheduler(delays),
    });

    poller.watchRow("42");
    await flush();
    expect(delays).toEqual([expectedDelay]);
    poller.dispose();
  });
});
