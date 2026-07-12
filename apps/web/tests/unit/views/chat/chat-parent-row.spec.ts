import { describe, it, expect } from "vitest";
import { parentRowIdForDialogue } from "@/views/chat/utils/chat-parent-row";

describe("parentRowIdForDialogue", () => {
  const chatList = [
    { id: 10, dialogue_id: "dlg-a" },
    { id: 20, dialogue_id: "dlg-b" },
  ];

  it("resolves new_* to exact 0 without reading URL/current state", () => {
    expect(parentRowIdForDialogue("new_123", chatList)).toBe(0);
    expect(parentRowIdForDialogue("new_999", [])).toBe(0);
  });

  it("resolves an existing dialogue to its own numeric parent row id", () => {
    expect(parentRowIdForDialogue("dlg-a", chatList)).toBe(10);
    expect(parentRowIdForDialogue("dlg-b", chatList)).toBe(20);
  });

  it("returns null for missing or ambiguous existing mappings (hard no-send)", () => {
    expect(parentRowIdForDialogue("missing", chatList)).toBeNull();
    expect(
      parentRowIdForDialogue("dup", [
        { id: 1, dialogue_id: "dup" },
        { id: 2, dialogue_id: "dup" },
      ])
    ).toBeNull();
    expect(parentRowIdForDialogue("", chatList)).toBeNull();
  });
});
