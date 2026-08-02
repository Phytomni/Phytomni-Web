import { describe, expect, it } from "vitest";
import {
  DatasetDescriptionError,
  MAX_DATASET_DESCRIPTION_SCALARS,
  normalizeDatasetDescription,
} from "@/views/chat/utils/dataset-description";

describe("normalizeDatasetDescription", () => {
  it("normalizes one bounded dataset description", () => {
    expect(normalizeDatasetDescription("  Rice counts  ")).toBe("Rice counts");
    expect(normalizeDatasetDescription("   ")).toBeUndefined();
  });

  it.each(["bad\u0000text", "x".repeat(MAX_DATASET_DESCRIPTION_SCALARS + 1)])(
    "rejects invalid description: %j",
    (value) => {
      expect(() => normalizeDatasetDescription(value)).toThrow(
        DatasetDescriptionError
      );
    }
  );

  it("counts Unicode scalars rather than UTF-16 code units", () => {
    expect(
      normalizeDatasetDescription("\ud83e\uddec".repeat(4000))
    ).toHaveLength(8000);
  });
});
