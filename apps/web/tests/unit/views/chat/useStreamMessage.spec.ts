import { describe, expect, it } from "vitest";
import { assertReferenceOnlyFormData } from "@/views/chat/composables/useStreamMessage";

describe("useStreamMessage request body", () => {
  it("accepts scalar fields and JSON asset references", () => {
    const formData = new FormData();
    formData.append("query", "Analyze the uploaded reads");
    formData.append(
      "attachments",
      JSON.stringify([{ asset_id: "file_reads" }])
    );

    expect(() => assertReferenceOnlyFormData(formData)).not.toThrow();
    expect(
      [...formData.values()].every((value) => typeof value === "string")
    ).toBe(true);
  });

  it("rejects a browser File or Blob before fetch can send it", () => {
    const formData = new FormData();
    formData.append("query", "Do not send the file body");
    formData.append("files", new File(["private"], "reads.fastq"));

    expect(() => assertReferenceOnlyFormData(formData)).toThrow(
      "Chat attachments must be asset references"
    );
  });
});
