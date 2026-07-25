import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mountWithApp } from "../../helpers/test-app-context";
import ResearchArtifactPreview from "@/components/research/ResearchArtifactPreview.vue";

describe("ResearchArtifactPreview", () => {
  const longTitle =
    "A long scientific title that remains available when its visible line is truncated";

  it("renders a neutral launch card with title, kind, and summary", () => {
    const wrapper = mountWithApp(ResearchArtifactPreview, {
      props: {
        title: longTitle,
        kind: "Research report",
        summary: "A structured report with findings and supporting evidence.",
        openLabel: "Open report",
      },
    });

    expect(wrapper.get(".research-artifact-preview__kind").text()).toBe(
      "Research report"
    );
    expect(wrapper.get(".research-artifact-preview__title").text()).toBe(
      longTitle
    );
    expect(
      wrapper.get(".research-artifact-preview__title").attributes("title")
    ).toBe(longTitle);
    expect(
      wrapper
        .get(".research-artifact-preview__title")
        .attributes("data-truncate")
    ).toBe("title");
    expect(wrapper.get(".research-artifact-preview__summary").text()).toContain(
      "supporting evidence"
    );
    expect(wrapper.classes()).toContain("research-artifact-preview--neutral");
    expect(wrapper.find(".phy-bubble-assistant").exists()).toBe(false);
  });

  it("emits open from its labelled action", async () => {
    const wrapper = mountWithApp(ResearchArtifactPreview, {
      props: {
        title: "Os01g0177400 analysis",
        kind: "Research report",
        summary: "Structured findings are available.",
        openLabel: "Open report",
      },
    });

    await wrapper.get("[data-test=artifact-open]").trigger("click");

    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(
      wrapper.get("[data-test=artifact-open]").attributes("aria-label")
    ).toBe("Open report");
  });

  it("formats an opted-in product kind but leaves the generic default plain", () => {
    const props = {
      title: "Finished",
      kind: "In Silico Research Agent",
      summary: "Research report",
      openLabel: "Open report",
    };
    const plain = mountWithApp(ResearchArtifactPreview, { props });
    expect(plain.find("em").exists()).toBe(false);

    const formatted = mountWithApp(ResearchArtifactPreview, {
      props: { ...props, formatScientificAgentName: true },
    });
    expect(formatted.get(".research-artifact-preview__kind").text()).toBe(
      "In Silico Research Agent"
    );
    expect(formatted.get(".research-artifact-preview__kind em").text()).toBe(
      "In Silico"
    );
  });

  it("uses only neutral semantic tokens for the nested surface", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/components/research/ResearchArtifactPreview.vue"
      ),
      "utf8"
    );

    expect(source).toContain("background: var(--phy-color-bg-elevated)");
    expect(source).toContain(
      "border: 1px solid var(--phy-color-border-subtle)"
    );
    expect(source).not.toContain("--phy-color-bubble-assistant");
    expect(source).not.toMatch(/#[\da-f]{3,8}\b/i);
  });

  it("keeps the preview body shrinkable while the open action stays reachable", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/components/research/ResearchArtifactPreview.vue"
      ),
      "utf8"
    );

    expect(source).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(source).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(source).toContain("max-width: 100%;");
  });
});
