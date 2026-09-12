import { describe, expect, it } from "vitest";
import {
  decodeTableDataInput,
  humanizeTableHeaderLabel,
} from "@/views/chat/utils/format";

describe("humanizeTableHeaderLabel", () => {
  it.each([
    ["query_gene_id_t1", "Query gene ID"],
    ["query_protein_t1", "Query protein"],
    ["interact_gene_id_t1", "Interact gene ID"],
    ["interact_protein_t1", "Interact protein"],
    ["query_gene_id_t12", "Query gene ID"],
    ["gene_id", "Gene ID"],
    ["cds_length", "CDS length"],
    ["fpkm", "FPKM"],
    ["ids", "IDs"],
    ["Gene", "Gene"],
    ["Trait", "Trait"],
    ["Query Gene ID", "Query Gene ID"],
    ["CDS length (bp)", "CDS length (bp)"],
    ["  query_gene_id_t1  ", "Query gene ID"],
    ["", ""],
    ["_t1", "_t1"],
  ])("maps %j to %j", (input, expected) => {
    expect(humanizeTableHeaderLabel(input)).toBe(expected);
  });
});

describe("decodeTableDataInput title", () => {
  it("keeps a trimmed Bot title", () => {
    expect(
      decodeTableDataInput({
        title: "  Proteins interacting with Os04g0269100  ",
        headers: ["gene"],
        rows: [["g1"]],
      })
    ).toEqual({
      title: "Proteins interacting with Os04g0269100",
      headers: ["gene"],
      rows: [["g1"]],
    });
  });

  it("omits blank or non-string titles", () => {
    expect(
      decodeTableDataInput({ title: "  ", headers: ["gene"], rows: [] })
    ).toEqual({ headers: ["gene"], rows: [] });
    expect(
      decodeTableDataInput({ title: 12, headers: ["gene"], rows: [] })
    ).toEqual({ headers: ["gene"], rows: [] });
  });
});
