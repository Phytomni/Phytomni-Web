import { describe, expect, it } from "vitest";
import { parseCompressionAlgorithms } from "../../../vite/plugins/compression";

describe("parseCompressionAlgorithms", () => {
  it.each([
    [undefined, []],
    ["", []],
    ["gzip", ["gzip"]],
    ["brotli", ["brotliCompress"]],
    ["gzip,brotli", ["gzip", "brotliCompress"]],
    ["brotli,gzip", ["gzip", "brotliCompress"]],
    [" gzip ,  brotli, gzip ", ["gzip", "brotliCompress"]],
    ["zstd,deflate", []],
  ] as const)("parses %j as %j", (value, expected) => {
    expect(parseCompressionAlgorithms(value)).toEqual(expected);
  });
});
