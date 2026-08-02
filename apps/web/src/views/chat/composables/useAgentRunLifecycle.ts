import { readonly, ref, type Ref } from "vue";

import { getTaskLifecycle, normalizePositiveTaskRowId } from "@/api/task";
import type { AgentTaskLifecycle } from "@/api/types";
import { abortRequest } from "@/utils/request";

type Timer = ReturnType<typeof setTimeout>;

export interface LifecycleScheduler {
  setTimeout: (callback: () => void, delay: number) => Timer;
  clearTimeout: (timer: Timer) => void;
}

type LifecycleController = {
  rowId: string;
  token: number;
  nominalDelay: number;
  timer?: Timer;
  requestId?: string;
  inFlight: boolean;
  disposed: boolean;
  queued: boolean;
  terminal: boolean;
};

const INITIAL_DELAY = 1000;
const MAX_NORMAL_DELAY = 15000;
const MAX_FAILURE_DELAY = 30000;

function materialChanged(
  previous: AgentTaskLifecycle | undefined,
  next: AgentTaskLifecycle
): boolean {
  if (!previous) return false;
  return (
    previous.phase !== next.phase ||
    previous.child_task_count !== next.child_task_count ||
    previous.report_revision !== next.report_revision ||
    previous.artifact_summary.image_count !==
      next.artifact_summary.image_count ||
    previous.artifact_summary.output_directory_count !==
      next.artifact_summary.output_directory_count ||
    previous.artifact_summary.has_report !== next.artifact_summary.has_report
  );
}

function sanitizeScope(scope: string): string {
  const sanitized = scope
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return sanitized || "lifecycle";
}

export function useAgentRunLifecycle(options: {
  scope: string;
  fetchLifecycle?: typeof getTaskLifecycle;
  onSnapshot?: (
    rowId: string,
    next: AgentTaskLifecycle,
    previous?: AgentTaskLifecycle
  ) => void | Promise<void>;
  maxConcurrent?: number;
  scheduler?: LifecycleScheduler;
  jitter?: () => number;
  documentRef?: Pick<
    Document,
    "hidden" | "addEventListener" | "removeEventListener"
  >;
}): {
  snapshots: Readonly<Ref<Record<string, AgentTaskLifecycle>>>;
  watchRow: (rowId: string, initial?: AgentTaskLifecycle) => void;
  unwatchRow: (rowId: string) => void;
  pollNow: (rowId: string) => void;
  dispose: () => void;
} {
  const snapshots = ref<Record<string, AgentTaskLifecycle>>({});
  const controllers = new Map<string, LifecycleController>();
  const queuedControllers = new Set<LifecycleController>();
  const activeRows = new Set<string>();
  const scheduler: LifecycleScheduler = options.scheduler ?? {
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
  };
  const fetchLifecycle = options.fetchLifecycle ?? getTaskLifecycle;
  const maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? 3));
  const scope = sanitizeScope(options.scope);
  const documentRef =
    options.documentRef ??
    (typeof document === "undefined" ? undefined : document);
  let activeRequests = 0;
  let nextToken = 0;
  let isDisposed = false;

  const isHidden = (): boolean => documentRef?.hidden === true;

  const isCurrent = (
    controller: LifecycleController,
    token: number,
    requestId: string
  ): boolean =>
    !isDisposed &&
    !controller.disposed &&
    controllers.get(controller.rowId) === controller &&
    controller.token === token &&
    controller.requestId === requestId;

  const clearTimer = (controller: LifecycleController): void => {
    if (controller.timer !== undefined) {
      scheduler.clearTimeout(controller.timer);
      controller.timer = undefined;
    }
  };

  const jitteredDelay = (nominalDelay: number): number => {
    const raw = options.jitter?.() ?? Math.random();
    const jitter = Math.min(1, Math.max(0, raw));
    return Math.min(
      MAX_FAILURE_DELAY,
      Math.round(nominalDelay * (1 + jitter * 0.2))
    );
  };

  const releaseRequest = (controller: LifecycleController): void => {
    if (!controller.inFlight) return;
    controller.inFlight = false;
    controller.requestId = undefined;
    activeRequests -= 1;
    activeRows.delete(controller.rowId);
  };

  const enqueue = (controller: LifecycleController): void => {
    if (
      isDisposed ||
      controller.disposed ||
      controller.terminal ||
      controller.inFlight ||
      isHidden()
    ) {
      return;
    }
    controller.queued = true;
    queuedControllers.add(controller);
  };

  const schedule = (controller: LifecycleController, delay: number): void => {
    clearTimer(controller);
    if (
      isDisposed ||
      controller.disposed ||
      controller.terminal ||
      isHidden()
    ) {
      return;
    }
    controller.timer = scheduler.setTimeout(() => {
      controller.timer = undefined;
      enqueue(controller);
      drain();
    }, jitteredDelay(delay));
  };

  const settleWithFailure = (controller: LifecycleController): void => {
    controller.nominalDelay = Math.min(
      MAX_FAILURE_DELAY,
      controller.nominalDelay * 2
    );
    schedule(controller, controller.nominalDelay);
  };

  const start = (controller: LifecycleController): void => {
    controller.queued = false;
    queuedControllers.delete(controller);
    if (
      isDisposed ||
      controller.disposed ||
      controller.terminal ||
      controller.inFlight ||
      isHidden() ||
      activeRequests >= maxConcurrent ||
      activeRows.has(controller.rowId)
    ) {
      enqueue(controller);
      return;
    }

    const token = ++nextToken;
    const requestId = `${scope}-${controller.rowId}-${token}`;
    controller.token = token;
    controller.requestId = requestId;
    controller.inFlight = true;
    activeRequests += 1;
    activeRows.add(controller.rowId);

    void fetchLifecycle(controller.rowId, requestId)
      .then(({ data }) => {
        if (!isCurrent(controller, token, requestId)) return;
        const previous = snapshots.value[controller.rowId];
        const changed = materialChanged(previous, data);
        snapshots.value[controller.rowId] = data;
        if (changed && options.onSnapshot) {
          void Promise.resolve(
            options.onSnapshot(controller.rowId, data, previous)
          ).catch(() => undefined);
        }
        if (data.terminal) {
          controller.terminal = true;
          clearTimer(controller);
          return;
        }
        if (data.reconciliation === "DEGRADED") {
          settleWithFailure(controller);
          return;
        }
        if (changed) {
          controller.nominalDelay = INITIAL_DELAY;
        }
        const delay = controller.nominalDelay;
        controller.nominalDelay = Math.min(
          MAX_NORMAL_DELAY,
          controller.nominalDelay * 2
        );
        schedule(controller, delay);
      })
      .catch(() => {
        if (isCurrent(controller, token, requestId)) {
          settleWithFailure(controller);
        }
      })
      .finally(() => {
        releaseRequest(controller);
        drain();
      });
  };

  function drain(): void {
    if (isDisposed || isHidden()) return;
    for (const controller of queuedControllers) {
      if (activeRequests >= maxConcurrent) return;
      if (activeRows.has(controller.rowId)) continue;
      start(controller);
    }
  }

  const unwatchRow = (rowId: string): void => {
    const normalizedRowId = normalizePositiveTaskRowId(rowId);
    const controller = controllers.get(normalizedRowId);
    if (controller) {
      controller.disposed = true;
      clearTimer(controller);
      queuedControllers.delete(controller);
      controller.queued = false;
      if (controller.requestId) abortRequest(controller.requestId);
      controllers.delete(normalizedRowId);
    }
    delete snapshots.value[normalizedRowId];
  };

  const watchRow = (rowId: string, initial?: AgentTaskLifecycle): void => {
    const normalizedRowId = normalizePositiveTaskRowId(rowId);
    if (controllers.has(normalizedRowId)) unwatchRow(normalizedRowId);
    if (initial) snapshots.value[normalizedRowId] = initial;

    const controller: LifecycleController = {
      rowId: normalizedRowId,
      token: ++nextToken,
      nominalDelay: INITIAL_DELAY,
      inFlight: false,
      disposed: false,
      queued: false,
      terminal: initial?.terminal === true,
    };
    controllers.set(normalizedRowId, controller);
    if (!controller.terminal) {
      enqueue(controller);
      drain();
    }
  };

  const pollNow = (rowId: string): void => {
    const normalizedRowId = normalizePositiveTaskRowId(rowId);
    const controller = controllers.get(normalizedRowId);
    if (!controller || controller.terminal || controller.inFlight) return;
    clearTimer(controller);
    enqueue(controller);
    drain();
  };

  const onVisibilityChange = (): void => {
    if (isHidden()) {
      for (const controller of controllers.values()) clearTimer(controller);
      return;
    }
    for (const controller of controllers.values()) {
      if (!controller.terminal && !controller.inFlight) {
        enqueue(controller);
      }
    }
    drain();
  };

  documentRef?.addEventListener("visibilitychange", onVisibilityChange);

  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    documentRef?.removeEventListener("visibilitychange", onVisibilityChange);
    for (const controller of controllers.values()) {
      controller.disposed = true;
      clearTimer(controller);
      if (controller.requestId) abortRequest(controller.requestId);
    }
    queuedControllers.clear();
    controllers.clear();
  };

  return {
    snapshots: readonly(snapshots),
    watchRow,
    unwatchRow,
    pollNow,
    dispose,
  };
}
