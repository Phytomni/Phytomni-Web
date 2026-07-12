import type { ContentBlock } from "../types";

const ACTIVITY_BLOCK_TYPES = new Set(["tool", "step", "reasoning"]);

export function isActivityBlock(block: ContentBlock): boolean {
  return ACTIVITY_BLOCK_TYPES.has(block.type);
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
      key: `block-${index}`,
      index,
      block,
    });
  }

  if (activityStart !== null) {
    flushActivity(blocks.length - 1);
  }

  return items;
}
