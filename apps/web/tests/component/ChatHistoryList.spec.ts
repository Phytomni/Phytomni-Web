import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import ChatHistoryList, {
  type ChatHistoryGroup,
} from "@/views/chat/components/ChatHistoryList.vue";
import type { Chat } from "@/views/chat/types";

const HISTORY_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatHistoryList.vue"),
  "utf8"
);

const makeChat = (overrides: Partial<Chat> = {}): Chat => ({
  id: 1,
  dialogue_id: "dialogue-1",
  title: "Plant genome search",
  date: "2026-07-11T08:00:00.000Z",
  isFavorite: false,
  ...overrides,
});

const groups: ChatHistoryGroup[] = [
  {
    key: "today",
    labelKey: "chat.timeGroup.today",
    items: [makeChat()],
  },
  {
    key: "yesterday",
    labelKey: "chat.timeGroup.yesterday",
    items: [],
  },
  {
    key: "week",
    labelKey: "chat.timeGroup.week",
    items: [
      makeChat({ id: 2, dialogue_id: "dialogue-2", title: "Trait analysis" }),
    ],
  },
  {
    key: "older",
    labelKey: "chat.timeGroup.older",
    items: [],
  },
];

const mountList = (overrides: Record<string, unknown> = {}) =>
  mount(ChatHistoryList, {
    props: {
      groups,
      currentChatId: "dialogue-2",
      expandedGroups: {
        today: true,
        yesterday: true,
        week: true,
        older: true,
      },
      ...overrides,
    },
    global: {
      stubs: {
        ElTooltip: {
          template: '<div class="tooltip-stub"><slot /></div>',
        },
        ElDropdown: {
          name: "ElDropdown",
          emits: ["command"],
          template: `<div class="dropdown-stub" @click="$emit('command', 'delete')"><slot /><slot name="dropdown" /></div>`,
        },
        ElDropdownMenu: {
          template: '<div class="dropdown-menu-stub"><slot /></div>',
        },
        ElDropdownItem: {
          props: ["command"],
          template: '<button class="dropdown-item-stub"><slot /></button>',
        },
        ElIcon: {
          template: '<span class="icon-stub"><slot /></span>',
        },
      },
    },
  });

describe("ChatHistoryList", () => {
  it("keeps compact group and conversation geometry token-owned", () => {
    expect(HISTORY_SOURCE).toContain("font-size: 12px;");
    expect(HISTORY_SOURCE).toContain(
      "min-height: var(--phy-control-height-default);"
    );
    expect(HISTORY_SOURCE).toContain(
      "background-color: var(--phy-color-primary-soft);"
    );
    expect(HISTORY_SOURCE).not.toContain("min-height: 400px;");
    expect(HISTORY_SOURCE).not.toContain("#909399");
    expect(HISTORY_SOURCE).not.toContain("#f56c6c");
  });

  it("renders each non-empty group once and skips empty groups", () => {
    const wrapper = mountList();

    expect(wrapper.findAll(".time-group")).toHaveLength(2);
    expect(wrapper.findAll(".time-label").map((label) => label.text())).toEqual(
      ["chat.timeGroup.today", "chat.timeGroup.week"]
    );
    expect(wrapper.findAll(".chat-item")).toHaveLength(2);
  });

  it("marks the active item and emits select and group toggle events", async () => {
    const wrapper = mountList();

    expect(wrapper.findAll(".chat-item")[1].classes()).toContain("active");

    await wrapper.findAll(".chat-select")[0].trigger("click");
    await wrapper.find(".time-label").trigger("click");

    expect(wrapper.emitted("select")).toEqual([["dialogue-1"]]);
    expect(wrapper.emitted("toggle-group")).toEqual([["today"]]);
    expect(wrapper.findAll(".chat-select")[1].attributes("aria-current")).toBe(
      "page"
    );
    expect(wrapper.find(".time-label").attributes("aria-expanded")).toBe(
      "true"
    );
  });

  it("emits chat actions without selecting the chat item", async () => {
    const wrapper = mountList();
    const dropdown = wrapper.findComponent({ name: "ElDropdown" });

    await dropdown.trigger("click");

    expect(wrapper.emitted("action")).toEqual([["delete", groups[0].items[0]]]);
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("keys pending conversations by dialogue and hides server-only actions", () => {
    const pendingGroups: ChatHistoryGroup[] = [
      {
        key: "today",
        labelKey: "chat.timeGroup.today",
        items: [
          makeChat({
            id: 0,
            dialogue_id: "pending-a",
            title: "Pending A",
            isPending: true,
          }),
          makeChat({
            id: 0,
            dialogue_id: "pending-b",
            title: "Pending B",
            isPending: true,
          }),
          makeChat({
            id: 9,
            dialogue_id: "persisted",
            title: "Persisted",
          }),
        ],
      },
    ];

    const wrapper = mountList({ groups: pendingGroups });

    expect(wrapper.findAll(".chat-item")).toHaveLength(3);
    expect(wrapper.findAll(".chat-actions")).toHaveLength(1);
    expect(HISTORY_SOURCE).toContain(':key="chat.dialogue_id"');
  });
});
