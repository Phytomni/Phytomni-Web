import type { ContentBlock } from "../types";

const ACTIVITY_BLOCK_TYPES = new Set(["tool", "step", "reasoning"]);

export function isActivityBlock(block: ContentBlock): boolean {
  return ACTIVITY_BLOCK_TYPES.has(block.type);
}

export function presentationBlockKey(
  block: ContentBlock,
  index: number,
): string {
  if (block.type === "agent-surface" && block.a2ui?.surface.surface_id) {
    return "surface:" + block.a2ui.surface.surface_id;
  }
  if (block.type === "markdown" && block.sourceActionId) {
    return "action:" + block.sourceActionId;
  }
  return "block:" + index;
}

export interface BlockPresentationItem {
  kind: "block";
  key: string;
  index: number;
  block: ContentBlock;
}

export interface ActivityPresentationItem {
  kind: "activity";
  key: string;
  startIndex: number;
  endIndex: number;
  blocks: ContentBlock[];
}

export type PresentationItem = BlockPresentationItem | ActivityPresentationItem;

export function buildPresentationItems(blocks: ContentBlock[]): PresentationItem[] {
  const items: PresentationItem[] = [];
  let activityStart: number | null = null;
  let activityBlocks: ContentBlock[] = [];

  const flushActivity = (endIndex: number) => {
    if (activityStart === null) return;
    items.push({
      kind: "activity",
      key: `activity-${activityStart}`,
      startIndex: activityStart,
      endIndex,
      blocks: activityBlocks,
    });
    activityStart = null;
    activityBlocks = [];
  };

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (isActivityBlock(block)) {
      if (activityStart === null) {
        activityStart = index;
        activityBlocks = [block];
      } else {
        activityBlocks.push(block);
      }
      continue;
    }

    flushActivity(index - 1);
    items.push({
      kind: "block",
      key: presentationBlockKey(block, index),
      index,
      block,
    });
  }

  if (activityStart !== null) {
    flushActivity(blocks.length - 1);
  }

  return items;
}

/** Runtime UI identity for Activity disclosure — never a protocol/server id invent. */
export function resolveMessagePresentationKey(message: {
  id?: string;
  streamPresentationKey?: string;
}): string | null {
  if (message.id != null && String(message.id).trim() !== "") {
    return String(message.id);
  }
  if (
    message.streamPresentationKey != null &&
    message.streamPresentationKey.trim() !== ""
  ) {
    return message.streamPresentationKey;
  }
  return null;
}

/** Compose Activity map key: stream:<messageKey>:activity-<startIndex>. */
export function activityDisclosureStateKey(
  messageKey: string,
  startIndex: number
): string {
  return `stream:${messageKey}:activity-${startIndex}`;
}

/** DOM id for the controlled Activity region (aria-controls target). */
export function activityRegionDomId(stateKey: string): string {
  return `chat-activity-${encodeURIComponent(stateKey)}`;
}
