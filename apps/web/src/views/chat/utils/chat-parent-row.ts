import { isLocalStorageChat } from "@/utils/pending-chat";
import type { Chat } from "../types";

/**
 * Resolve the server parent-row `id` for a dialogue without reading URL/current
 * selection. `new_*` → exact 0; an existing dialogue → its unique numeric row
 * id; missing or ambiguous mapping → null (caller must hard no-send).
 */
export function parentRowIdForDialogue(
  dialogueId: string,
  chatList: ReadonlyArray<Pick<Chat, "id" | "dialogue_id">>
): number | null {
  if (!dialogueId) return null;
  if (isLocalStorageChat(dialogueId)) return 0;

  const matches = chatList.filter((c) => c.dialogue_id === dialogueId);
  if (matches.length !== 1) return null;

  const rowId = matches[0].id;
  if (typeof rowId !== "number" || !Number.isFinite(rowId)) return null;
  return rowId;
}
