export type UploadStatus =
  | "queued"
  | "creating"
  | "uploading"
  | "paused"
  | "failed"
  | "completing"
  | "completed"
  | "aborted"
  | "expired";

/** Serializable, non-secret state for one browser-to-Bot asset. */
export interface ResumableUploadItem {
  localId: string;
  file: File | null;
  assetId: string | null;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  status: UploadStatus;
  partSize: number;
  partCount: number;
  receivedParts: number[];
  loadedBytes: number;
  /** Most recent progress interval; UI displays the smoothed speed below. */
  instantaneousSpeedBytesPerSecond?: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  retryCount: number;
  errorCode: string | null;
}
