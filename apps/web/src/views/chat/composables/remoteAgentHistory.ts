import { type RemoteAgentTool } from "@/constants/agents";
import {
  decodeConversationArtifacts,
  type AgentResultDelivery,
  type ConversationArtifactLink,
} from "@/api/types";
import {
  isSafeBotObsPath,
  parseBotProjection,
  type BotArtifact,
  type BotRunProjection,
} from "@/views/chat/botProjection";

const SAFE_DIALOGUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const SAFE_ROW_ID = /^[1-9]\d{0,18}$/u;
const MAX_HISTORY_ROWS = 64;
const MAX_HISTORY_ARTIFACTS = 64;

type HistoryRecord = Record<string, unknown>;

export interface RemoteAgentHistorySnapshot {
  projection: BotRunProjection;
  rowId: string;
  dialogueId: string | null;
  delivery?: AgentResultDelivery;
  artifactLinks?: ConversationArtifactLink[];
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isHistoryRecord(value: unknown): value is HistoryRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !isUnknownArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function safeHistoryIdentity(value: unknown, pattern: RegExp): string | null {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  return normalized && pattern.test(normalized) ? normalized : null;
}

function historyArtifactPaths(value: unknown): string[] {
  const values: unknown[] = [];
  if (isUnknownArray(value)) {
    values.push(...value.slice(0, MAX_HISTORY_ARTIFACTS));
  } else if (typeof value === "string" && value.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isUnknownArray(parsed)) {
        values.push(...parsed.slice(0, MAX_HISTORY_ARTIFACTS));
      } else {
        values.push(value);
      }
    } catch {
      values.push(value);
    }
  }
  return values.filter(isSafeBotObsPath).slice(0, MAX_HISTORY_ARTIFACTS);
}

function artifactsFromHistoryRow(row: HistoryRecord): BotArtifact[] {
  const outputDirs = historyArtifactPaths(row.download_path);
  const imagePaths = historyArtifactPaths(row.image_paths);
  return outputDirs.map((outputDir) => {
    const paths = imagePaths.filter(
      (path) => path === outputDir || path.startsWith(`${outputDir}/`)
    );
    return {
      outputDir,
      paths: paths.length > 0 ? paths : [outputDir],
    };
  });
}

function snapshotFromHistoryRow(
  row: unknown,
  tool: RemoteAgentTool,
  expectedRunId: string
): RemoteAgentHistorySnapshot | null {
  if (
    !isHistoryRecord(row) ||
    row.tool_name !== tool ||
    row.bot_run_id !== expectedRunId
  ) {
    return null;
  }
  const rowId = safeHistoryIdentity(row.id, SAFE_ROW_ID);
  if (!rowId) return null;
  const rawDialogueId = row.dialogue_id;
  const dialogueId =
    rawDialogueId === undefined || rawDialogueId === null
      ? null
      : typeof rawDialogueId === "string"
        ? safeHistoryIdentity(rawDialogueId, SAFE_DIALOGUE_ID)
        : null;
  if (rawDialogueId !== undefined && rawDialogueId !== null && !dialogueId) {
    return null;
  }

  let answerPayload: unknown = row.answer;
  if (typeof row.answer === "string" && row.answer.trim() !== "") {
    try {
      answerPayload = JSON.parse(row.answer);
    } catch {
      answerPayload = row.answer;
    }
  }
  const candidate: HistoryRecord = isHistoryRecord(answerPayload)
    ? { ...answerPayload }
    : {};
  for (const key of [
    "status",
    "tool_name",
    "bot_run_id",
    "report_revision",
    "request_id",
    "tracking_degraded",
    "result_archive_v1",
    "delivery",
  ]) {
    if (row[key] !== undefined && candidate[key] === undefined) {
      candidate[key] = row[key];
    }
  }
  if (candidate.answer === undefined && typeof row.answer === "string") {
    candidate.answer = row.answer;
  }
  if (
    candidate.answer === undefined &&
    typeof candidate.final_answer === "string"
  ) {
    candidate.answer = candidate.final_answer;
  }

  try {
    const projection = parseBotProjection(candidate);
    if (projection.agent !== tool || projection.runId !== expectedRunId) {
      return null;
    }
    const rowArtifacts = projection.resultArchiveV1
      ? []
      : artifactsFromHistoryRow(row);
    const artifactLinks =
      projection.resultArchiveV1 && row.artifacts !== undefined
        ? decodeConversationArtifacts(row.artifacts)
        : [];
    return {
      projection: {
        ...projection,
        artifacts:
          rowArtifacts.length > 0 ? rowArtifacts : projection.artifacts,
      },
      rowId,
      dialogueId,
      ...(projection.delivery ? { delivery: { ...projection.delivery } } : {}),
      ...(projection.resultArchiveV1
        ? { artifactLinks: artifactLinks.map((artifact) => ({ ...artifact })) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function findRemoteAgentHistorySnapshot(
  rows: readonly unknown[],
  tool: RemoteAgentTool,
  expectedRunId: string,
  expectedRowId: string,
  expectedDialogueId: string
): RemoteAgentHistorySnapshot | null {
  for (const row of rows.slice(0, MAX_HISTORY_ROWS)) {
    const snapshot = snapshotFromHistoryRow(row, tool, expectedRunId);
    if (
      !snapshot ||
      snapshot.rowId !== expectedRowId ||
      (snapshot.dialogueId !== null &&
        snapshot.dialogueId !== expectedDialogueId)
    ) {
      continue;
    }
    return snapshot;
  }
  return null;
}
