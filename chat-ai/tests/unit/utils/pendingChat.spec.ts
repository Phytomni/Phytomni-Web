import { describe, it, expect, vi } from "vitest";
import {
  isValidPendingRecord,
  matchesChat,
  safeParse,
  type PendingChatRecord,
  type ChatListEntry,
} from "@/utils/pendingChat";

describe("isValidPendingRecord — strict predicate", () => {
  it("returns true for valid record", () => {
    expect(
      isValidPendingRecord({
        isPending: true,
        messages: [{ role: "user", content: "hi" }],
      })
    ).toBe(true);
  });

  it.each([null, undefined, "string", 42, [], true])(
    "returns false for non-object input %s",
    (input) => {
      expect(isValidPendingRecord(input)).toBe(false);
    }
  );

  it("returns false when isPending missing", () => {
    expect(
      isValidPendingRecord({ messages: [{ role: "user", content: "hi" }] })
    ).toBe(false);
  });

  it("returns false when isPending is false", () => {
    expect(
      isValidPendingRecord({
        isPending: false,
        messages: [{ role: "user", content: "hi" }],
      })
    ).toBe(false);
  });

  it.each([
    ["undefined", { isPending: true, messages: undefined }],
    ["null", { isPending: true, messages: null }],
    ["string", { isPending: true, messages: "not-array" }],
    ["object", { isPending: true, messages: {} }],
  ])("returns false when messages is %s", (_label, input) => {
    expect(isValidPendingRecord(input)).toBe(false);
  });

  it("returns false when messages is empty array", () => {
    expect(isValidPendingRecord({ isPending: true, messages: [] })).toBe(false);
  });
});

describe("matchesChat — ID + exact title only", () => {
  const pendingBase: PendingChatRecord = {
    isPending: true,
    messages: [{ role: "user", content: "exact title from user submission" }],
    id: "stored-id-123",
  };

  it("returns true when chat.dialogue_id === pending.id", () => {
    const chat: ChatListEntry = { dialogue_id: "stored-id-123", title: "anything" };
    expect(matchesChat(chat, pendingBase, "temp-001")).toBe(true);
  });

  it("returns true when chat.dialogue_id === tempChatId", () => {
    const chat: ChatListEntry = { dialogue_id: "temp-001", title: "anything" };
    expect(matchesChat(chat, pendingBase, "temp-001")).toBe(true);
  });

  it("returns true when chat.title === first user message content", () => {
    const chat: ChatListEntry = {
      dialogue_id: "backend-real-id",
      title: "exact title from user submission",
    };
    expect(matchesChat(chat, pendingBase, "temp-001")).toBe(true);
  });

  it("returns false when chat.title is only a prefix of the pending content (no substring fuzzy)", () => {
    const chat: ChatListEntry = {
      dialogue_id: "backend-real-id",
      title: "exact title",  // shorter than pending.messages[0].content, so equality must fail
    };
    expect(matchesChat(chat, pendingBase, "temp-001")).toBe(false);
  });

  it("returns false when no ID + no title match", () => {
    const chat: ChatListEntry = {
      dialogue_id: "different",
      title: "different title",
    };
    expect(matchesChat(chat, pendingBase, "temp-001")).toBe(false);
  });

  it("returns false when pending has no user-role message", () => {
    const pending: PendingChatRecord = {
      isPending: true,
      messages: [{ role: "assistant", content: "system greeting" }],
    };
    const chat: ChatListEntry = { dialogue_id: "x", title: "system greeting" };
    expect(matchesChat(chat, pending, "temp-001")).toBe(false);
  });
});

describe("safeParse — log + null on fail", () => {
  it("parses valid JSON object", () => {
    expect(safeParse('{"isPending":true,"messages":[]}')).toEqual({
      isPending: true,
      messages: [],
    });
  });

  it.each([null, undefined, ""])(
    "returns null for empty input %s",
    (input) => {
      expect(safeParse(input)).toBeNull();
    }
  );

  it("returns null + logs on malformed JSON", () => {
    const errSpy = vi.spyOn(console, "error").mockReturnValue(undefined);
    expect(safeParse("{not-json}")).toBeNull();
    expect(errSpy).toHaveBeenCalledOnce();
  });

  it("returns null for the JSON literal 'null' without logging", () => {
    const errSpy = vi.spyOn(console, "error").mockReturnValue(undefined);
    expect(safeParse("null")).toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
  });
});
