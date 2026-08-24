import type { ArtifactTab, ChatMessage } from "../types";
import { researchRowLifecycleStatus } from "./artifact-policy";
import { generatedFormatsForTool } from "./message-action-capabilities";

export type ArtifactChromeSurface = "chat" | "standalone" | "client";

export type ArtifactChrome = {
  tabs: ArtifactTab[];
  exportFormats: string[];
};

const CITED_REFERENCE_TOOLS = new Set([
  "KnowledgeAgent",
  "BriefGeneAgent",
  "ReviewAgent",
  "DeepGenomeAgent",
]);

const ATTACHMENT_TOOLS = new Set([
  "AnalystAgent",
  "InSilicoResearchAgent",
  "DigitalDesignAgent",
  "GeneNetworkAgent",
]);

export function artifactHasDownloadableFiles(input: {
  conversationArtifacts?: readonly unknown[] | null;
  botArtifacts?: readonly { paths?: readonly unknown[] }[] | null;
  resultArchiveV1?: boolean;
  delivery?: { status?: string; error_code?: string | null } | null;
}): boolean {
  if ((input.conversationArtifacts?.length ?? 0) > 0) return true;
  if (
    (input.botArtifacts ?? []).some(
      (item) => Array.isArray(item.paths) && item.paths.length > 0
    )
  ) {
    return true;
  }
  if (input.delivery?.error_code === "no_user_deliverables") return false;
  if (input.resultArchiveV1 === true) return true;
  return input.delivery != null;
}

export function artifactDownloadFormat(command: string): string | null {
  const prefix = "download:";
  if (!command.startsWith(prefix)) return null;
  const format = command.slice(prefix.length);
  return format === "" ? null : format;
}

function isRunComplete(status: unknown, streaming?: boolean): boolean {
  if (streaming === true) return false;
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "") return true;
  const phase = researchRowLifecycleStatus(normalized);
  return phase !== "RUNNING" && phase !== "INPUT_REQUIRED";
}

function exportFormatsFor(
  tool: string,
  surface: ArtifactChromeSurface
): string[] {
  if (surface === "standalone") return [];
  if (surface === "client") {
    return tool === "DeepGenomeAgent"
      ? ["PDF", "Markdown"]
      : generatedFormatsForTool(tool);
  }
  return generatedFormatsForTool(tool);
}

export function artifactChrome(input: {
  tool: string;
  referenceCount: number;
  hasAttachments: boolean;
  runComplete: boolean;
  activityOnly?: boolean;
  surface?: ArtifactChromeSurface;
}): ArtifactChrome {
  const surface = input.surface ?? "chat";
  if (input.activityOnly) {
    return { tabs: ["activity"], exportFormats: [] };
  }

  const tabs: ArtifactTab[] = ["content"];
  const cited = CITED_REFERENCE_TOOLS.has(input.tool);
  if (cited && (!input.runComplete || input.referenceCount > 0)) {
    tabs.push("evidence");
  } else if (!cited && input.referenceCount > 0) {
    tabs.push("evidence");
  }

  const includeActivity =
    surface === "standalone" || input.tool === "InSilicoResearchAgent";
  if (includeActivity) tabs.push("activity");

  if (ATTACHMENT_TOOLS.has(input.tool) && input.hasAttachments) {
    tabs.push("downloads");
  }

  return {
    tabs,
    exportFormats: exportFormatsFor(input.tool, surface),
  };
}

export function artifactChromeFromMessage(
  message: Pick<
    ChatMessage,
    | "tool_name"
    | "doc_list"
    | "status"
    | "streaming"
    | "artifacts"
    | "delivery"
    | "botLifecycle"
    | "botProjection"
  >
): ArtifactChrome {
  const tool = message.tool_name ?? "";
  const status =
    message.botLifecycle?.status ??
    message.botProjection?.status ??
    message.status;
  const chrome = artifactChrome({
    tool,
    referenceCount: message.doc_list?.length ?? 0,
    hasAttachments: artifactHasDownloadableFiles({
      conversationArtifacts: message.artifacts,
      botArtifacts:
        message.botLifecycle?.artifacts ?? message.botProjection?.artifacts,
      resultArchiveV1: message.botProjection?.resultArchiveV1 === true,
      delivery:
        message.delivery ??
        message.botLifecycle?.delivery ??
        message.botProjection?.delivery,
    }),
    runComplete: isRunComplete(status, message.streaming),
    surface: "chat",
  });
  if (message.streaming === true) {
    return { ...chrome, exportFormats: [] };
  }
  return chrome;
}
