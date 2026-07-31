import { describe, expect, it } from "vitest";
import { decodeChatHistory, decodeQueryData } from "@/api/types";

describe("chat attachment reference decoding", () => {
  it("accepts ordered asset references on query data and history rows", () => {
    const attachments = [
      { asset_id: "file_reads" },
      { asset_id: "file_annotations" },
    ];
    expect(decodeQueryData({ id: 1, attachments }).attachments).toEqual(
      attachments
    );
    expect(
      decodeChatHistory([{ id: "1", attachments }])[0]?.attachments
    ).toEqual(attachments);
  });

  it.each([
    [{ asset_id: "not-file" }],
    [{ asset_id: "file_reads" }, { asset_id: "file_reads" }],
    [{ asset_id: "file_reads", name: "reads.fastq" }],
    Array.from({ length: 11 }, (_, index) => ({ asset_id: `file_${index}` })),
  ])("rejects malformed or unbounded attachment references", (attachments) => {
    expect(() => decodeQueryData({ id: 1, attachments })).toThrow(
      "Invalid chat response"
    );
  });

  it("keeps the field absent for legacy rows", () => {
    const result = decodeQueryData({ id: 2, query: "legacy" });
    expect("attachments" in result).toBe(false);
  });
});
