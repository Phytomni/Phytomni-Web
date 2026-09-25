import { describe, expect, it } from "vitest";
import { blobValidate, tansParams } from "@/utils";

describe("shared utility boundaries", () => {
  it("serializes scalar and nested query params while ignoring empty values", () => {
    expect(
      tansParams({
        query: "gene",
        page: 2,
        empty: "",
        nested: { sort: "name", missing: null },
      })
    ).toBe("query=gene&page=2&nested%5Bsort%5D=name&");
  });

  it("returns false for JSON blobs and true for non-JSON blobs", async () => {
    expect(await blobValidate(new Blob(['{"ok":true}']))).toBe(false);
    expect(await blobValidate(new Blob(["plain text"]))).toBe(true);
  });
});
