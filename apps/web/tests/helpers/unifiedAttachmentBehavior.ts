import { expect } from "vitest";

/**
 * The attachment surfaces are deliberately tested through the same semantic
 * contract.  A surface adapter is responsible only for driving its own UI;
 * assertions stay here so a selector change cannot leave one surface with a
 * weaker lifecycle contract than the others.
 */
export const UNIFIED_ATTACHMENT_BEHAVIOR_TABLE = [
  { id: "attach", label: "one attach action" },
  { id: "typing", label: "typing during upload" },
  {
    id: "blocking",
    label: "send blocked for every retained noncompleted state",
  },
  { id: "duplicate", label: "duplicate focus and announcement" },
  {
    id: "lifecycle",
    label: "pause, resume, retry, reselect, cancel, and remove",
  },
  { id: "submission", label: "successful clear and failed preservation" },
  {
    id: "incompatible",
    label: "zero-channel rejection and incompatible preservation",
  },
] as const;

export type UnifiedAttachmentBehaviorId =
  (typeof UNIFIED_ATTACHMENT_BEHAVIOR_TABLE)[number]["id"];

export type RetainedUploadStatus =
  "queued" | "creating" | "uploading" | "paused" | "failed" | "expired";

export interface UnifiedAttachmentSurface {
  reset(): Promise<void> | void;
  attach(): Promise<{
    attachActionCount: number;
    queuedFileCount: number;
    purposeFree: boolean;
    purposeControls: number;
    descriptionControls: number;
  }>;
  typingDuringUpload(): Promise<{ query: string; editorDisabled: boolean }>;
  sendBlocked(
    statuses: readonly RetainedUploadStatus[]
  ): Promise<Readonly<Record<RetainedUploadStatus, boolean>>>;
  duplicate(): Promise<{ announcement: string; focused: boolean }>;
  lifecycle(): Promise<{
    pause: boolean;
    resume: boolean;
    retry: boolean;
    reselect: boolean;
    cancel: boolean;
    remove: boolean;
  }>;
  submission(): Promise<{
    successfulClear: boolean;
    failedPreservation: boolean;
  }>;
  incompatible(): Promise<{
    zeroChannelRejected: boolean;
    incompatiblePreserved: boolean;
  }>;
}

export async function assertUnifiedAttachmentBehaviorTable(
  surface: UnifiedAttachmentSurface
): Promise<void> {
  for (const behavior of UNIFIED_ATTACHMENT_BEHAVIOR_TABLE) {
    await surface.reset();

    switch (behavior.id) {
      case "attach": {
        const result = await surface.attach();
        expect(result.attachActionCount, behavior.label).toBe(1);
        expect(result.queuedFileCount, behavior.label).toBe(1);
        expect(result.purposeFree, behavior.label).toBe(true);
        expect(result.purposeControls, behavior.label).toBe(0);
        expect(result.descriptionControls, behavior.label).toBe(0);
        break;
      }
      case "typing": {
        const result = await surface.typingDuringUpload();
        expect(result.query, behavior.label).toBe("draft while uploading");
        expect(result.editorDisabled, behavior.label).toBe(false);
        break;
      }
      case "blocking": {
        const result = await surface.sendBlocked([
          "queued",
          "creating",
          "uploading",
          "paused",
          "failed",
          "expired",
        ]);
        for (const status of [
          "queued",
          "creating",
          "uploading",
          "paused",
          "failed",
          "expired",
        ] as const) {
          expect(result[status], `${behavior.label}: ${status}`).toBe(true);
        }
        break;
      }
      case "duplicate": {
        const result = await surface.duplicate();
        expect(result.announcement, behavior.label).toContain(
          "Already attached: counts.csv"
        );
        expect(result.focused, behavior.label).toBe(true);
        break;
      }
      case "lifecycle": {
        const result = await surface.lifecycle();
        for (const action of [
          "pause",
          "resume",
          "retry",
          "reselect",
          "cancel",
          "remove",
        ] as const) {
          expect(result[action], `${behavior.label}: ${action}`).toBe(true);
        }
        break;
      }
      case "submission": {
        const result = await surface.submission();
        expect(result.successfulClear, behavior.label).toBe(true);
        expect(result.failedPreservation, behavior.label).toBe(true);
        break;
      }
      case "incompatible": {
        const result = await surface.incompatible();
        expect(result.zeroChannelRejected, behavior.label).toBe(true);
        expect(result.incompatiblePreserved, behavior.label).toBe(true);
        break;
      }
    }
  }
}
