import { describe, expect, it } from "vitest";
import {
  createTestAppContext,
  mountWithApp,
} from "../helpers/test-app-context";
import zhCN from "@/locales/langs/zh-CN";
import CitationReferenceRow from "@/components/CitationReferenceRow.vue";

describe("CitationReferenceRow", () => {
  it("localizes rejected slots but does not translate a valid canonical neutral sentence", () => {
    const context = createTestAppContext({ locale: "zh-CN" });
    const rejected = context.mount(CitationReferenceRow, {
      props: { index: 2, citation: null },
    });
    expect(rejected.text()).toContain(zhCN.chat.referenceUnavailable);
    const neutral = context.mount(CitationReferenceRow, {
      props: {
        index: 3,
        citation: {
          runs: [{ text: "Reference details unavailable." }],
          links: [],
        },
      },
    });
    expect(neutral.get(".citation-reference-row__sentence").text()).toBe(
      "Reference details unavailable."
    );
    rejected.unmount();
    neutral.unmount();
  });
  it("renders emphasis as nodes without interpreting source text", () => {
    const wrapper = mountWithApp(CitationReferenceRow, {
      props: {
        index: 2,
        citation: {
          runs: [
            { text: "<img src=x onerror=alert(1)>" },
            { text: "Plant Journal", italic: true },
            { text: "12", bold: true },
            { text: "Both", bold: true, italic: true },
          ],
          links: [{ label: "Article", href: "https://doi.org/10.1000/test" }],
        },
      },
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("em").text()).toBe("Plant Journal");
    expect(wrapper.find("strong").text()).toBe("12");
    expect(wrapper.find("strong em").text()).toBe("Both");
    expect(wrapper.find("a").attributes("href")).toBe(
      "https://doi.org/10.1000/test"
    );
    expect(wrapper.find("a").attributes("rel")).toBe("noopener noreferrer");
    expect(wrapper.text()).toContain("2.");
    expect(wrapper.text()).toContain("<img src=x onerror=alert(1)>");
    expect(
      wrapper.get(".citation-reference-row__sentence").element.textContent
    ).toBe("<img src=x onerror=alert(1)>Plant Journal12Both");
  });
  it.each([
    "javascript:alert(1)",
    "https://user:pass@example.org/",
    "//example.org/",
    "/relative",
    "mailto:a@example.org",
  ])("rejects unsafe links at the component boundary: %s", (href) => {
    const wrapper = mountWithApp(CitationReferenceRow, {
      props: {
        index: 3,
        citation: {
          runs: [{ text: "Rejected" }],
          links: [{ label: "Article", href }],
        },
      },
    });
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).toContain("Reference details unavailable.");
    expect(wrapper.text()).toContain("3.");
  });
  it("retains long safe destinations and uses fixed link labels", () => {
    const href = "https://example.org/" + "long".repeat(500);
    const wrapper = mountWithApp(CitationReferenceRow, {
      props: {
        index: 1,
        citation: {
          runs: [{ text: "Title" }],
          links: [{ label: "Article", href }],
        },
      },
    });
    expect(wrapper.get("a").attributes("href")).toBe(href);
    expect(wrapper.get("a").text()).toBe("Article");
  });
  it("shows unavailable copy for a rejected slot", () => {
    const wrapper = mountWithApp(CitationReferenceRow, {
      props: { index: 2, citation: null },
    });
    expect(wrapper.text()).toContain("Reference details unavailable.");
    expect(wrapper.find("a").exists()).toBe(false);
  });
});
