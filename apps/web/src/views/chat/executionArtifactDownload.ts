import { getExecutionTargetFile } from "@/api/chat";
import { saveAs } from "file-saver";
import { executionTargetBlob } from "./executionTargetContent";
import type {
  ExecutionResult,
  ExecutionTarget,
} from "./streaming/executionEvents";

export interface ExecutionArtifactDownloadRequest {
  deliveryUrl: string;
  name: string;
  requestId: string;
}

function safeDownloadName(rawName: string): string {
  const leaf = rawName.replace(/\\/g, "/").split("/").at(-1)?.trim() ?? "";
  const bounded = leaf.slice(0, 255).replace(/[\u0000-\u001f\u007f]/gu, "");
  return bounded && bounded !== "." && bounded !== ".." ? bounded : "result";
}

export function executionArtifactDownloadName(
  target: ExecutionTarget,
  resolvedName: string | undefined,
  results: readonly ExecutionResult[]
): string {
  if (resolvedName?.trim()) return resolvedName;
  return (
    results.find(
      (result) =>
        result.target.kind === target.kind && result.target.id === target.id
    )?.name ?? "result"
  );
}

export async function downloadExecutionArtifact(
  request: ExecutionArtifactDownloadRequest
): Promise<void> {
  const response = await getExecutionTargetFile(request.deliveryUrl, {
    requestId: request.requestId,
  });
  const blob = executionTargetBlob(response);
  if (!blob) {
    throw new TypeError("Invalid execution target content");
  }
  saveAs(blob, safeDownloadName(request.name));
}
