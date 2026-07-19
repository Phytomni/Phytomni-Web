/**
 * The narrow Bot lifecycle projection consumed by Vue.
 *
 * The API response is deliberately treated as `unknown` at this boundary. A
 * parser returns a fresh object containing only bounded, user-visible fields;
 * Bot envelopes, provider payloads, and diagnostic metadata never become
 * reactive state.
 */

export const MAX_BOT_RUN_ID_LENGTH = 128;
export const MAX_BOT_AGENT_LENGTH = 64;
export const MAX_BOT_STATUS_LENGTH = 32;
export const MAX_BOT_REPORT_LENGTH = 1 << 20;
export const MAX_BOT_DEGRADED_REASON_LENGTH = 256;
export const MAX_BOT_FAILURES = 32;
export const MAX_BOT_FAILURE_LENGTH = 256;
export const MAX_BOT_FAILURE_FIELD_LENGTH = 128;
export const MAX_BOT_ARTIFACTS = 64;
export const MAX_BOT_ARTIFACT_PATHS = 256;
export const MAX_BOT_ARTIFACT_PATH_LENGTH = 512;
export const MAX_BOT_REQUEST_ID_LENGTH = 256;
export const MAX_BOT_PROGRESS_COUNTER = 1_000_000_000;
export const MAX_BOT_INTEROP_MODE_LENGTH = 16;
export const MAX_BOT_INTEROP_STATUS_LENGTH = 16;
export const MAX_BOT_INTEROP_TARGET_ID_LENGTH = 64;
export const MAX_BOT_INTEROP_KIND_LENGTH = 8;
export const MAX_BOT_INTEROP_CODE_LENGTH = 32;

export type BotRunStatus =
  | "RUNNING"
  | "INPUT_REQUIRED"
  | "SUCCEEDED"
  | "FAILED"
  | "PENDING"
  | "QUEUED"
  | "CANCELLED"
  | "TIMED_OUT";

export type BotInteropMode = "off" | "auto" | "required";
export type BotInteropStatus = "local" | "delegated" | "degraded" | "failed";
export type BotInteropKind = "mcp" | "a2a";
export type BotInteropCode =
  | "disabled"
  | "forbidden"
  | "unavailable"
  | "discovery_failed"
  | "no_evidence"
  | "target_unavailable"
  | "invalid_request"
  | "degraded"
  | "input_required"
  | "interop_failed";

/** A bounded, Web-owned explanation of an interop decision. */
export interface BotInteropProvenance {
  mode: BotInteropMode;
  status: BotInteropStatus;
  targetId?: string;
  kind?: BotInteropKind;
  code?: BotInteropCode;
}

/** The snake_case shape emitted by the Go gateway before parser normalization. */
export interface BotInteropPayload {
  mode: BotInteropMode;
  status: BotInteropStatus;
  target_id?: string;
  kind?: BotInteropKind;
  code?: BotInteropCode;
}

export type BotReportStage =
  | "waiting_for_brief_gene"
  | "intermediate"
  | "final"
  | null;

export type BotReportCompleteness = "none" | "partial" | "complete" | null;

export interface BotProgress {
  completed: number;
  total: number;
  failed: number;
  pending: number;
  briefGeneStatus: string;
}

/** A validated directory and its validated OBS object references. */
export interface BotArtifact {
  outputDir: string;
  paths: string[];
}

export interface BotRunProjection {
  runId: string | null;
  agent: string;
  status: BotRunStatus;
  reportStage: BotReportStage;
  reportCompleteness: BotReportCompleteness;
  reportRevision: number;
  reportUpdatedAt: string | null;
  intermediateReport: string;
  finalReport: string;
  progress: BotProgress;
  degraded: boolean;
  degradedReason: string | null;
  failures: string[];
  artifacts: BotArtifact[];
  requestId: string | null;
  trackingDegraded: boolean;
  /** True when the interop path degraded; never contains provider metadata. */
  degradedInterop?: boolean;
  /** Safe interop provenance, or null for legacy/local responses. */
  interop?: BotInteropProvenance | null;
}

type JsonRecord = Record<string, unknown>;

const STATUS_ALIASES: Record<string, BotRunStatus> = {
  RUNNING: "RUNNING",
  INPUT_REQUIRED: "INPUT_REQUIRED",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  PENDING: "PENDING",
  QUEUED: "QUEUED",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
  TIMED_OUT: "TIMED_OUT",
  TIMEOUT: "TIMED_OUT",
};

const REPORT_STAGES = new Set<Exclude<BotReportStage, null>>([
  "waiting_for_brief_gene",
  "intermediate",
  "final",
]);

const REPORT_COMPLETENESS = new Set<Exclude<BotReportCompleteness, null>>([
  "none",
  "partial",
  "complete",
]);

const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const INTEROP_MODES = new Set<BotInteropMode>(["off", "auto", "required"]);
const INTEROP_STATUSES = new Set<BotInteropStatus>([
  "local",
  "delegated",
  "degraded",
  "failed",
]);
const INTEROP_KINDS = new Set<BotInteropKind>(["mcp", "a2a"]);
const INTEROP_CODES = new Set<BotInteropCode>([
  "disabled",
  "forbidden",
  "unavailable",
  "discovery_failed",
  "no_evidence",
  "target_unavailable",
  "invalid_request",
  "degraded",
  "input_required",
  "interop_failed",
]);
const INTEROP_TARGET_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const INTEROP_AGENT_NAMES = new Set([
  "research",
  "design",
  "InSilicoResearchAgent",
  "DigitalDesignAgent",
]);

const own = (value: JsonRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function isJsonRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function projectionSources(input: JsonRecord): JsonRecord[] {
  const sources: JsonRecord[] = [input];
  const seen = new Set<JsonRecord>(sources);

  for (const key of ["projection", "result", "data"]) {
    const value = input[key];
    if (isJsonRecord(value) && !seen.has(value)) {
      sources.push(value);
      seen.add(value);
    }
  }
  return sources;
}

function readField(
  sources: readonly JsonRecord[],
  keys: readonly string[]
): unknown {
  for (const source of sources) {
    for (const key of keys) {
      if (own(source, key)) {
        return source[key];
      }
    }
  }
  return undefined;
}

function error(field: string, reason: string): never {
  throw new TypeError(`Invalid Bot projection ${field}: ${reason}`);
}

function boundedString(
  value: unknown,
  field: string,
  maxLength: number,
  options: {
    nullable?: boolean;
    trim?: boolean;
    allowLineBreaks?: boolean;
  } = {}
): string | null {
  const nullable = options.nullable ?? false;
  if (value === undefined || value === null) {
    if (nullable) return null;
    return "";
  }
  if (typeof value !== "string") {
    error(field, "must be a string");
  }
  if (
    Array.from(value).length > maxLength ||
    value.includes("\u0000") ||
    (!options.allowLineBreaks && /[\r\n\t]/u.test(value))
  ) {
    error(field, "is oversized or malformed");
  }
  return options.trim === false ? value : value.trim();
}

function optionalBoolean(value: unknown, field: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") error(field, "must be a boolean");
  return value;
}

function optionalRevision(value: unknown): number {
  if (value === undefined || value === null || value === "") return -1;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    error("report_revision", "must be an integer");
  }
  if (value < -1) error("report_revision", "must be -1 or non-negative");
  return value;
}

function parseRunId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const runId = boundedString(value, "run_id", MAX_BOT_RUN_ID_LENGTH);
  if (!runId) return null;
  if (/[\\/]/u.test(runId)) error("run_id", "contains a path separator");
  return runId;
}

function parseStatus(value: unknown): BotRunStatus {
  if (value === undefined || value === null || value === "") return "RUNNING";
  const status = boundedString(value, "status", MAX_BOT_STATUS_LENGTH);
  if (!status) return "RUNNING";
  const normalized = status.toUpperCase();
  const mapped = STATUS_ALIASES[normalized];
  if (!mapped) error("status", "unsupported value");
  return mapped;
}

function requiredInteropEnum<T extends string>(
  value: unknown,
  field: string,
  maxLength: number,
  values: ReadonlySet<T>
): T {
  const normalized = boundedString(value, field, maxLength);
  if (!normalized || !values.has(normalized as T)) {
    error(field, "unsupported value");
  }
  return normalized as T;
}

function optionalInteropString(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = boundedString(value, field, maxLength);
  return normalized || null;
}

function parseInterop(value: unknown): BotInteropProvenance | null {
  if (value === undefined || value === null) return null;
  if (!isJsonRecord(value)) error("interop", "must be an object");

  const mode = requiredInteropEnum(
    readField([value], ["mode"]),
    "interop.mode",
    MAX_BOT_INTEROP_MODE_LENGTH,
    INTEROP_MODES
  );
  const status = requiredInteropEnum(
    readField([value], ["status"]),
    "interop.status",
    MAX_BOT_INTEROP_STATUS_LENGTH,
    INTEROP_STATUSES
  );
  const targetId = optionalInteropString(
    readField([value], ["target_id", "targetId"]),
    "interop.target_id",
    MAX_BOT_INTEROP_TARGET_ID_LENGTH
  );
  if (targetId && !INTEROP_TARGET_ID_PATTERN.test(targetId)) {
    error("interop.target_id", "is malformed");
  }
  const kind = optionalInteropString(
    readField([value], ["kind"]),
    "interop.kind",
    MAX_BOT_INTEROP_KIND_LENGTH
  );
  if (kind && !INTEROP_KINDS.has(kind as BotInteropKind)) {
    error("interop.kind", "unsupported value");
  }
  const code = optionalInteropString(
    readField([value], ["code"]),
    "interop.code",
    MAX_BOT_INTEROP_CODE_LENGTH
  );
  if (code && !INTEROP_CODES.has(code as BotInteropCode)) {
    error("interop.code", "unsupported value");
  }

  const provenance: BotInteropProvenance = { mode, status };
  if (targetId) provenance.targetId = targetId;
  if (kind) provenance.kind = kind as BotInteropKind;
  if (code) provenance.code = code as BotInteropCode;
  return provenance;
}

function parseEnum<T extends string>(
  value: unknown,
  field: string,
  values: ReadonlySet<T>
): T | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = boundedString(value, field, MAX_BOT_STATUS_LENGTH);
  if (!normalized) return null;
  if (!values.has(normalized as T)) error(field, "unsupported value");
  return normalized as T;
}

function parseMarkdown(value: unknown, field: string): string {
  return (
    boundedString(value, field, MAX_BOT_REPORT_LENGTH, {
      trim: false,
      allowLineBreaks: true,
    }) ?? ""
  );
}

function parseUpdatedAt(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const updatedAt = boundedString(value, "report_updated_at", 64);
  if (!updatedAt) return null;
  if (!RFC3339_PATTERN.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) {
    error("report_updated_at", "must be an RFC3339 timestamp");
  }
  return updatedAt;
}

function parseProgress(value: unknown): BotProgress {
  if (value === undefined || value === null) {
    return {
      completed: 0,
      total: 0,
      failed: 0,
      pending: 0,
      briefGeneStatus: "",
    };
  }
  if (!isJsonRecord(value)) error("progress", "must be an object");

  const counter = (key: string): number => {
    const raw = value[key];
    if (raw === undefined || raw === null) return 0;
    if (
      typeof raw !== "number" ||
      !Number.isSafeInteger(raw) ||
      raw < 0 ||
      raw > MAX_BOT_PROGRESS_COUNTER
    ) {
      error(`progress.${key}`, "must be a bounded non-negative integer");
    }
    return raw;
  };

  const progress = {
    completed: counter("completed"),
    total: counter("total"),
    failed: counter("failed"),
    pending: counter("pending"),
    briefGeneStatus:
      boundedString(
        value.brief_gene_status ?? value.briefGeneStatus,
        "progress.brief_gene_status",
        MAX_BOT_FAILURE_FIELD_LENGTH
      ) ?? "",
  };
  if (progress.total > 0 && progress.completed > progress.total) {
    error("progress.completed", "cannot exceed total");
  }
  return progress;
}

function parseFailures(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) error("failures", "must be an array");
  if (value.length > MAX_BOT_FAILURES)
    error("failures", "contains too many entries");

  const failures: string[] = [];
  value.forEach((entry, index) => {
    let message: unknown = entry;
    if (isJsonRecord(entry)) {
      const rawMessage = entry.message;
      if (
        rawMessage !== undefined &&
        rawMessage !== null &&
        typeof rawMessage !== "string"
      ) {
        error(`failures[${index}].message`, "must be a string");
      }
      message = rawMessage;
      if (typeof message !== "string" || message.trim() === "") {
        const status = boundedString(
          entry.status,
          `failures[${index}].status`,
          MAX_BOT_FAILURE_FIELD_LENGTH
        );
        switch (status) {
          case "failed":
            message = "analysis task failed";
            break;
          case "timed_out":
            message = "analysis task timed out";
            break;
          case "cancelled":
            message = "analysis task cancelled";
            break;
          default:
            error(
              `failures[${index}]`,
              "must contain a message or a known failure status"
            );
        }
      }
    }
    if (typeof message !== "string") {
      error(`failures[${index}]`, "must contain a safe message");
    }
    const bounded = boundedString(
      message,
      `failures[${index}]`,
      MAX_BOT_FAILURE_LENGTH
    );
    if (bounded) failures.push(bounded);
  });
  return failures;
}

function validateOBSPath(value: unknown, field: string): string {
  const path = boundedString(value, field, MAX_BOT_ARTIFACT_PATH_LENGTH, {
    trim: false,
  });
  if (!path) error(field, "must not be empty");
  if (path !== path.trim()) error(field, "contains surrounding whitespace");
  if (
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /[\r\n\t ]/u.test(path)
  ) {
    error(field, "contains whitespace or delimiters");
  }

  if (path.startsWith("/obs/")) {
    const segments = path.split("/");
    if (segments.length < 4 || !segments[2]) {
      error(field, "must include a bucket and key");
    }
    if (
      segments
        .slice(2)
        .some(
          (part) =>
            part === "" ||
            part === "." ||
            part === ".." ||
            part.includes(":") ||
            part.includes("%")
        )
    ) {
      error(field, "contains traversal or invalid path segments");
    }
    return path;
  }

  if (!path.startsWith("obs://")) {
    error(field, "must be a validated /obs/<bucket>/<key> or obs:// URI");
  }
  const rest = path.slice("obs://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) {
    error(field, "must include a bucket and key");
  }
  const authority = rest.slice(0, slash);
  if (/[?#:%@]/u.test(authority)) {
    error(field, "contains userinfo or invalid bucket delimiters");
  }
  if (
    rest
      .slice(slash + 1)
      .split("/")
      .some(
        (part) =>
          part === "" ||
          part === "." ||
          part === ".." ||
          part.includes(":") ||
          part.includes("%")
      )
  ) {
    error(field, "contains traversal or invalid path segments");
  }
  return path;
}

/** Return true only for a fully validated internal OBS reference. */
export function isSafeBotObsPath(value: unknown): value is string {
  try {
    return validateOBSPath(value, "path") === value;
  } catch {
    return false;
  }
}

function parseRawArtifactArray(value: readonly unknown[]): BotArtifact[] {
  if (value.length > MAX_BOT_ARTIFACTS)
    error("artifacts", "contains too many entries");
  const artifacts: BotArtifact[] = [];
  let pathCount = 0;
  value.forEach((entry, index) => {
    if (!isJsonRecord(entry)) error(`artifacts[${index}]`, "must be an object");
    const rawOutputDir = entry.output_dir ?? entry.outputDir;
    const outputDir =
      rawOutputDir === undefined || rawOutputDir === null || rawOutputDir === ""
        ? ""
        : validateOBSPath(rawOutputDir, `artifacts[${index}].output_dir`);
    const rawPaths = entry.paths;
    if (
      rawPaths !== undefined &&
      rawPaths !== null &&
      !Array.isArray(rawPaths)
    ) {
      error(`artifacts[${index}].paths`, "must be an array");
    }
    const paths = (rawPaths ?? []).map((path, pathIndex) =>
      validateOBSPath(path, `artifacts[${index}].paths[${pathIndex}]`)
    );
    if (!outputDir && paths.length > 0) {
      error(
        `artifacts[${index}].output_dir`,
        "is required when paths are present"
      );
    }
    if (
      outputDir &&
      paths.some(
        (path) => path !== outputDir && !path.startsWith(`${outputDir}/`)
      )
    ) {
      error(`artifacts[${index}].paths`, "must remain within output_dir");
    }
    pathCount += paths.length;
    if (pathCount > MAX_BOT_ARTIFACT_PATHS) {
      error("artifacts", "contains too many paths");
    }
    artifacts.push({ outputDir, paths });
  });
  return artifacts;
}

function parseGoArtifactObject(value: JsonRecord): BotArtifact[] {
  const rawPaths = value.paths;
  const rawDirectories: unknown[] = [];
  for (const key of ["directories", "output_dirs"]) {
    const directoryValue = value[key];
    if (directoryValue === undefined || directoryValue === null) continue;
    if (!Array.isArray(directoryValue)) {
      error(`artifacts.${key}`, "must be an array");
    }
    if (directoryValue.length > MAX_BOT_ARTIFACTS) {
      error(`artifacts.${key}`, "contains too many entries");
    }
    rawDirectories.push(...directoryValue);
  }
  if (rawPaths !== undefined && rawPaths !== null && !Array.isArray(rawPaths)) {
    error("artifacts.paths", "must be an array");
  }

  const directories: string[] = [];
  for (const [index, directory] of rawDirectories.entries()) {
    const validated = validateOBSPath(
      directory,
      `artifacts.directories[${index}]`
    );
    if (!directories.includes(validated)) {
      directories.push(validated);
      if (directories.length > MAX_BOT_ARTIFACTS) {
        error("artifacts.directories", "contains too many entries");
      }
    }
  }
  const paths = (rawPaths ?? []).map((path, index) =>
    validateOBSPath(path, `artifacts.paths[${index}]`)
  );
  if (paths.length > MAX_BOT_ARTIFACT_PATHS) {
    error("artifacts.paths", "contains too many paths");
  }
  if (directories.length === 0) {
    if (paths.length > 0) {
      error("artifacts.directories", "is required when paths are present");
    }
    return [];
  }

  const artifacts = directories.map((outputDir) => ({
    outputDir,
    paths: [] as string[],
  }));
  for (const path of paths) {
    const match = artifacts.findIndex(
      ({ outputDir }) => path === outputDir || path.startsWith(`${outputDir}/`)
    );
    if (match < 0) {
      error("artifacts.paths", "path does not belong to a validated directory");
    }
    artifacts[match].paths.push(path);
  }
  return artifacts;
}

function parseArtifacts(value: unknown): BotArtifact[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return parseRawArtifactArray(value);
  if (!isJsonRecord(value)) error("artifacts", "must be an array or object");
  if (own(value, "artifacts")) return parseArtifacts(value.artifacts);
  return parseGoArtifactObject(value);
}

/** Decode a stable Go QueryData projection into a bounded, reactive-safe value. */
export function parseBotProjection(input: unknown): BotRunProjection {
  if (!isJsonRecord(input)) error("payload", "must be an object");
  const sources = projectionSources(input);

  const runId = parseRunId(
    readField(sources, ["bot_run_id", "run_id", "runId"])
  );
  const agentValue = boundedString(
    readField(sources, ["agent", "tool_name", "toolName"]),
    "agent",
    MAX_BOT_AGENT_LENGTH
  );
  const intermediateValue = parseMarkdown(
    readField(sources, ["intermediate_report", "intermediateReport"]),
    "intermediate_report"
  );
  const finalValue = parseMarkdown(
    readField(sources, ["final_report", "finalReport"]),
    "final_report"
  );
  const status = parseStatus(readField(sources, ["status"]));
  const answer = parseMarkdown(readField(sources, ["answer"]), "answer");
  const hasExplicitReport =
    intermediateValue.trim() !== "" || finalValue.trim() !== "";
  const intermediateReport =
    hasExplicitReport || status === "SUCCEEDED" ? intermediateValue : answer;
  const finalReport = hasExplicitReport
    ? finalValue
    : status === "SUCCEEDED"
    ? answer
    : finalValue;
  const interopEnabled = INTEROP_AGENT_NAMES.has(agentValue ?? "");

  return {
    runId,
    agent: agentValue ?? "",
    status,
    reportStage: parseEnum(
      readField(sources, ["report_stage", "reportStage"]),
      "report_stage",
      REPORT_STAGES
    ),
    reportCompleteness: parseEnum(
      readField(sources, ["report_completeness", "reportCompleteness"]),
      "report_completeness",
      REPORT_COMPLETENESS
    ),
    reportRevision: optionalRevision(
      readField(sources, ["report_revision", "reportRevision"])
    ),
    reportUpdatedAt: parseUpdatedAt(
      readField(sources, ["report_updated_at", "reportUpdatedAt"])
    ),
    intermediateReport,
    finalReport,
    progress: parseProgress(readField(sources, ["progress"])),
    degraded: optionalBoolean(readField(sources, ["degraded"]), "degraded"),
    degradedReason: boundedString(
      readField(sources, ["degraded_reason", "degradedReason"]),
      "degraded_reason",
      MAX_BOT_DEGRADED_REASON_LENGTH,
      { nullable: true }
    ),
    failures: parseFailures(readField(sources, ["failures"])),
    artifacts: parseArtifacts(readField(sources, ["artifacts"])),
    requestId: boundedString(
      readField(sources, ["request_id", "requestId"]),
      "request_id",
      MAX_BOT_REQUEST_ID_LENGTH,
      { nullable: true }
    ),
    trackingDegraded: optionalBoolean(
      readField(sources, ["tracking_degraded", "trackingDegraded"]),
      "tracking_degraded"
    ),
    degradedInterop: interopEnabled
      ? optionalBoolean(
          readField(sources, ["degraded_interop", "degradedInterop"]),
          "degraded_interop"
        )
      : false,
    interop: interopEnabled
      ? parseInterop(readField(sources, ["interop"]))
      : null,
  };
}

/** Return final Markdown when present, otherwise the latest intermediate text. */
export function visibleBotReport(projection: BotRunProjection): string {
  return projection.finalReport.trim() !== ""
    ? projection.finalReport
    : projection.intermediateReport;
}
