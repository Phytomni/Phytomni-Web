import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientTurnDraftFingerprint,
  clientTurnDraftFingerprintMatches,
  createClientTurnId,
  isDefinitePreDispatch4xx,
  type ClientTurnDraft,
} from "@/views/chat/utils/client-turn-id";

const baseDraft = (): ClientTurnDraft => ({
  parentRowId: 42,
  operation: "append",
  mode: "expert",
  selectedAgent: "KnowledgeAgent",
  query: "Find evidence",
  attachments: ["file_evidence"],
});

describe("client turn identity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates opaque IDs with the documented shape and distinct values", () => {
    let sequence = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () =>
        `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    });

    const first = createClientTurnId();
    const second = createClientTurnId();

    expect(first).toMatch(/^turn-[A-Za-z0-9-]{16,64}$/);
    expect(second).toMatch(/^turn-[A-Za-z0-9-]{16,64}$/);
    expect(first).not.toBe(second);
  });

  it("uses secure random bytes when randomUUID is unavailable", () => {
    const actualCrypto = globalThis.crypto;
    if (!actualCrypto) throw new Error("test crypto is unavailable");
    const getRandomValues = vi.fn((bytes: Uint8Array) =>
      actualCrypto.getRandomValues(bytes)
    );
    vi.stubGlobal("crypto", { randomUUID: undefined, getRandomValues });

    const id = createClientTurnId();

    expect(id).toMatch(/^turn-[A-Za-z0-9-]{16,64}$/);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it("fingerprints identical structured drafts deterministically", () => {
    expect(clientTurnDraftFingerprint(baseDraft())).toBe(
      clientTurnDraftFingerprint(baseDraft())
    );
  });

  it("writes only the current turn fields and omits dataset description", () => {
    const fingerprint = JSON.parse(clientTurnDraftFingerprint(baseDraft()));

    expect(fingerprint).toEqual({
      parentRowId: 42,
      operation: "append",
      mode: "expert",
      selectedAgent: "KnowledgeAgent",
      query: "Find evidence",
      attachments: ["file_evidence"],
    });
    expect(fingerprint).not.toHaveProperty("datasetDescription");
  });

  it.each([
    ["parent row", { parentRowId: 43 }],
    ["operation", { operation: "replace" as const }],
    ["mode", { mode: "instant" as const }],
    ["selected agent", { selectedAgent: "DataAgent" }],
    ["query", { query: "Find different evidence" }],
    [
      "attachment order",
      {
        attachments: ["file_other", ...baseDraft().attachments],
      },
    ],
    [
      "asset reference",
      {
        attachments: ["file_different"],
      },
    ],
  ])("changes when %s changes", (_label, change) => {
    expect(clientTurnDraftFingerprint({ ...baseDraft(), ...change })).not.toBe(
      clientTurnDraftFingerprint(baseDraft())
    );
  });

  it("matches a pending draft across a temporary-to-server parent rekey", () => {
    const temporary = clientTurnDraftFingerprint({
      ...baseDraft(),
      parentRowId: 0,
    });
    const canonical = clientTurnDraftFingerprint({
      ...baseDraft(),
      parentRowId: 99,
    });

    expect(temporary).not.toBe(canonical);
    expect(clientTurnDraftFingerprintMatches(temporary, canonical)).toBe(true);
  });

  it("ignores a legacy dataset description during parent rekey comparison", () => {
    const temporary = JSON.parse(
      clientTurnDraftFingerprint({ ...baseDraft(), parentRowId: 0 })
    ) as Record<string, unknown>;
    temporary.datasetDescription = "Legacy dataset context";
    const canonical = clientTurnDraftFingerprint({
      ...baseDraft(),
      parentRowId: 99,
    });

    expect(
      clientTurnDraftFingerprintMatches(JSON.stringify(temporary), canonical)
    ).toBe(true);
  });

  it("does not match a rekeyed draft after the query changes", () => {
    const temporary = clientTurnDraftFingerprint({
      ...baseDraft(),
      parentRowId: 0,
    });
    const edited = clientTurnDraftFingerprint({
      ...baseDraft(),
      parentRowId: 99,
      query: "Find different evidence",
    });

    expect(clientTurnDraftFingerprintMatches(temporary, edited)).toBe(false);
  });

  it("does not relax an arbitrary persisted parent-row change", () => {
    expect(
      clientTurnDraftFingerprintMatches(
        clientTurnDraftFingerprint(baseDraft()),
        clientTurnDraftFingerprint({ ...baseDraft(), parentRowId: 99 })
      )
    ).toBe(false);
  });

  it.each([
    [400, true, { pre_dispatch: true }],
    [422, true, { detail: { pre_dispatch: true } }],
    [409, false],
    [429, false],
    [504, false],
  ])("classifies HTTP %s as pre-dispatch=%s", (status, expected, marker) => {
    expect(
      isDefinitePreDispatch4xx({ response: { status, data: marker } })
    ).toBe(expected);
  });

  it("does not infer pre-dispatch provenance from status alone", () => {
    expect(isDefinitePreDispatch4xx({ response: { status: 422 } })).toBe(false);
  });
});
