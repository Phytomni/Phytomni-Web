import type { AgentTaskLifecycle, ApiEnvelope } from "@/api/types";
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
  it("schedules unchanged nonterminal rows with capped exponential delays", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const fetchLifecycle = vi.fn().mockResolvedValue(response(lifecycle()));
    const poller = useAgentRunLifecycle({
      scope: "chat:1",
      fetchLifecycle,
      jitter: () => 0,
      scheduler: testScheduler(delays),
    });

    poller.watchRow("42");
    await flush();
    expect(fetchLifecycle).toHaveBeenCalledTimes(1);

    for (const delay of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(delay);
      expect(fetchLifecycle).toHaveBeenCalledTimes(delays.length);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000]);
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

  it("stops terminal rows permanently", async () => {
    vi.useFakeTimers();
    const fetchLifecycle = vi
      .fn()
      .mockResolvedValue(
        response(lifecycle({ phase: "SUCCEEDED", terminal: true }))
      );
    const poller = useAgentRunLifecycle({
      scope: "chat:1",
      fetchLifecycle,
      jitter: () => 0,
      scheduler: testScheduler(),
    });

    poller.watchRow("42");
    await flush();
    await vi.advanceTimersByTimeAsync(60000);

    expect(fetchLifecycle).toHaveBeenCalledOnce();
    expect(poller.snapshots.value["42"].terminal).toBe(true);
    poller.dispose();
  });

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

  it("pauses hidden timers and polls once immediately when visible", async () => {
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
    document.setHidden(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchLifecycle).toHaveBeenCalledOnce();
    expect(poller.snapshots.value["42"].terminal).toBe(false);

    document.setHidden(false);
    await flush();
    expect(fetchLifecycle).toHaveBeenCalledTimes(2);
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
