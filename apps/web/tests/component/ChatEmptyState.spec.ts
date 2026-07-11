import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PhyEmptyState from "@/components/shell/PhyEmptyState.vue";
import {
  STARTER_PROMPTS,
  applyStarterPrompt,
  getStarterPromptItems,
} from "@/views/chat/utils/starterPrompts";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
  "utf8"
);

describe("Chat empty state", () => {
  it("keeps the three starter prompts in the locked product order", () => {
    expect(STARTER_PROMPTS.map((prompt) => prompt.key)).toEqual([
      "gene",
      "species",
      "deepGenome",
    ]);
    expect(getStarterPromptItems((key) => `en:${key}`, false)).toEqual([
      {
        key: "gene",
        label: "en:chat.starter.geneLabel",
        description: "en:chat.starter.geneDesc",
        disabled: false,
      },
      {
        key: "species",
        label: "en:chat.starter.speciesLabel",
        description: "en:chat.starter.speciesDesc",
        disabled: false,
      },
      {
        key: "deepGenome",
        label: "en:chat.starter.deepGenomeLabel",
        description: "en:chat.starter.deepGenomeDesc",
        disabled: false,
      },
    ]);
  });

  it("reacts to locale labels and disables prompt rows while sending", () => {
    const t = (key: string) => `zh:${key}`;
    const items = getStarterPromptItems(t, true);

    expect(items.map((item) => item.label)).toEqual([
      "zh:chat.starter.geneLabel",
      "zh:chat.starter.speciesLabel",
      "zh:chat.starter.deepGenomeLabel",
    ]);
    expect(items.every((item) => item.disabled)).toBe(true);
  });

  it("keeps starter clicks as fill-only composer actions", () => {
    const setInput = vi.fn();
    applyStarterPrompt(
      STARTER_PROMPTS[2],
      (key) => `resolved:${key}`,
      setInput
    );

    expect(setInput).toHaveBeenCalledOnce();
    expect(setInput).toHaveBeenCalledWith(
      "resolved:chat.starter.deepGenomePrompt"
    );
  });

  it("provides a stable mark/title/explanation surface and tour anchors", () => {
    const wrapper = mount(PhyEmptyState, {
      props: {
        title: "Welcome",
        subtitle: "One line of explanation",
      },
      slots: {
        mark: '<span data-test="empty-mark">P</span>',
        default: '<button data-test="starter-row">Query a gene</button>',
      },
    });

    expect(wrapper.find('[data-test="empty-mark"]').exists()).toBe(true);
    expect(wrapper.find(".phy-empty-state__title").text()).toBe("Welcome");
    expect(wrapper.find(".phy-empty-state__subtitle").text()).toBe(
      "One line of explanation"
    );
    expect(wrapper.find('[data-test="starter-row"]').exists()).toBe(true);
    expect(CHAT_SOURCE).toContain('ref="tourCasesTarget"');
    expect(CHAT_SOURCE).toContain('ref="tourInputTarget"');
    const emptyStateStart = CHAT_SOURCE.indexOf(
      '<div v-if="!currentChat?.messages?.length" class="empty-chat">'
    );
    const composerStart = CHAT_SOURCE.indexOf(
      '<div ref="tourInputTarget"',
      emptyStateStart
    );
    expect(CHAT_SOURCE.slice(emptyStateStart, composerStart)).not.toContain(
      "AgentsViewImg"
    );
  });
});
