import { describe, expect, it } from "vitest";
import {
  hasAttachmentChannel,
  resolveAttachmentTarget,
  resolveUploadTargetTool,
} from "@/views/chat/utils/attachment-target";

const BOT_FAITHFUL_CHANNELS: Record<string, boolean> = {
  ChatAgent: true,
  KnowledgeAgent: true,
  DataAgent: false,
  ReviewAgent: true,
  BriefGeneAgent: false,
  AnalystAgent: true,
  DeepGenomeAgent: false,
  InSilicoResearchAgent: true,
  DigitalDesignAgent: true,
  GeneNetworkAgent: true,
};

const ALL_TOOLS = Object.keys(BOT_FAITHFUL_CHANNELS);

function resolve(partial: {
  uploadEnabled?: boolean;
  chatMode?: "instant" | "expert";
  selectedAgent?: string;
  authorizedTools?: readonly string[];
  channels?: Record<string, boolean>;
}) {
  const channels = partial.channels ?? BOT_FAITHFUL_CHANNELS;
  return resolveAttachmentTarget({
    uploadEnabled: partial.uploadEnabled ?? true,
    chatMode: partial.chatMode ?? "expert",
    selectedAgent: partial.selectedAgent ?? "",
    authorizedTools: partial.authorizedTools ?? ALL_TOOLS,
    hasChannel: (tool) => channels[tool] === true,
  });
}

describe("resolveAttachmentTarget", () => {
  it("treats a missing upload contract as globally unavailable", () => {
    expect(
      resolve({ uploadEnabled: false, selectedAgent: "ChatAgent" })
    ).toEqual({
      available: false,
      reason: "upload_disabled",
    });
  });

  it.each([
    ["ChatAgent", true],
    ["KnowledgeAgent", true],
    ["ReviewAgent", true],
    ["AnalystAgent", true],
    ["InSilicoResearchAgent", true],
    ["DigitalDesignAgent", true],
    ["GeneNetworkAgent", true],
    ["DataAgent", false],
    ["BriefGeneAgent", false],
    ["DeepGenomeAgent", false],
  ] as const)("matches the Bot attachment matrix for %s", (tool, available) => {
    expect(
      resolve({
        selectedAgent: tool,
      })
    ).toEqual({
      available,
      reason: available ? "available" : "agent_incompatible",
    });
  });

  it("keeps Instant mode on Chat even when another Agent is selected", () => {
    expect(
      resolve({
        chatMode: "instant",
        selectedAgent: "DataAgent",
      })
    ).toEqual({ available: true, reason: "available" });
  });

  it("disables Instant mode when Chat is not authorized", () => {
    expect(
      resolve({
        chatMode: "instant",
        authorizedTools: ["DataAgent"],
      })
    ).toEqual({ available: false, reason: "agent_incompatible" });
  });

  it("allows autonomous Expert when any authorized Agent accepts files", () => {
    expect(
      resolve({
        selectedAgent: "",
        authorizedTools: ["DataAgent", "KnowledgeAgent"],
      })
    ).toEqual({ available: true, reason: "available" });
  });

  it("blocks autonomous Expert when no authorized Agent accepts files", () => {
    expect(
      resolve({
        selectedAgent: "",
        authorizedTools: ["DataAgent", "BriefGeneAgent", "DeepGenomeAgent"],
      })
    ).toEqual({ available: false, reason: "agent_incompatible" });
  });
});

describe("resolveUploadTargetTool", () => {
  it("pins Instant uploads to ChatAgent", () => {
    expect(
      resolveUploadTargetTool({
        chatMode: "instant",
        selectedAgent: "KnowledgeAgent",
      })
    ).toBe("ChatAgent");
  });

  it("uses the Expert selection and leaves Auto blank", () => {
    expect(
      resolveUploadTargetTool({
        chatMode: "expert",
        selectedAgent: "KnowledgeAgent",
      })
    ).toBe("KnowledgeAgent");
    expect(
      resolveUploadTargetTool({
        chatMode: "expert",
        selectedAgent: "  ",
      })
    ).toBe("");
  });
});

describe("hasAttachmentChannel", () => {
  it("requires enabled attachments plus at least one channel", () => {
    expect(
      hasAttachmentChannel({
        enabled: true,
        attachments: true,
        attachmentChannels: ["document"],
      })
    ).toBe(true);
    expect(
      hasAttachmentChannel({
        enabled: true,
        attachments: true,
        attachmentChannels: [],
      })
    ).toBe(false);
    expect(
      hasAttachmentChannel({
        enabled: false,
        attachments: true,
        attachmentChannels: ["document"],
      })
    ).toBe(false);
  });
});
