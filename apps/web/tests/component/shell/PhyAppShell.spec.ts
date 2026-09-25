import { describe, expect, it } from "vitest";
import { mountWithApp } from "../../helpers/test-app-context";
import PhyAdaptiveShell from "@/components/shell/PhyAdaptiveShell.vue";

describe("adaptive shell replacement contract", () => {
  it("renders sidebar, main, and optional artifact slots", () => {
    const wrapper = mountWithApp(PhyAdaptiveShell, {
      slots: {
        sidebar: '<aside data-test="left">L</aside>',
        main: '<main data-test="main">M</main>',
        artifact: '<aside data-test="right">R</aside>',
      },
      props: { artifactOpen: true },
    });

    expect(wrapper.find(".phy-adaptive-shell").exists()).toBe(true);
    expect(wrapper.find("[data-test=left]").exists()).toBe(true);
    expect(wrapper.find("[data-test=main]").exists()).toBe(true);
    expect(wrapper.find("[data-test=right]").exists()).toBe(true);
  });
});
