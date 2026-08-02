import type { AssetAttachmentRef } from "@/api/types";
import type { ResumableUploadItem, UploadPurpose } from "../upload/types";

const ASSET_ID_PATTERN = /^file_[A-Za-z0-9_-]{1,123}$/u;

export interface ChatAttachmentDisplay extends AssetAttachmentRef {
  name: string;
  size: number;
  type: string;
  purpose: UploadPurpose;
}

export type AttachmentMetadata = Pick<
  ChatAttachmentDisplay,
  "name" | "size" | "type" | "purpose"
>;

export function isSafeAssetId(value: unknown): value is string {
  return typeof value === "string" && ASSET_ID_PATTERN.test(value);
}

/**
 * Convert the current queue into display metadata only after every active
 * item has completed. Aborted items are no longer part of the next turn.
 */
export function completedUploadDisplays(
  items: readonly ResumableUploadItem[]
): ChatAttachmentDisplay[] | null {
  const active = items.filter((item) => item.status !== "aborted");
  if (active.some((item) => item.status !== "completed")) return null;

  const seen = new Set<string>();
  const output: ChatAttachmentDisplay[] = [];
  for (const item of active) {
    if (!isSafeAssetId(item.assetId) || seen.has(item.assetId)) return null;
    seen.add(item.assetId);
    output.push({
      asset_id: item.assetId,
      name: item.name,
      size: item.size,
      type: item.type,
      purpose: item.purpose,
    });
  }
  return output;
}

export function toAssetAttachmentRefs(
  items: readonly (ResumableUploadItem | ChatAttachmentDisplay)[]
): AssetAttachmentRef[] {
  return items
    .filter(
      (item) =>
        (!("status" in item) || item.status === "completed") &&
        isSafeAssetId("assetId" in item ? item.assetId : item.asset_id)
    )
    .map((item) => ({
      asset_id: ("assetId" in item ? item.assetId : item.asset_id) as string,
    }));
}

export function displayAttachmentRefs(
  refs: readonly AssetAttachmentRef[],
  metadata: ReadonlyMap<string, AttachmentMetadata>,
  fallbackName: string
): ChatAttachmentDisplay[] {
  return refs.map(({ asset_id }) => {
    const details = metadata.get(asset_id);
    return {
      asset_id,
      name: details?.name || fallbackName,
      size: details?.size ?? 0,
      type: details?.type ?? "",
      purpose: details?.purpose ?? "document",
    };
  });
}
