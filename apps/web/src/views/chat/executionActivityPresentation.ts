import type {
  ExecutionEvent,
  ExecutionOperationRecord,
  ExecutionOperationStatus,
  ExecutionRunState,
} from "./streaming/executionEvents";
import { operationGroupingPolicy } from "./streaming/executionEvents";

const WORK_EVENT_PREFIX = "work_unit.";
const SPAN_EVENT_PREFIX = "span.";

const USER_WORKFLOW_EVENT_KINDS = new Set([
  "decision.note",
  "input.required",
  "input.resolved",
  "reasoning.summary",
]);

const AGENT_SEMANTIC_PHASES: Readonly<Record<string, ReadonlySet<string>>> = {
  chat: new Set(["understanding", "responding", "follow_up"]),
  knowledge: new Set(["retrieving", "generating"]),
  data: new Set(["retrieving", "rewriting", "querying"]),
  analyst: new Set(["preparing", "analyzing", "publishing"]),
  review: new Set([
    "planning",
    "retrieving",
    "drafting",
    "revising",
    "generating",
  ]),
  brief_gene: new Set(["annotating", "retrieving", "analyzing", "generating"]),
  deep_genome: new Set(["planning", "analyzing", "synthesizing"]),
  research: new Set(["planning", "researching", "synthesizing"]),
  design: new Set(["planning", "designing", "consolidating"]),
  network: new Set(["planning", "analyzing", "consolidating"]),
};

const REVIEW_OPERATION_SEMANTIC_PHASES: Readonly<Record<string, string>> = {
  "review.retrieve_dimension": "retrieving",
  "review.draft_dimension": "drafting",
  "review.citation_check": "revising",
  "review.final_synthesis": "generating",
};

export type ExecutionWorkflowItem =
  | {
      kind: "operation";
      id: string;
      occurredAt: string;
      operation: ExecutionOperationRecord;
      relatedOperations: ExecutionOperationRecord[];
      groupedOperations: ExecutionOperationRecord[];
    }
  | {
      kind: "event";
      id: string;
      occurredAt: string;
      event: ExecutionEvent;
    };

function isRecognizedSemanticPhase(
  run: ExecutionRunState,
  event: ExecutionEvent
): boolean {
  if (
    !event.kind.startsWith("phase.") &&
    !event.kind.startsWith(SPAN_EVENT_PREFIX)
  ) {
    return false;
  }
  const phase = event.payload.phase;
  const declared = run.agentSlug ? AGENT_SEMANTIC_PHASES[run.agentSlug] : null;
  return typeof phase === "string" && !!declared?.has(phase);
}

type WorkflowOperation = {
  operation: ExecutionOperationRecord;
  relatedOperations: ExecutionOperationRecord[];
  groupedOperations: ExecutionOperationRecord[];
};

function userWorkflowOperations(run: ExecutionRunState): WorkflowOperation[] {
  const approved = presentExecutionActivityOperations(run).filter(
    (operation) => operation.operationKey !== "operation.unknown"
  );
  const hasSpecificOperation = approved.some(
    (operation) => operation.operationKey !== "model.generate"
  );
  const visible = hasSpecificOperation
    ? approved.filter(
        (operation) => operation.operationKey !== "model.generate"
      )
    : approved;
  return groupLogicalOperations(run, attachRelatedOperations(run, visible));
}

const TERMINAL_OPERATION_STATUSES = new Set<ExecutionOperationStatus>([
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "timed_out",
]);

function aggregateOperationStatus(
  operations: ExecutionOperationRecord[]
): ExecutionOperationStatus {
  const statuses = operations.map((operation) => operation.status);
  if (statuses.includes("retrying")) return "retrying";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("queued")) {
    return statuses.every((status) => status === "queued")
      ? "queued"
      : "running";
  }
  const distinct = new Set(statuses);
  return distinct.size === 1 ? statuses[0] : "partial";
}

function earliestTimestamp(
  operations: ExecutionOperationRecord[],
  field: "startedAt" | "lastObservationAt"
): string {
  return operations.reduce((selected, operation) =>
    Date.parse(operation[field]) < Date.parse(selected[field])
      ? operation
      : selected
  )[field];
}

function latestTimestamp(
  operations: ExecutionOperationRecord[],
  field: "lastObservationAt" | "completedAt"
): string | null {
  return operations.reduce((selected, operation) => {
    const candidate = operation[field];
    const selectedValue = selected[field];
    if (!candidate) return selected;
    if (!selectedValue || Date.parse(candidate) > Date.parse(selectedValue)) {
      return operation;
    }
    return selected;
  })[field];
}

function aggregateSiblingOperations(
  operations: ExecutionOperationRecord[],
  unit: string
): ExecutionOperationRecord {
  const first = operations[0];
  const startedAt = earliestTimestamp(operations, "startedAt");
  const lastObservationAt =
    latestTimestamp(operations, "lastObservationAt") ?? first.lastObservationAt;
  const completed = operations.filter((operation) =>
    TERMINAL_OPERATION_STATUSES.has(operation.status)
  ).length;
  const allTerminal = completed === operations.length;
  const completedAt = allTerminal
    ? latestTimestamp(operations, "completedAt")
    : null;
  return {
    schemaVersion: 1,
    operationId: `operation-group:${first.operationKey}:${first.workUnitId}`,
    workUnitId: `operation-group:${first.operationKey}:${first.workUnitId}`,
    operationKey: first.operationKey,
    labelKey: first.labelKey,
    fallbackLabel: first.fallbackLabel,
    status: aggregateOperationStatus(operations),
    startedAt,
    lastObservationAt,
    completedAt,
    durationMs: Math.max(
      0,
      Date.parse(lastObservationAt) - Date.parse(startedAt)
    ),
    currentAttempt: Math.max(
      ...operations.map((operation) => operation.currentAttempt)
    ),
    attempts: [],
    progress: { completed, total: operations.length, unit },
    detail: {},
    summary: null,
    target: null,
  };
}

function operationSpan(run: ExecutionRunState, workUnitId: string) {
  return Object.values(run.spans).find(
    (span) => span.workUnitId === workUnitId
  );
}

function attachRelatedOperations(
  run: ExecutionRunState,
  operations: ExecutionOperationRecord[]
): WorkflowOperation[] {
  const byWorkUnit = new Map(
    operations.map((operation) => [operation.workUnitId, operation])
  );
  const related = new Map<string, ExecutionOperationRecord[]>();
  const primary: ExecutionOperationRecord[] = [];
  for (const operation of operations) {
    const policy = operationGroupingPolicy(operation.operationKey);
    if (policy?.policy !== "attach_to_parent") {
      primary.push(operation);
      continue;
    }
    const span = operationSpan(run, operation.workUnitId);
    const parentSpan = span?.parentSpanId
      ? run.spans[span.parentSpanId]
      : undefined;
    const parent = parentSpan?.workUnitId
      ? byWorkUnit.get(parentSpan.workUnitId)
      : undefined;
    if (!parent || parent.operationKey !== policy.parentOperationKey) {
      primary.push(operation);
      continue;
    }
    const siblings = related.get(parent.workUnitId) ?? [];
    siblings.push(operation);
    related.set(parent.workUnitId, siblings);
  }
  return primary.map((operation) => ({
    operation,
    relatedOperations: related.get(operation.workUnitId) ?? [],
    groupedOperations: [],
  }));
}

function groupLogicalOperations(
  run: ExecutionRunState,
  items: WorkflowOperation[]
): WorkflowOperation[] {
  const grouped = new Map<
    string,
    { unit: string; items: WorkflowOperation[]; keepBranches: boolean }
  >();
  const visible: WorkflowOperation[] = [];

  for (const item of items) {
    const operation = item.operation;
    const grouping = operationGroupingPolicy(operation.operationKey);
    if (
      grouping?.policy !== "group_siblings" ||
      (grouping.identity === "operation_key" && operation.target)
    ) {
      visible.push(item);
      continue;
    }
    const parentSpanId = operationSpan(run, operation.workUnitId)?.parentSpanId;
    const identity =
      grouping.identity === "parent_span"
        ? (parentSpanId ?? operation.workUnitId)
        : operation.operationKey;
    const key = `${operation.operationKey}\u0000${identity}`;
    const current = grouped.get(key);
    if (current) current.items.push(item);
    else {
      grouped.set(key, {
        unit: grouping.unit,
        items: [item],
        keepBranches:
          grouping.identity === "parent_span" ||
          grouping.preserveBranches === true,
      });
    }
  }

  for (const group of grouped.values()) {
    if (group.items.length === 1) {
      visible.push(group.items[0]);
      continue;
    }
    const operations = group.items.map((item) => item.operation);
    visible.push({
      operation: aggregateSiblingOperations(operations, group.unit),
      relatedOperations: group.items.flatMap((item) => item.relatedOperations),
      groupedOperations: group.keepBranches ? operations : [],
    });
  }
  return visible;
}

/**
 * Project the durable ledger and grouped operation records into one concise,
 * chronological user workflow. The journal remains unchanged and available
 * separately through presentExecutionTechnicalEvents.
 */
export function presentExecutionWorkflowItems(
  run: ExecutionRunState
): ExecutionWorkflowItem[] {
  const operations = userWorkflowOperations(run);
  const coveredSemanticPhases = new Set(
    run.agentSlug === "review"
      ? operations
          .map(
            ({ operation }) =>
              REVIEW_OPERATION_SEMANTIC_PHASES[operation.operationKey]
          )
          .filter((phase): phase is string => typeof phase === "string")
      : []
  );
  const workflow: ExecutionWorkflowItem[] = operations.map(
    ({ operation, relatedOperations, groupedOperations }) => ({
      kind: "operation",
      id: operation.operationId,
      occurredAt: operation.startedAt,
      operation,
      relatedOperations,
      groupedOperations,
    })
  );
  let firstTodo: ExecutionEvent | null = null;
  let latestTodo: ExecutionEvent | null = null;

  for (const event of [...run.events].sort(
    (left, right) => left.seq - right.seq
  )) {
    if (event.kind === "todo.snapshot") {
      firstTodo ??= event;
      latestTodo = event;
      continue;
    }
    if (
      USER_WORKFLOW_EVENT_KINDS.has(event.kind) ||
      (isRecognizedSemanticPhase(run, event) &&
        !coveredSemanticPhases.has(String(event.payload.phase)))
    ) {
      workflow.push({
        kind: "event",
        id: event.eventId,
        occurredAt: event.occurredAt,
        event,
      });
    }
  }

  if (firstTodo && latestTodo) {
    workflow.push({
      kind: "event",
      id: `todo-plan:${firstTodo.eventId}`,
      occurredAt: firstTodo.occurredAt,
      event: latestTodo,
    });
  }

  return workflow.sort((left, right) => {
    const occurred = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
    return occurred || left.id.localeCompare(right.id);
  });
}

/** Return the retained raw public ledger used only by paged diagnostics. */
export function presentExecutionTechnicalEvents(
  run: ExecutionRunState
): ExecutionEvent[] {
  return [...run.events].sort((left, right) => left.seq - right.seq);
}

/**
 * Convert the append-only diagnostic ledger into a concise activity feed.
 *
 * The raw ledger intentionally contains every framework transition for
 * recovery and audit.  The chat surface instead presents one current row per
 * logical work unit/span while retaining user-facing notes, results and
 * terminal execution facts.  No event is deleted from the durable ledger.
 */
export function presentExecutionActivityEvents(
  run: ExecutionRunState
): ExecutionEvent[] {
  const standalone: ExecutionEvent[] = [];
  const workUnits = new Map<string, ExecutionEvent>();
  const spans = new Map<string, ExecutionEvent>();
  const graphPhases = new Map<string, ExecutionEvent>();

  for (const event of [...run.events].sort(
    (left, right) => left.seq - right.seq
  )) {
    if (event.kind === "execution.admitted") continue;
    if (event.kind === "span.created") continue;

    if (event.source === "graph") {
      const phase =
        typeof event.payload.phase === "string" && event.payload.phase
          ? event.payload.phase
          : event.spanId;
      if (phase) graphPhases.set(phase, event);
      continue;
    }

    // Root lifecycle duplicates execution.started/terminal events.
    if (
      event.kind.startsWith(SPAN_EVENT_PREFIX) &&
      event.source === "runtime" &&
      event.spanId &&
      !event.parentSpanId
    ) {
      continue;
    }

    if (event.workUnitId) {
      if (
        run.operations.some(
          (operation) => operation.workUnitId === event.workUnitId
        )
      ) {
        continue;
      }
      // Work-unit facts are the authoritative public lifecycle.  Attempt span
      // completion only means submission returned, not remote work completed.
      if (event.kind.startsWith(WORK_EVENT_PREFIX)) {
        workUnits.set(event.workUnitId, event);
      }
      continue;
    }

    if (event.kind.startsWith(SPAN_EVENT_PREFIX) && event.spanId) {
      spans.set(event.spanId, event);
      continue;
    }

    standalone.push(event);
  }

  return [
    ...standalone,
    ...graphPhases.values(),
    ...workUnits.values(),
    ...spans.values(),
  ].sort((left, right) => left.seq - right.seq);
}

/** One durable row per work-unit, in observation order. */
export function presentExecutionActivityOperations(
  run: ExecutionRunState
): ExecutionOperationRecord[] {
  return [...run.operations].sort((left, right) => {
    const observed =
      Date.parse(left.lastObservationAt) - Date.parse(right.lastObservationAt);
    return observed || left.operationId.localeCompare(right.operationId);
  });
}

export function executionActivityIsStreaming(
  run: ExecutionRunState,
  lifecycleTerminal: boolean,
  messageStatus?: string | null
): boolean {
  const normalizedStatus = messageStatus?.trim().toUpperCase() ?? "";
  const messageTerminal = [
    "SUCCEEDED",
    "FAILED",
    "TIMED_OUT",
    "TIMEOUT",
    "CANCELLED",
    "CANCELED",
  ].includes(normalizedStatus);

  return run.terminal === null && !lifecycleTerminal && !messageTerminal;
}
