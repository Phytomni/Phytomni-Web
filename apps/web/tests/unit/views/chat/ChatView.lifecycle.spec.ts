import { describe, expect, it, vi } from "vitest";

vi.mock("vue-element-plus-x", () => ({
  FilesCard: { name: "FilesCard", template: "<div />" },
  MentionSender: { name: "MentionSender", template: "<div />" },
}));

import { removeDeletedChat } from "@/views/chat/ChatView.vue";
import { buildChat } from "../../../helpers/chatBuilders";

describe("ChatView lifecycle cleanup", () => {
  it("removes the deleted dialogue state and poller ownership through the ChatView deletion path", () => {
    const deleted = buildChat({ id: 1, dialogue_id: "deleted-dialogue" });
    const retained = buildChat({ id: 2, dialogue_id: "retained-dialogue" });
    const disposeDialogue = vi.fn();
    const removeChatState = vi.fn();

    const remaining = removeDeletedChat({
      chatList: [deleted, retained],
      deletedChat: deleted,
      disposeDialogue,
      removeChatState,
    });

    expect(disposeDialogue).toHaveBeenCalledWith("deleted-dialogue");
    expect(removeChatState).toHaveBeenCalledWith("deleted-dialogue");
    expect(remaining).toEqual([retained]);
  });
});
