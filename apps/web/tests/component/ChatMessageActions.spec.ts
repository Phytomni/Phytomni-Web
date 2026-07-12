import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ChatMessageActions from "@/views/chat/components/ChatMessageActions.vue";

const ACTIONS_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/views/chat/components/ChatMessageActions.vue"
  ),
  "utf8"
);
const INDEX_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
  "utf8"
);

const styleBlocks = (source: string) =>
  [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

const mountActions = (props: Record<string, unknown> = {}) =>
  mount(ChatMessageActions, {
    props: {
      role: "assistant",
      copied: false,
      canRefresh: true,
      refreshBusy: false,
      canReact: true,
      reactionActive: 0,
      likeLabel: "Like",
      dislikeLabel: "Dislike",
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

  it("shows copied state instead of the copy button", () => {
    const wrapper = mountActions({ copied: true });
    expect(wrapper.find('[data-testid="action-copy"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="action-copied"]').exists()).toBe(true);
  });

  it("marks refresh as busy", () => {
    const wrapper = mountActions({ refreshBusy: true });
    const refresh = wrapper.find('[data-testid="action-refresh"]');
    expect(refresh.classes()).toContain("is-loading");
  });

  it("marks active reaction state", () => {
    const liked = mountActions({ reactionActive: 1, likeLabel: "Undo like" });
    expect(liked.find('[data-testid="action-like"]').classes()).toContain(
      "active"
    );
    expect(liked.find('[data-testid="action-like"]').attributes("aria-label")).toBe(
      "Undo like"
    );

    const disliked = mountActions({
      reactionActive: 2,
      dislikeLabel: "Undo dislike",
    });
    expect(disliked.find('[data-testid="action-dislike"]').classes()).toContain(
      "active"
    );
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

    await wrapper.findComponent({ name: "ElDropdown" }).vm.$emit(
      "command",
      "obs://upload"
    );
    expect(wrapper.emitted("direct-download")?.[0]).toEqual(["obs://upload"]);
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

  it("index wiring uses message-footer, actions slot, and chat log surface", () => {
    expect(INDEX_SOURCE).not.toMatch(/message-fotter/);
    expect(INDEX_SOURCE).toMatch(/message-footer|ChatMessageActions/);
    expect(INDEX_SOURCE).toMatch(/#actions|name=["']actions["']/);
    expect(INDEX_SOURCE).toMatch(
      /<MarkdownViewer[\s\S]*surface=["']chat["']/
    );
  });
});
