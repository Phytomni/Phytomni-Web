import { describe, expect, it } from "vitest";
import {
  artifactChrome,
  artifactChromeFromMessage,
  artifactDownloadFormat,
  artifactHasDownloadableFiles,
} from "@/views/chat/utils/artifact-chrome";
import {
  copyCloseArtifactMenuItems,
  copyDownloadCloseArtifactMenuItems,
  resetArtifactMenuItems,
} from "@/components/research/artifact-overflow";
import type { ChatMessage } from "@/views/chat/types";

describe("artifactChrome", () => {
  it("defaults to the chat surface when none is given", () => {
    expect(
      artifactChrome({
        tool: "ReviewAgent",
        referenceCount: 1,
        hasAttachments: false,
        runComplete: true,
      }).exportFormats
    ).toEqual(["PDF", "Markdown", "Word"]);
  });

  it("hides log and attachments for cited agents that never produce them", () => {
    expect(
      artifactChrome({
        tool: "ReviewAgent",
        referenceCount: 2,
        hasAttachments: false,
        runComplete: true,
        surface: "chat",
      })
    ).toEqual({
      tabs: ["content", "evidence"],
      exportFormats: ["PDF", "Markdown", "Word"],
    });

    expect(
      artifactChrome({
        tool: "KnowledgeAgent",
        referenceCount: 0,
        hasAttachments: true,
        runComplete: true,
        surface: "chat",
      })
    ).toEqual({
      tabs: ["content"],
      exportFormats: ["PDF", "Markdown", "Word"],
    });
  });

  it("keeps References while a cited run is still preparing", () => {
    expect(
      artifactChrome({
        tool: "ReviewAgent",
        referenceCount: 0,
        hasAttachments: false,
        runComplete: false,
        surface: "chat",
      }).tabs
    ).toEqual(["content", "evidence"]);
  });

  it("shows Deep Genome references only when the result has them", () => {
    expect(
      artifactChrome({
        tool: "DeepGenomeAgent",
        referenceCount: 1,
        hasAttachments: false,
        runComplete: true,
        surface: "chat",
      })
    ).toEqual({
      tabs: ["content", "evidence"],
      exportFormats: ["PDF", "Markdown", "Word"],
    });
  });

  it("keeps the Research execution log and attachments only when files exist", () => {
    expect(
      artifactChrome({
        tool: "InSilicoResearchAgent",
        referenceCount: 0,
        hasAttachments: true,
        runComplete: true,
        surface: "chat",
      }).tabs
    ).toEqual(["content", "activity", "downloads"]);

    expect(
      artifactChrome({
        tool: "InSilicoResearchAgent",
        referenceCount: 0,
        hasAttachments: false,
        runComplete: true,
        surface: "chat",
      }).tabs
    ).toEqual(["content", "activity"]);
  });

  it("does not repeat Analyst execution log in the chat drawer", () => {
    expect(
      artifactChrome({
        tool: "AnalystAgent",
        referenceCount: 0,
        hasAttachments: false,
        runComplete: true,
        surface: "chat",
      }).tabs
    ).toEqual(["content"]);
  });

  it("shows References when a non-cited result actually has them", () => {
    expect(
      artifactChrome({
        tool: "GeneNetworkAgent",
        referenceCount: 2,
        hasAttachments: false,
        runComplete: true,
        surface: "chat",
      }).tabs
    ).toEqual(["content", "evidence"]);
  });

  it("keeps standalone Activity and hides empty Evidence", () => {
    expect(
      artifactChrome({
        tool: "AnalystAgent",
        referenceCount: 0,
        hasAttachments: true,
        runComplete: false,
        surface: "standalone",
      })
    ).toEqual({
      tabs: ["content", "activity", "downloads"],
      exportFormats: [],
    });
  });

  it("collapses an in-flight Research workspace to Activity", () => {
    expect(
      artifactChrome({
        tool: "InSilicoResearchAgent",
        referenceCount: 0,
        hasAttachments: true,
        runComplete: false,
        activityOnly: true,
        surface: "standalone",
      })
    ).toEqual({
      tabs: ["activity"],
      exportFormats: [],
    });
  });

  it("exports only client PDF and Markdown on Deep Genome demo surfaces", () => {
    expect(
      artifactChrome({
        tool: "DeepGenomeAgent",
        referenceCount: 3,
        hasAttachments: false,
        runComplete: true,
        surface: "client",
      }).exportFormats
    ).toEqual(["PDF", "Markdown"]);
    expect(
      artifactChrome({
        tool: "ReviewAgent",
        referenceCount: 1,
        hasAttachments: false,
        runComplete: true,
        surface: "client",
      }).exportFormats
    ).toEqual(["PDF", "Markdown", "Word"]);
  });
});

describe("artifactChromeFromMessage", () => {
  const review: ChatMessage = {
    role: "assistant",
    id: "11",
    tool_name: "ReviewAgent",
    status: "SUCCEEDED",
    content: "report",
    doc_list: [{ title: "Source" }],
  };

  it("maps a completed Review row to View, References, and format export", () => {
    expect(artifactChromeFromMessage(review)).toEqual({
      tabs: ["content", "evidence"],
      exportFormats: ["PDF", "Markdown", "Word"],
    });
  });

  it("drops empty Knowledge references after the run completes", () => {
    expect(
      artifactChromeFromMessage({
        ...review,
        tool_name: "KnowledgeAgent",
        doc_list: [],
      }).tabs
    ).toEqual(["content"]);
  });

  it("hides format export while the cited row is still streaming", () => {
    expect(
      artifactChromeFromMessage({
        ...review,
        streaming: true,
        status: "RUNNING",
      }).exportFormats
    ).toEqual([]);
  });

  it("treats a cited row with no status as complete", () => {
    expect(
      artifactChromeFromMessage({
        role: "assistant",
        content: "report",
        tool_name: "ReviewAgent",
        doc_list: [],
      }).tabs
    ).toEqual(["content"]);
  });

  it("treats conversation files and a pending archive as attachments", () => {
    expect(
      artifactChromeFromMessage({
        role: "assistant",
        id: "21",
        tool_name: "AnalystAgent",
        status: "SUCCEEDED",
        content: "analysis",
        artifacts: [{ id: "a1", name: "plot.png", kind: "image" }],
      }).tabs
    ).toEqual(["content", "downloads"]);
  });
});

describe("artifactHasDownloadableFiles", () => {
  it("hides the archive tab when Bot reports no user deliverables", () => {
    expect(
      artifactHasDownloadableFiles({
        resultArchiveV1: true,
        delivery: { status: "failed", error_code: "no_user_deliverables" },
      })
    ).toBe(false);
  });

  it("keeps a pending result archive visible", () => {
    expect(
      artifactHasDownloadableFiles({
        resultArchiveV1: true,
        delivery: { status: "pending", error_code: null },
      })
    ).toBe(true);
  });

  it("treats Bot artifact paths as downloadable files", () => {
    expect(
      artifactHasDownloadableFiles({
        botArtifacts: [{ paths: ["/obs/bucket/run/report.txt"] }],
      })
    ).toBe(true);
    expect(
      artifactHasDownloadableFiles({
        delivery: { status: "ready", error_code: null },
      })
    ).toBe(true);
  });
});

describe("artifact download commands", () => {
  it("parses overflow download formats and ignores other commands", () => {
    expect(artifactDownloadFormat("download:PDF")).toBe("PDF");
    expect(artifactDownloadFormat("download:Word")).toBe("Word");
    expect(artifactDownloadFormat("download:")).toBeNull();
    expect(artifactDownloadFormat("copy")).toBeNull();
  });

  it("places Download formats between Copy and Close", () => {
    const items = copyDownloadCloseArtifactMenuItems(
      (key) => key,
      ["PDF", "Word", "Markdown"]
    );
    expect(items.map((item) => item.id)).toEqual(["copy", "download", "close"]);
    expect(items[1]?.children?.map((child) => child.id)).toEqual([
      "download:PDF",
      "download:Word",
      "download:Markdown",
    ]);
    expect(items[2]?.divided).toBe(true);
  });

  it("omits Download when the agent has no export formats", () => {
    expect(
      copyDownloadCloseArtifactMenuItems((key) => key, []).map(
        (item) => item.id
      )
    ).toEqual(["copy", "close"]);
    expect(
      copyCloseArtifactMenuItems((key) => key).map((item) => item.id)
    ).toEqual(["copy", "close"]);
    expect(resetArtifactMenuItems("Start another run")).toEqual([
      { id: "reset", label: "Start another run" },
    ]);
  });
});
