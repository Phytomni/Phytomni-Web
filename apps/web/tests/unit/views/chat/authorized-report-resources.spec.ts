import { describe, expect, it } from "vitest";
import type { ConversationArtifactLink } from "@/api/types";
import {
  authorizedResourcesFromConversationArtifacts,
  scientificKindForConversationArtifact,
} from "@/views/chat/utils/authorized-report-resources";

const artifacts: ConversationArtifactLink[] = [
  { id: "img-1", name: "figure.png", kind: "image", media_type: "image/png" },
  { id: "cif-1", name: "fold.cif", kind: "cif", media_type: "chemical/x-cif" },
  { id: "md-1", name: "notes.md", kind: "report", media_type: "text/markdown" },
  {
    id: "zip-1",
    name: "bundle.zip",
    kind: "archive",
    media_type: "application/zip",
  },
];

describe("authorized report resources", () => {
  it.each([
    ["image", "image"],
    ["cif", "cif"],
    ["report", "markdown"],
    ["table", "attachment"],
    ["archive", "attachment"],
    ["file", "attachment"],
  ] as const)("maps conversation kind %s to %s", (kind, scientificKind) => {
    expect(scientificKindForConversationArtifact(kind)).toBe(scientificKind);
  });

  it("authorizes only artifacts named in the report and signs display URLs at render", () => {
    const source = [
      "# Report",
      "",
      "![plot](figure.png)",
      "See [structure](fold.cif) and [notes](notes.md).",
    ].join("\n");
    const displayUrls = new Map([
      ["img-1", "/api/v1/downloads/relay-file?token=image-token"],
      ["cif-1", "/api/v1/downloads/relay-file?token=cif-token"],
    ]);

    expect(
      authorizedResourcesFromConversationArtifacts(
        source,
        artifacts,
        displayUrls
      )
    ).toEqual([
      {
        id: "img-1",
        name: "figure.png",
        kind: "image",
        markdownHref: "figure.png",
        displayUrl: "/api/v1/downloads/relay-file?token=image-token",
      },
      {
        id: "cif-1",
        name: "fold.cif",
        kind: "cif",
        markdownHref: "fold.cif",
        displayUrl: "/api/v1/downloads/relay-file?token=cif-token",
      },
      {
        id: "md-1",
        name: "notes.md",
        kind: "markdown",
        markdownHref: "notes.md",
      },
    ]);
  });

  it("keeps unsigned image and CIF resources inert", () => {
    const resources = authorizedResourcesFromConversationArtifacts(
      "![plot](figure.png) and [fold](fold.cif)",
      artifacts
    );
    expect(resources).toHaveLength(2);
    expect(resources[0]).not.toHaveProperty("displayUrl");
    expect(resources[1]).not.toHaveProperty("displayUrl");
  });

  it("does not attach a display URL to markdown or archive artifacts", () => {
    const resources = authorizedResourcesFromConversationArtifacts(
      "[notes](notes.md)",
      artifacts,
      new Map([
        ["md-1", "/api/v1/downloads/relay-file?token=should-not-attach"],
      ])
    );
    expect(resources).toEqual([
      {
        id: "md-1",
        name: "notes.md",
        kind: "markdown",
        markdownHref: "notes.md",
      },
    ]);
  });
});
