export type AttachmentTargetReason =
  "available" | "upload_disabled" | "agent_incompatible";

export type AttachmentTargetCapability = {
  enabled?: boolean;
  attachments?: boolean;
  attachmentChannels?: readonly string[];
};

export function hasAttachmentChannel(
  capability: AttachmentTargetCapability | undefined
): boolean {
  return (
    capability?.enabled === true &&
    capability.attachments === true &&
    (capability.attachmentChannels?.length ?? 0) > 0
  );
}

export function resolveAttachmentTarget(input: {
  uploadEnabled: boolean;
  chatMode: "instant" | "expert";
  selectedAgent: string;
  authorizedTools: readonly string[];
  hasChannel: (tool: string) => boolean;
}): { available: boolean; reason: AttachmentTargetReason } {
  if (!input.uploadEnabled) {
    return { available: false, reason: "upload_disabled" };
  }

  if (input.chatMode === "instant") {
    const available =
      input.authorizedTools.includes("ChatAgent") &&
      input.hasChannel("ChatAgent");
    return {
      available,
      reason: available ? "available" : "agent_incompatible",
    };
  }

  if (input.selectedAgent) {
    const available =
      input.authorizedTools.includes(input.selectedAgent) &&
      input.hasChannel(input.selectedAgent);
    return {
      available,
      reason: available ? "available" : "agent_incompatible",
    };
  }

  const available = input.authorizedTools.some((tool) =>
    input.hasChannel(tool)
  );
  return {
    available,
    reason: available ? "available" : "agent_incompatible",
  };
}
