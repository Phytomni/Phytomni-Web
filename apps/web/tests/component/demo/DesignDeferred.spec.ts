import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const routerBack = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: routerBack }),
}));

const AgentDemoShellStub = {
  props: ["title", "subtitle"],
  emits: ["back"],
  template: `
    <div
      data-test="demo-shell"
      :data-title="title"
      :data-subtitle="subtitle"
    >
      <span data-test="agent-demo-static-badge">Static example</span>
      <button data-test="shell-back" @click="$emit('back')">Back</button>
      <slot name="question" />
      <slot name="result" />
      <slot name="footer" />
    </div>
  `,
};

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

import Design from "@/views/design/DesignView.vue";

function mountDesign() {
  return mount(Design, {
    global: {
      plugins: [i18n],
      stubs: { AgentDemoShell: AgentDemoShellStub },
    },
  });
}

describe("Design deferred demonstration", () => {
  it("renders an honest unavailable state through the static demo shell", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const wrapper = mountDesign();

    expect(wrapper.get("[data-test=demo-shell]").attributes("data-title")).toBe(
      "Design Agent"
    );
    expect(wrapper.get("[data-test=agent-demo-static-badge]").text()).toContain(
      "Static example"
    );
    expect(
      wrapper.get("[data-test=design-unavailable]").attributes("role")
    ).toBe("status");
    expect(
      wrapper.get("[data-test=design-unavailable-title]").text().toLowerCase()
    ).toContain("not yet available");
    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(wrapper.findAll("input, textarea, [role=progressbar]")).toHaveLength(
      0
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("keeps Back as the only action and removes the legacy placeholder chrome", async () => {
    routerBack.mockReset();
    const wrapper = mountDesign();

    await wrapper.get("[data-test=shell-back]").trigger("click");

    expect(routerBack).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll(".design-container")).toHaveLength(0);
    expect(
      wrapper.findAll(
        ".chat-header, .chat-messages, .message-avatar, .message-content"
      )
    ).toHaveLength(0);
  });
});
