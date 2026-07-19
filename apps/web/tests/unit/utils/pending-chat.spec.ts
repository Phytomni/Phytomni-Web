import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isValidPendingRecord,
  matchesChat,
  safeParse,
  writePendingChat,
  clearPendingChat,
  isLocalStorageChat,
  type PendingChatRecord,
  type ChatListEntry,
} from "@/utils/pending-chat";

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
    const chat: ChatListEntry = {
      dialogue_id: "stored-id-123",
      title: "anything",
    };
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
      title: "exact title", // shorter than pending.messages[0].content, so equality must fail
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

  it("ambiguous title matches yield multiple candidates for restore (caller must retain temp)", () => {
    const pending: PendingChatRecord = {
      isPending: true,
      messages: [{ role: "user", content: "shared title" }],
    };
    const chats: ChatListEntry[] = [
      { dialogue_id: "srv-a", title: "shared title" },
      { dialogue_id: "srv-b", title: "shared title" },
    ];
    const candidates = chats.filter((c) =>
      matchesChat(c, pending, "new_ambiguous")
    );
    expect(candidates).toHaveLength(2);
  });
});

describe("safeParse — log + null on fail", () => {
  it("parses valid JSON object", () => {
    expect(safeParse('{"isPending":true,"messages":[]}')).toEqual({
      isPending: true,
      messages: [],
    });
  });

  it.each([null, undefined, ""])("returns null for empty input %s", (input) => {
    expect(safeParse(input)).toBeNull();
  });

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

describe("writePendingChat", () => {
  beforeEach(() => {
    // tests/setup.ts already calls localStorage.clear() + vi.restoreAllMocks()
    // in an afterEach; redoing here is defensive against future setup changes.
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockReturnValue(undefined);
    vi.spyOn(console, "warn").mockReturnValue(undefined);
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(
      "2026-06-03T12:00:00.000Z"
    );
  });

  it("writes record with all 5 fields {id, title, date, messages, isPending: true}", () => {
    const messages = [{ role: "user", content: "hello" }];
    writePendingChat("new_123", messages);
    const raw = localStorage.getItem("pending_chat_new_123");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual({
      id: "new_123",
      title: "hello",
      date: "2026-06-03T12:00:00.000Z",
      messages: [{ role: "user", content: "hello" }],
      isPending: true,
    });
  });

  it("uses options.title verbatim when provided (no scan)", () => {
    const messages = [
      { role: "user", content: "should be ignored" },
      { role: "assistant", content: "" },
    ];
    writePendingChat("new_123", messages, { title: "explicit caller title" });
    const parsed = JSON.parse(localStorage.getItem("pending_chat_new_123")!);
    expect(parsed.title).toBe("explicit caller title");
  });

  it("falls back to last user-role message content when no title option", () => {
    const messages = [
      { role: "user", content: "first user" },
      { role: "assistant", content: "assistant reply" },
      { role: "user", content: "second user" },
    ];
    writePendingChat("new_123", messages);
    const parsed = JSON.parse(localStorage.getItem("pending_chat_new_123")!);
    expect(parsed.title).toBe("second user");
  });

  it("returns empty title when no user-role message exists (all-assistant messages)", () => {
    const messages = [
      { role: "assistant", content: "assistant only" },
      { role: "system", content: "system msg" },
    ];
    writePendingChat("new_123", messages);
    const parsed = JSON.parse(localStorage.getItem("pending_chat_new_123")!);
    expect(parsed.title).toBe("");
  });

  it("title length exactly 49 chars → no truncation, no ellipsis", () => {
    const title49 = "x".repeat(49);
    writePendingChat("new_123", [{ role: "user", content: title49 }]);
    const parsed = JSON.parse(localStorage.getItem("pending_chat_new_123")!);
    expect(parsed.title).toBe(title49);
    expect(parsed.title.length).toBe(49);
  });

  it("title length exactly 50 chars → no truncation, no ellipsis (boundary)", () => {
    const title50 = "x".repeat(50);
    writePendingChat("new_123", [{ role: "user", content: title50 }]);
    const parsed = JSON.parse(localStorage.getItem("pending_chat_new_123")!);
    expect(parsed.title).toBe(title50);
    expect(parsed.title.length).toBe(50);
  });

  it("title length exactly 51 chars → substring(0, 50) + '...'", () => {
    const title51 = "x".repeat(51);
    writePendingChat("new_123", [{ role: "user", content: title51 }]);
    const parsed = JSON.parse(localStorage.getItem("pending_chat_new_123")!);
    expect(parsed.title).toBe("x".repeat(50) + "...");
    expect(parsed.title.length).toBe(53);
  });

  it("strips attachedFiles File objects to {name, size, type} projection", () => {
    const realFile = new File(["csv,content"], "data.csv", {
      type: "text/csv",
    });
    // Note: in real browsers JSON.stringify(file) === "{}", which is the bug
    // the source code's projection guards against. happy-dom exposes enumerable
    // {type, lastModified, name} so a pre-condition equality check is brittle;
    // we exercise the projection through the round-trip assertions below.
    const messages = [
      {
        role: "user",
        content: "with attachment",
        attachedFiles: [
          {
            file: realFile,
            name: realFile.name,
            size: realFile.size,
            type: realFile.type,
          },
          // Degenerate entry: missing/wrong-typed name/size/type exercises the
          // three fallback branches in the projection ternaries (lines 149-151).
          // Without this, branch coverage on pendingChat.ts drops to ~94%.
          {
            name: 42 as unknown as string,
            size: "not-a-number" as unknown as number,
            type: undefined as unknown as string,
          },
        ],
      },
    ];
    writePendingChat("new_123", messages);
    const parsed = JSON.parse(localStorage.getItem("pending_chat_new_123")!);
    expect(parsed.messages[0].attachedFiles).toEqual([
      {
        name: "data.csv",
        size: realFile.size,
        type: "text/csv",
      },
      { name: "", size: 0, type: "" },
    ]);
    expect(parsed.messages[0].attachedFiles[0]).not.toHaveProperty("file");
  });

  it("returns void with console.warn on empty-string dialogueId", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockReturnValue(undefined);
    writePendingChat("", [{ role: "user", content: "hi" }]);
    expect(localStorage.length).toBe(0);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns void with console.warn on null dialogueId", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockReturnValue(undefined);
    writePendingChat(null as unknown as string, [
      { role: "user", content: "hi" },
    ]);
    expect(localStorage.length).toBe(0);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns void with console.warn on undefined dialogueId", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockReturnValue(undefined);
    writePendingChat(undefined as unknown as string, [
      { role: "user", content: "hi" },
    ]);
    expect(localStorage.length).toBe(0);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns void with console.warn on empty messages array", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockReturnValue(undefined);
    writePendingChat("new_123", []);
    expect(localStorage.length).toBe(0);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns void with console.warn on null messages", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockReturnValue(undefined);
    writePendingChat("new_123", null as unknown as never[]);
    expect(localStorage.length).toBe(0);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it("calls onError and console.error on JSON.stringify throw (circular ref produces TypeError)", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockReturnValue(undefined);
    const onError = vi.fn();
    // 'as never' is required: TS message-shape forbids self-referential objects,
    // and we are intentionally exercising the JSON.stringify failure path.
    const circular: Record<string, unknown> = {
      role: "user",
      content: "hi",
    };
    circular.self = circular;
    writePendingChat("new_123", [circular as never], { onError });
    expect(localStorage.length).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    // JSON.stringify on circular refs throws TypeError (subclass of Error);
    // matching expect.any(Error) keeps tolerance for env differences.
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("calls onError and console.error on setItem QuotaExceededError", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockReturnValue(undefined);
    // Spy on the live instance, not Storage.prototype: happy-dom's localStorage
    // dispatches setItem through an internal cache that bypasses prototype-level
    // spies after the first invocation, causing inter-test pollution.
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    const onError = vi.fn();
    writePendingChat("new_123", [{ role: "user", content: "hi" }], {
      onError,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(DOMException));
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("does NOT throw to caller on any error path (no onError provided)", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("anything");
    });
    expect(() =>
      writePendingChat("new_123", [{ role: "user", content: "hi" }])
    ).not.toThrow();
  });
});

describe("clearPendingChat", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("removes key when present", () => {
    localStorage.setItem(
      "pending_chat_new_123",
      JSON.stringify({
        isPending: true,
        messages: [{ role: "user", content: "hi" }],
      })
    );
    clearPendingChat("new_123");
    expect(localStorage.getItem("pending_chat_new_123")).toBeNull();
  });

  it("is no-op when key absent (idempotent)", () => {
    expect(() => clearPendingChat("new_does_not_exist")).not.toThrow();
    expect(localStorage.length).toBe(0);
  });

  it("returns void with console.warn on invalid dialogueId", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockReturnValue(undefined);
    clearPendingChat("");
    clearPendingChat(null as unknown as string);
    clearPendingChat(undefined as unknown as string);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
  });

  it("swallows removeItem throw with console.error, does NOT toast", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockReturnValue(undefined);
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("removeItem failure");
    });
    expect(() => clearPendingChat("new_123")).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("isLocalStorageChat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true for 'new_<timestamp>' and any non-empty suffix", () => {
    expect(isLocalStorageChat("new_1735819200000")).toBe(true);
    expect(isLocalStorageChat("new_0")).toBe(true);
    expect(isLocalStorageChat("new_x")).toBe(true);
  });

  it("returns false for empty / null / undefined / non-string", () => {
    expect(isLocalStorageChat("")).toBe(false);
    expect(isLocalStorageChat(null)).toBe(false);
    expect(isLocalStorageChat(undefined)).toBe(false);
    // The runtime guard rejects non-string inputs; cast via 'unknown' to satisfy
    // the parameter type while still flowing through the typeof check.
    expect(isLocalStorageChat(123 as unknown as string)).toBe(false);
  });

  it("returns false for 'new_' alone (no suffix — degenerate edge case)", () => {
    expect(isLocalStorageChat("new_")).toBe(false);
  });

  it("returns false for non-prefix strings ('123456789' / 'newchat' / whitespace-prefixed)", () => {
    expect(isLocalStorageChat("123456789")).toBe(false);
    expect(isLocalStorageChat("newchat")).toBe(false);
    expect(isLocalStorageChat(" new_123")).toBe(false);
  });
});

describe("writePendingChat mode", () => {
  it("persists the mode field into the record when provided", () => {
    writePendingChat("new_1", [{ role: "user", content: "hi" }], {
      title: "hi",
      mode: "expert",
    });
    const rec = safeParse<Record<string, unknown>>(
      localStorage.getItem("pending_chat_new_1")
    );
    expect(rec?.mode).toBe("expert");
  });
});

/** Mirrors index.vue streaming branch of getHistoryQuestionData (no blockingDialogueId). */
function streamingReconciliationOutcome(
  formattedData: ChatListEntry[],
  pendingData: PendingChatRecord,
  tempId: string
): "reconcile" | "retain-no-match" | "retain-ambiguous" {
  const candidates = formattedData.filter((chat) =>
    matchesChat(chat, pendingData, tempId)
  );
  if (candidates.length === 1) return "reconcile";
  if (candidates.length === 0) return "retain-no-match";
  return "retain-ambiguous";
}

describe("streaming history reconciliation (getHistoryQuestionData contract)", () => {
  const pending: PendingChatRecord = {
    isPending: true,
    messages: [{ role: "user", content: "unique stream title" }],
  };

  it("exactly one history candidate reconciles", () => {
    const chats: ChatListEntry[] = [
      { dialogue_id: "srv-other", title: "other" },
      { dialogue_id: "srv-exact", title: "unique stream title" },
    ];
    expect(streamingReconciliationOutcome(chats, pending, "new_stream")).toBe(
      "reconcile"
    );
  });

  it("zero candidates retain temp and pending", () => {
    const chats: ChatListEntry[] = [
      { dialogue_id: "srv-a", title: "different title" },
    ];
    expect(streamingReconciliationOutcome(chats, pending, "new_stream")).toBe(
      "retain-no-match"
    );
  });

  it("multiple candidates retain temp and pending", () => {
    const chats: ChatListEntry[] = [
      { dialogue_id: "srv-a", title: "unique stream title" },
      { dialogue_id: "srv-b", title: "unique stream title" },
    ];
    expect(streamingReconciliationOutcome(chats, pending, "new_stream")).toBe(
      "retain-ambiguous"
    );
  });
});

/** Mirrors restorePendingChats skipTempIds gate for blocking sends. */
function restorePendingChatsHarness(
  knownChats: ChatListEntry[],
  skipTempIds: ReadonlySet<string> | undefined,
  reconcile: (tempId: string, serverId: string, key: string) => void
) {
  const pendingChatKeys = Object.keys(localStorage).filter((key) =>
    key.startsWith("pending_chat_")
  );
  pendingChatKeys.forEach((key) => {
    const tempChatId = key.replace("pending_chat_", "");
    if (skipTempIds?.has(tempChatId)) return;
    const pendingChatData = safeParse<PendingChatRecord>(
      localStorage.getItem(key)
    );
    if (!isValidPendingRecord(pendingChatData)) return;
    const candidates = knownChats.filter((chat) =>
      matchesChat(chat, pendingChatData, tempChatId)
    );
    if (candidates.length === 1) {
      reconcile(tempChatId, candidates[0].dialogue_id, key);
    }
  });
}

describe("blocking restore ordering (restorePendingChats skip contract)", () => {
  afterEach(() => {
    localStorage.removeItem("pending_chat_new_block");
  });

  it("skips sending temp in restore so blocking dialogue_id wins over history title match", () => {
    const tempId = "new_block";
    localStorage.setItem(
      `pending_chat_${tempId}`,
      JSON.stringify({
        isPending: true,
        messages: [{ role: "user", content: "blocking send" }],
      })
    );
    const knownChats: ChatListEntry[] = [
      { dialogue_id: "history-wrong-id", title: "blocking send" },
    ];
    const reconciled: Array<{ tempId: string; serverId: string }> = [];

    restorePendingChatsHarness(knownChats, new Set([tempId]), (t, s) => {
      reconciled.push({ tempId: t, serverId: s });
    });

    expect(reconciled).toEqual([]);
    expect(localStorage.getItem(`pending_chat_${tempId}`)).not.toBeNull();
  });
});
