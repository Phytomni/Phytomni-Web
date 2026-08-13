import { describe, expect, it, vi } from "vitest";
import { mountWithApp } from "../helpers/test-app-context";

import ScientificMarkdown from "@/components/ScientificMarkdown.vue";

describe("ScientificMarkdown", () => {
  it("renders GFM tables, math, escaped table pipes, and grouped citations", async () => {
    const markdown = [
      "| Gene | Score | Note |",
      "| :--- | ---: | :---: |",
      String.raw`| Os01g | 9.5 | escaped \| pipe and [1-3] |`,
      "",
      "Inline $x^2$ and display:",
      "",
      "$$E = mc^2$$",
    ].join("\n");
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source: markdown,
        citationNamespace: "report",
        referenceCount: 3,
      },
    });

    await vi.dynamicImportSettled();
    expect(wrapper.find("table").exists()).toBe(true);
    expect(wrapper.findAll("th")[1].attributes("align")).toBe("right");
    expect(wrapper.text()).toContain("escaped | pipe");
    expect(wrapper.find(".katex").exists()).toBe(true);
    expect(wrapper.get(".scientific-citation").text()).toBe("[1-3]");
  });

  it("keeps raw HTML inert, including glued attributes, unsafe URLs, and Mermaid fences", async () => {
    const source = [
      "<script>alert(1)</script><table><tr><td>raw</td></tr></table>",
      "<img src=x onerror=alert(1)>",
      '<a href="x"onmouseover="alert(1)">glued</a>',
      "[bad](javascript:alert(1)) ![bad](data:text/html,nope)",
      '<sup onclick="alert(1)">1</sup>',
      "```mermaid",
      "graph TD; A-->B",
      "```",
    ].join("\n\n");
    const wrapper = mountWithApp(ScientificMarkdown, { props: { source } });

    await vi.dynamicImportSettled();
    expect(wrapper.find("script").exists()).toBe(false);
    expect(
      wrapper
        .findAll("img")
        .every((image) => !image.attributes("src")?.startsWith("data:"))
    ).toBe(true);
    expect(wrapper.find("table").exists()).toBe(false);
    expect(wrapper.findAll("[onerror], [onmouseover], [onclick]")).toHaveLength(
      0
    );
    expect(
      wrapper
        .findAll("a")
        .every(
          (anchor) => !anchor.attributes("href")?.startsWith("javascript:")
        )
    ).toBe(true);
    expect(wrapper.text()).toContain("<script>alert(1)</script>");
    expect(wrapper.text()).toContain('<sup onclick="alert(1)">1</sup>');
    expect(wrapper.text()).toContain("graph TD; A-->B");
  });

  it("emits grouped citation activation only for valid project citations", async () => {
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source: "Evidence [1-3]",
        citationNamespace: "report",
        referenceCount: 3,
      },
    });

    await vi.dynamicImportSettled();
    await wrapper.get(".scientific-citation__link").trigger("click");
    expect(wrapper.emitted("citation-activate")).toEqual([
      [{ namespace: "report", indices: [1, 2, 3] }],
    ]);
  });
});
