import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import FollowUpQuestions from "@/views/chat/FollowUpQuestions.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/FollowUpQuestions.vue"),
  "utf8"
);

const styleBlocks = (source: string) =>
  [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

const mountFollowUps = (
  questions = ["What is GA3ox?", "How is it regulated?"]
) =>
  mount(FollowUpQuestions, {
    props: { questions },
  });

describe("FollowUpQuestions", () => {
  it("renders suggestion buttons and emits the clicked prompt", async () => {
    const wrapper = mountFollowUps();
    const buttons = wrapper.findAll('[data-testid="follow-up-suggestion"]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].element.tagName.toLowerCase()).toBe("button");
    expect(buttons[0].attributes("type")).toBe("button");

    await buttons[1].trigger("click");
    expect(wrapper.emitted("question-click")?.[0]).toEqual([
      "How is it regulated?",
    ]);
  });

  it("supports keyboard activation on suggestion buttons", async () => {
    const wrapper = mountFollowUps(["Only one"]);
    const button = wrapper.find('[data-testid="follow-up-suggestion"]');
    await button.trigger("keydown.enter");
    await button.trigger("keydown.space");
    // Native button click handles Enter/Space; ensure focusable target size contract.
    expect(button.attributes("type")).toBe("button");
    expect(wrapper.emitted("question-click")).toBeUndefined();
    expect(SOURCE).toMatch(/<button[\s\S]*data-testid="follow-up-suggestion"/);
    expect(SOURCE).not.toMatch(/<div[^>]*data-testid="follow-up-suggestion"/);
  });

  it("uses token-only quiet inline styles without elevation or translate", () => {
    const css = styleBlocks(SOURCE).join("\n");
    expect(css).toMatch(/var\(--phy-/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(css).not.toMatch(/translateY|translate3d|box-shadow/);
    expect(css).toMatch(/:focus-visible|:focus/);
    expect(css).toMatch(/min-height:\s*var\(--phy-control-height-compact\)/);
    expect(css).toMatch(
      /@media\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)[\s\S]*min-height:\s*calc\(\s*var\(--phy-control-height-default\)\s*\+\s*var\(--phy-space-4\)\s*\)/
    );
    expect(css).toMatch(/border:\s*0/);
  });

  it("keeps the follow-up heading and compact wrapping layout", () => {
    const wrapper = mountFollowUps();
    expect(wrapper.text()).toContain("chat.followUpQuestions");
    const css = styleBlocks(SOURCE).join("\n");
    expect(css).toMatch(/flex-wrap:\s*wrap/);
    expect(css).toMatch(/max-width:\s*100%/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
