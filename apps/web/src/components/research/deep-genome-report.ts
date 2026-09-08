import type { CitationDocument } from "@/views/chat/messageTypes";
import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";

export interface DeepGenomeReferenceMaterial {
  referenceIndex: number;
  excerpt?: string;
  resourceIds: readonly string[];
}

export interface DeepGenomeReport {
  body: string;
  references: readonly CitationDocument[];
  resources: readonly AuthorizedScientificResource[];
  referenceMaterials: readonly DeepGenomeReferenceMaterial[];
}

export type DeepGenomeMaterialSelection =
  | { kind: "excerpt"; referenceIndex: number }
  | { kind: "resource"; resourceId: string };

export interface DeepGenomeMaterialDetailState {
  reportKey: string;
  selection: DeepGenomeMaterialSelection | null;
  status: "idle" | "loading" | "ready" | "error";
  text: string;
  error: "unavailable" | "failed" | null;
}

export interface DeepGenomeLoadedMarkdown {
  text: string;
  bytes: Uint8Array;
}

export type DeepGenomeResourceReader = (
  resourceId: string,
  signal: AbortSignal
) => Promise<DeepGenomeLoadedMarkdown>;

export function createDeepGenomeMaterialDetailState(): DeepGenomeMaterialDetailState {
  return {
    reportKey: "",
    selection: null,
    status: "idle",
    text: "",
    error: null,
  };
}
