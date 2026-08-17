import { describe, expect, it } from "vitest";
import {
  adjustNumberedHeadingLevels,
  buildNestedHeadings,
} from "@/utils/scientific-markdown/toc";
import type { ScientificHeading } from "@/utils/scientific-markdown/types";

function heading(
  text: string,
  level: ScientificHeading["level"],
  id = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")
): ScientificHeading {
  return { id, level, text };
}

describe("adjustNumberedHeadingLevels", () => {
  it("demotes 1. Step-by-Step under Recommended experiments", () => {
    expect(
      adjustNumberedHeadingLevels([
        heading("Recommended experiments", 2),
        heading("1. Step-by-Step Quantitative RT-PCR Protocol", 2),
        heading("Core Applications in Plant Science", 2),
        heading("2. Step-by-Step GUS/GUS Protocol", 2),
      ])
    ).toEqual([
      heading("Recommended experiments", 2),
      {
        ...heading("1. Step-by-Step Quantitative RT-PCR Protocol", 3),
      },
      heading("Core Applications in Plant Science", 2),
      { ...heading("2. Step-by-Step GUS/GUS Protocol", 3) },
    ]);
  });
});

describe("buildNestedHeadings", () => {
  it("nests numbered protocol titles under the previous unnumbered section", () => {
    expect(
      buildNestedHeadings([
        heading("Bioinformatic Analysis", 2),
        heading("1. Expression Profile in Tissues", 3),
        heading("Recommended experiments", 2),
        heading("1. Step-by-Step Quantitative RT-PCR Protocol", 2),
        heading("2. Step-by-Step GUS/GUS Protocol", 2),
      ])
    ).toEqual([
      {
        ...heading("Bioinformatic Analysis", 2),
        children: [
          {
            ...heading("1. Expression Profile in Tissues", 3),
            children: [],
          },
        ],
      },
      {
        ...heading("Recommended experiments", 2),
        children: [
          {
            ...heading("1. Step-by-Step Quantitative RT-PCR Protocol", 3),
            children: [],
          },
          {
            ...heading("2. Step-by-Step GUS/GUS Protocol", 3),
            children: [],
          },
        ],
      },
    ]);
  });

  it("keeps an h4 under its h2 parent when the h3 level is skipped", () => {
    expect(
      buildNestedHeadings([
        heading("Digital Design", 2),
        heading("Promoter Design", 4),
        heading("Protein Design", 2),
      ])
    ).toEqual([
      {
        ...heading("Digital Design", 2),
        children: [{ ...heading("Promoter Design", 4), children: [] }],
      },
      { ...heading("Protein Design", 2), children: [] },
    ]);
  });
});
