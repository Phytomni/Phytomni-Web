export type DeepGenomeDownloadFormat = "pdf" | "markdown";

export interface DeepGenomeViewerHandle {
  download(format: DeepGenomeDownloadFormat): Promise<void>;
}
