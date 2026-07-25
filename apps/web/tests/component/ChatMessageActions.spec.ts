import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ChatMessageActions from "@/views/chat/components/ChatMessageActions.vue";
import { messageActionCapabilities } from "@/views/chat/utils/message-action-capabilities";
import type { ChatMessage } from "@/views/chat/types";
import { mountWithApp } from "../helpers/test-app-context";

const ACTIONS_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageActions.vue"),
  "utf8"
);
const INDEX_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/ChatView.vue"),
  "utf8"
);
const CONTENT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageContent.vue"),
  "utf8"
);

const styleBlocks = (source: string) =>
  [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

const mountActions = (props: Record<string, unknown> = {}) =>
  mountWithApp(ChatMessageActions, {
    props: {
      role: "assistant",
      copied: false,
      canRefresh: true,
      refreshBusy: false,
      canReact: true,
      reactionActive: 0,
      generatedFormats: [],
      directDownloads: [],
      ...props,
    },
    global: {
      stubs: {
        ElTooltip: {
          name: "ElTooltip",
          template: "<span><slot /></span>",
          props: ["content", "effect", "placement"],
        },
        ElDropdown: {
          name: "ElDropdown",
          template:
            '<div class="el-dropdown-stub" @click="$emit(\'command\', \'PDF\')"><slot /><slot name="dropdown" /></div>',
          props: ["placement", "trigger"],
          emits: ["command"],
        },
        ElDropdownMenu: {
          name: "ElDropdownMenu",
          template: "<div><slot /></div>",
        },
        ElDropdownItem: {
          name: "ElDropdownItem",
          template:
            '<div class="el-dropdown-item-stub" @click="$emit(\'click\')"><slot /></div>',
          props: ["command"],
        },
        ElIcon: { name: "ElIcon", template: "<i><slot /></i>" },
        CopyDocument: true,
        SuccessFilled: true,
        Refresh: true,
        Download: true,
        CircleCheck: true,
        CircleClose: true,
        CircleCloseFilled: true,
      },
    },
  });

const mountActionsForMessage = (
  message: ChatMessage,
  props: Record<string, unknown> = {}
) =>
  mountActions({
    role: message.role === "user" ? "user" : "assistant",
    ...messageActionCapabilities(message),
    ...props,
  });

describe("ChatMessageActions", () => {
  it("shows user copy availability without refresh or reactions", () => {
    const wrapper = mountActions({
      role: "user",
      canRefresh: false,
      canReact: false,
    });
    expect(wrapper.find('[data-testid="chat-message-actions"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-testid="action-copy"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="action-refresh"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="action-like"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="action-dislike"]').exists()).toBe(false);
  });

  it("shows assistant copy, refresh, and reactions", () => {
    const wrapper = mountActions({ role: "assistant" });
    expect(wrapper.find('[data-testid="action-copy"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="action-refresh"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="action-like"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="action-dislike"]').exists()).toBe(true);
  });

  it("keeps a single copy button mounted through the copied state", async () => {
    const wrapper = mountActions({ copied: false });
    const copy = wrapper.find('[data-testid="action-copy"]');
    expect(copy.exists()).toBe(true);
    expect(wrapper.find('[data-testid="action-copied"]').exists()).toBe(false);

    await wrapper.setProps({ copied: true });
    expect(wrapper.findAll('[data-testid="action-copy"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="action-copy"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="action-copied"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-testid="action-copy"]').attributes("aria-live")
    ).toBe("polite");
  });

  it("disables refresh while busy and keeps aria-busy", () => {
    const wrapper = mountActions({ refreshBusy: true });
    const refresh = wrapper.find('[data-testid="action-refresh"]');
    expect(refresh.classes()).toContain("is-loading");
    expect(refresh.attributes("aria-busy")).toBe("true");
    expect(refresh.attributes("disabled")).toBeDefined();
  });

  it("derives like/dislike labels from reactionActive without label props", () => {
    expect(ACTIONS_SOURCE).not.toMatch(/likeLabel\?:/);
    expect(ACTIONS_SOURCE).not.toMatch(/dislikeLabel\?:/);
    expect(INDEX_SOURCE).not.toMatch(/:like-label=/);
    expect(INDEX_SOURCE).not.toMatch(/:dislike-label=/);
    expect(INDEX_SOURCE).not.toMatch(/getReactionTooltip/);

    const idle = mountActions({ reactionActive: 0 });
    expect(
      idle.find('[data-testid="action-like"]').attributes("aria-label")
    ).toBe("Like");
    expect(
      idle.find('[data-testid="action-dislike"]').attributes("aria-label")
    ).toBe("Dislike");
    expect(
      idle.find('[data-testid="action-like"]').attributes("aria-pressed")
    ).toBe("false");

    const liked = mountActions({ reactionActive: 1 });
    expect(liked.find('[data-testid="action-like"]').classes()).toContain(
      "active"
    );
    expect(
      liked.find('[data-testid="action-like"]').attributes("aria-label")
    ).toBe("Undo like");
    expect(
      liked.find('[data-testid="action-like"]').attributes("aria-pressed")
    ).toBe("true");

    const disliked = mountActions({ reactionActive: 2 });
    expect(disliked.find('[data-testid="action-dislike"]').classes()).toContain(
      "active"
    );
    expect(
      disliked.find('[data-testid="action-dislike"]').attributes("aria-label")
    ).toBe("Undo dislike");
    expect(
      disliked.find('[data-testid="action-dislike"]').attributes("aria-pressed")
    ).toBe("true");
  });

  it("renders direct downloads as one downloads control", async () => {
    const wrapper = mountActions({
      directDownloads: [
        { kind: "upload", path: "obs://upload" },
        { kind: "file", path: "obs://file" },
      ],
    });
    expect(
      wrapper.find('[data-testid="action-direct-downloads"]').exists()
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="direct-download-obs://upload"]').exists()
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="direct-download-obs://file"]').exists()
    ).toBe(true);

    await wrapper
      .findComponent({ name: "ElDropdown" })
      .vm.$emit("command", "obs://upload");
    expect(wrapper.emitted("direct-download")?.[0]).toEqual(["obs://upload"]);
  });

  it("disambiguates twin download aria-labels when both menus are present", () => {
    const wrapper = mountActions({
      directDownloads: [{ kind: "file", path: "obs://file" }],
      generatedFormats: ["PDF", "Markdown"],
    });
    const direct = wrapper.find('[data-testid="action-direct-downloads"]');
    const generated = wrapper.find('[data-testid="action-generated-download"]');
    expect(direct.attributes("aria-label")).toBe("Download attachments");
    expect(generated.attributes("aria-label")).toBe("Download as format");
    expect(direct.attributes("aria-label")).not.toBe(
      generated.attributes("aria-label")
    );
    expect(direct.attributes("title")).toBe(direct.attributes("aria-label"));
    expect(generated.attributes("title")).toBe(
      generated.attributes("aria-label")
    );
  });

  it("renders generated format choices and emits download-format", async () => {
    const wrapper = mountActions({
      generatedFormats: ["PDF", "Markdown", "Xlsx"],
    });
    expect(
      wrapper.find('[data-testid="action-generated-download"]').exists()
    ).toBe(true);
    expect(wrapper.text()).toContain("PDF");
    expect(wrapper.text()).toContain("Markdown");
    expect(wrapper.text()).toContain("Xlsx");
    expect(wrapper.text()).not.toContain("Word");

    await wrapper.find(".el-dropdown-stub").trigger("click");
    expect(wrapper.emitted("download-format")?.[0]).toEqual(["PDF"]);
  });

  it("preserves Word formats for non-DataAgent menus", () => {
    const wrapper = mountActions({
      generatedFormats: ["PDF", "Markdown", "Word"],
    });
    expect(wrapper.text()).toContain("Word");
    expect(wrapper.text()).not.toContain("Xlsx");
  });

  it("emits copy, refresh, and reaction events", async () => {
    const wrapper = mountActions();
    await wrapper.find('[data-testid="action-copy"]').trigger("click");
    await wrapper.find('[data-testid="action-refresh"]').trigger("click");
    await wrapper.find('[data-testid="action-like"]').trigger("click");
    await wrapper.find('[data-testid="action-dislike"]').trigger("click");

    expect(wrapper.emitted("copy")).toHaveLength(1);
    expect(wrapper.emitted("refresh")).toHaveLength(1);
    expect(wrapper.emitted("reaction")?.[0]).toEqual([1]);
    expect(wrapper.emitted("reaction")?.[1]).toEqual([2]);
  });

  it("keeps the touch-visible class and focus-within discoverability contract", () => {
    const wrapper = mountActions();
    const root = wrapper.find('[data-testid="chat-message-actions"]');
    expect(root.classes()).toContain("message-footer");
    expect(root.classes()).toContain("is-touch-visible");

    const css = styleBlocks(ACTIONS_SOURCE).join("\n");
    expect(css).toMatch(/@media\s*\(\s*hover:\s*hover\s*\)/);
    expect(css).toMatch(/:focus-within/);
    expect(css).not.toMatch(/message-fotter/);
  });

  it("uses compact desktop controls and restores touch-sized targets", () => {
    const css = styleBlocks(ACTIONS_SOURCE).join("\n");
    expect(css).toMatch(
      /\.message-footer-item\s*\{[^}]*min-width:\s*var\(--phy-control-height-default\)/
    );
    expect(css).toMatch(
      /@media\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)[\s\S]*min-width:\s*calc\(var\(--phy-control-height-default\)\s*\+\s*var\(--phy-space-4\)\)/
    );
    expect(css).toMatch(/color:\s*var\(--phy-color-text-muted\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("keeps selected reactions and disabled refresh visually explicit", () => {
    const css = styleBlocks(ACTIONS_SOURCE).join("\n");
    expect(css).toMatch(
      /&\.reaction-btn\.active\s*\{[^}]*background:\s*var\(--phy-color-primary-soft\)/
    );
    expect(css).toMatch(
      /&:disabled\s*\{[^}]*color:\s*var\(--phy-color-text-disabled\)/
    );
  });

  it("index wiring uses message-footer, actions slot, and chat log surface", () => {
    expect(INDEX_SOURCE).not.toMatch(/message-fotter/);
    expect(INDEX_SOURCE).toMatch(/message-footer|ChatMessageActions/);
    expect(INDEX_SOURCE).toMatch(/#actions|name=["']actions["']/);
    // Reply Markdown surface lives in ChatMessageContent (not index).
    expect(CONTENT_SOURCE).toMatch(
      /<MarkdownViewer[\s\S]*surface=["']chat["']/
    );
    // Analyst execution log folds into #activity via ChatActivity + ChatAnalystLog.
    expect(INDEX_SOURCE).toMatch(/#activity|name=["']activity["']/);
    expect(INDEX_SOURCE).toMatch(/ChatActivity/);
    expect(INDEX_SOURCE).toMatch(/ChatAnalystLog/);
    expect(INDEX_SOURCE).toMatch(/setLogExpanded/);
    expect(INDEX_SOURCE).toMatch(/deriveAnalystLogRowId\(message\)/);
  });

  it.each([
    {
      label: "stopped",
      message: {
        role: "assistant",
        content: "Generation stopped",
        instantMessage: true,
      } as ChatMessage,
    },
    {
      label: "error",
      message: {
        role: "assistant",
        content: "Message failed",
        status: "",
        instantMessage: true,
      } as ChatMessage,
    },
  ])(
    "local $label rows keep copy but hide server-backed actions",
    ({ message }) => {
      const localRow = mountActionsForMessage(message);

      expect(localRow.find('[data-testid="action-copy"]').exists()).toBe(true);
      expect(localRow.find('[data-testid="action-refresh"]').exists()).toBe(
        false
      );
      expect(localRow.find('[data-testid="action-like"]').exists()).toBe(false);
      expect(localRow.find('[data-testid="action-dislike"]').exists()).toBe(
        false
      );
      expect(
        localRow.find('[data-testid="action-generated-download"]').exists()
      ).toBe(false);
    }
  );

  it("keeps an id-less streaming row capability-gated while preserving a real direct download", () => {
    const streamingRow = mountActionsForMessage(
      {
        role: "assistant",
        content: "partial response",
        streaming: true,
        tool_name: "DataAgent",
      },
      {
        directDownloads: [{ kind: "file", path: "obs://result" }],
      }
    );

    expect(streamingRow.find('[data-testid="action-copy"]').exists()).toBe(
      true
    );
    expect(streamingRow.find('[data-testid="action-refresh"]').exists()).toBe(
      false
    );
    expect(streamingRow.find('[data-testid="action-like"]').exists()).toBe(
      false
    );
    expect(
      streamingRow.find('[data-testid="action-generated-download"]').exists()
    ).toBe(false);
    expect(
      streamingRow.find('[data-testid="action-direct-downloads"]').exists()
    ).toBe(true);
  });

  it("opens all supported actions only for a persisted non-streaming assistant row", () => {
    const persistedRow = mountActionsForMessage({
      role: "assistant",
      content: "complete response",
      id: "42",
      streaming: false,
      tool_name: "DataAgent",
    });

    expect(persistedRow.find('[data-testid="action-copy"]').exists()).toBe(
      true
    );
    expect(persistedRow.find('[data-testid="action-refresh"]').exists()).toBe(
      true
    );
    expect(persistedRow.find('[data-testid="action-like"]').exists()).toBe(
      true
    );
    expect(persistedRow.find('[data-testid="action-dislike"]').exists()).toBe(
      true
    );
    expect(
      persistedRow.find('[data-testid="action-generated-download"]').exists()
    ).toBe(true);
  });

  it("wires refresh, reactions, and generated formats through one capability helper", () => {
    expect(INDEX_SOURCE).toMatch(/messageActionCapabilities/);
    expect(INDEX_SOURCE).toMatch(
      /:can-refresh="\s*messageActionCapabilities\(message\)\.canRefresh\s*"/
    );
    expect(INDEX_SOURCE).toMatch(
      /:can-react="\s*messageActionCapabilities\(message\)\.canReact\s*"/
    );
    expect(INDEX_SOURCE).toMatch(
      /messageActionCapabilities\(message\)\.generatedFormats/
    );
    expect(INDEX_SOURCE).not.toMatch(/getGeneratedFormats/);
    expect(INDEX_SOURCE).not.toMatch(/downloadWhiteList/);

    // Analyst log mounts only when deriveAnalystLogRowId(message) is a valid
    // positive-decimal id; its existing boundary remains independent.
    expect(INDEX_SOURCE).toMatch(/if \(message\.id\) handleReaction/);
    expect(INDEX_SOURCE).toMatch(/if \(message\.id\)\s*getFileDownUrl/);
    expect(INDEX_SOURCE).toMatch(
      /AnalystAgent[\s\S]*!!deriveAnalystLogRowId\(message\)/
    );
    expect(INDEX_SOURCE).not.toMatch(/toggleLogView/);
  });
});
