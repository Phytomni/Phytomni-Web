import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AgentDemoShell from "@/components/demo/AgentDemoShell.vue";
import { mountWithApp } from "../../helpers/test-app-context";

const SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/demo/AgentDemoShell.vue"),
  "utf8"
);

describe("AgentDemoShell", () => {
  it("owns the scroll surface, renders slots, and associates static status with the result", async () => {
    const wrapper = mountWithApp(AgentDemoShell, {
      props: { title: "Knowledge Agent", subtitle: "A static report" },
      slots: {
        question: '<p data-test="question">Example question</p>',
        result: '<article data-test="result">Example result</article>',
        footer: '<p data-test="footer">Research note</p>',
      },
    });

    expect(wrapper.attributes("data-scroll-root")).toBe("agent-demo");
    expect(wrapper.get("[data-test=agent-demo-static-badge]").text()).toContain(
      "Static example"
    );
    expect(wrapper.get("[data-test=agent-demo-question]").text()).toContain(
      "Example question"
    );
    expect(wrapper.get("[data-test=agent-demo-result]").text()).toContain(
      "Example result"
    );
    expect(
      wrapper
        .get("[data-test=agent-demo-result]")
        .attributes("aria-describedby")
    ).toBe(wrapper.get("[data-test=agent-demo-static-badge]").attributes("id"));
    expect(wrapper.get("[data-test=footer]").exists()).toBe(true);

    await wrapper.get("[data-test=agent-demo-back]").trigger("click");
    expect(wrapper.emitted("back")).toHaveLength(1);
  });

  it("keeps demo labels responsive without a compatibility footer or translucent surface", () => {
    expect(SOURCE.indexOf("height: 100vh;")).toBeGreaterThanOrEqual(0);
    expect(SOURCE.indexOf("height: 100dvh;")).toBeGreaterThan(
      SOURCE.indexOf("height: 100vh;")
    );
    expect(SOURCE).toContain("@media (max-width: 899px)");
    expect(SOURCE).toContain("@media (max-width: 599px)");
    expect(SOURCE).not.toContain(".app-footer");
    expect(SOURCE).not.toContain("color-mix(");
    expect(SOURCE).toContain("overflow-x: hidden");
  });

  it("uses the shared fluid document and artifact measures without desktop lower bounds", () => {
    expect(SOURCE).toContain("container-type: inline-size;");
    expect(SOURCE).toContain(
      "width: min(100%, var(--phy-layout-document-max-width));"
    );
    expect(SOURCE).toContain(
      "width: min(100%, var(--phy-layout-artifact-wide-max-width));"
    );
    expect(SOURCE).not.toContain("width: min(100%, clamp(1160px");
    expect(SOURCE).not.toContain("width: min(100%, clamp(1040px");
  });
});
