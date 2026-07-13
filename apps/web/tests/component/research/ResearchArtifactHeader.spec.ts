import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ResearchArtifactHeader from "@/components/research/ResearchArtifactHeader.vue";

describe("ResearchArtifactHeader", () => {
  const longTitle =
    "A comparative functional and structural assessment of Os01g0177400 across cultivated rice accessions";

  it("renders title, metadata, and status with a long-title truncation hook", () => {
    const wrapper = mount(ResearchArtifactHeader, {
      props: {
        title: longTitle,
        metadata: ["Deep Genome Agent", "Oryza sativa", "Os01g0177400"],
        status: "Complete",
        backLabel: "Back to conversation",
        closeLabel: "Close artifact",
        actionLabel: "Artifact actions",
      },
    });
    const title = wrapper.get(".research-artifact-header__title");

    expect(title.text()).toBe(longTitle);
    expect(title.attributes("title")).toBe(longTitle);
    expect(title.attributes("data-truncate")).toBe("title");
    expect(
      wrapper.findAll(".research-artifact-header__metadata-item")
    ).toHaveLength(3);
    expect(wrapper.get(".research-artifact-header__status").text()).toBe(
      "Complete"
    );
  });

  it("keeps slotted and built-in actions inside the overflow owner", () => {
    const wrapper = mount(ResearchArtifactHeader, {
      props: {
        title: "Report",
        backLabel: "Back",
        closeLabel: "Close",
        actionLabel: "Actions",
      },
      slots: {
        actions: '<button data-test="download">Export PDF</button>',
      },
    });
    const actions = wrapper.get(".research-artifact-header__actions");

    expect(actions.attributes("data-horizontal-scroll")).toBe("actions");
    expect(actions.find("[data-test=download]").exists()).toBe(true);
    expect(actions.find("[data-test=artifact-action]").exists()).toBe(true);
    expect(actions.find("[data-test=artifact-close]").exists()).toBe(true);
  });

  it("emits back, action, and close from labelled controls", async () => {
    const wrapper = mount(ResearchArtifactHeader, {
      props: {
        title: "Report",
        backLabel: "Back to conversation",
        closeLabel: "Close artifact",
        actionLabel: "Artifact actions",
      },
    });

    await wrapper.get("[data-test=artifact-back]").trigger("click");
    await wrapper.get("[data-test=artifact-action]").trigger("click");
    await wrapper.get("[data-test=artifact-close]").trigger("click");

    expect(wrapper.emitted("back")).toHaveLength(1);
    expect(wrapper.emitted("action")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(
      wrapper.get("[data-test=artifact-back]").attributes("aria-label")
    ).toBe("Back to conversation");
    expect(
      wrapper.get("[data-test=artifact-close]").attributes("aria-label")
    ).toBe("Close artifact");
  });

  it("marks Back as mobile-only and Close as desktop-only", () => {
    const wrapper = mount(ResearchArtifactHeader, {
      props: {
        title: "Report",
        backLabel: "Back",
        closeLabel: "Close",
        actionLabel: "Actions",
      },
    });

    expect(wrapper.get("[data-test=artifact-back]").classes()).toContain(
      "research-artifact-header__back--mobile-only"
    );
    expect(wrapper.get("[data-test=artifact-close]").classes()).toContain(
      "research-artifact-header__close--desktop-only"
    );
  });

  it("does not let the action overflow owner shrink below its controls", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/components/research/ResearchArtifactHeader.vue"
      ),
      "utf8"
    );

    expect(source).toMatch(
      /\.research-artifact-header__actions\s*{[^}]*flex:\s*0 0 auto;/s
    );
  });

  it("wraps artifact actions below the compact desktop breakpoint", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/components/research/ResearchArtifactHeader.vue"
      ),
      "utf8"
    );

    expect(source).toMatch(
      /\.research-artifact-header__actions\s*{[^}]*flex-wrap:\s*wrap;/s
    );
    expect(source).toMatch(
      /@media\s*\(max-width:\s*899px\)[\s\S]*?\.research-artifact-header__actions\s*{[^}]*max-width:\s*none;/s
    );
  });

  it("styles controls supplied through the actions slot", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/components/research/ResearchArtifactHeader.vue"
      ),
      "utf8"
    );

    expect(source).toMatch(
      /:slotted\(\.research-artifact-header__control\)\s*{/s
    );
  });
});
