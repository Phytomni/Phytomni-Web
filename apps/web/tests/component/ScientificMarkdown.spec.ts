import { defineComponent, h, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWithApp } from "../helpers/test-app-context";

import ScientificMarkdown from "@/components/ScientificMarkdown.vue";

afterEach(() => vi.unstubAllGlobals());

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
        surface: "artifact",
        citationNamespace: "report",
        referenceCount: 3,
      },
    });

    await vi.dynamicImportSettled();
    expect(wrapper.find("table").exists()).toBe(true);
    expect(wrapper.findAll("th")[1].attributes("align")).toBe("right");
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(["phy-markdown", "phy-markdown--artifact"])
    );
    expect(wrapper.text()).toContain("escaped | pipe");
    expect(wrapper.find(".katex").exists()).toBe(true);
    expect(wrapper.find(".katex [style]").exists()).toBe(true);
    expect(wrapper.get(".scientific-citation").text()).toBe("[1-3]");
  });

  it("keeps raw HTML inert, including glued attributes, unsafe URLs, and Mermaid fences", async () => {
    const source = [
      "<script>alert(1)</script><table><tr><td>raw</td></tr></table>",
      "<img src=x onerror=alert(1)>",
      '<a href="x"onmouseover="alert(1)">glued</a>',
      "[bad](javascript:alert(1)) ![bad](data:text/html,nope)",
      '<span style="color: red">raw styled span</span>',
      "<sup>1</sup>",
      "<sup>[1-4]</sup>",
      '<sup onclick="alert(1)">1</sup>',
      '<sup class="not-a-citation">1</sup>',
      "<sup><em>1</em></sup>",
      "<sup>1</sub>",
      "```mermaid",
      "graph TD; A-->B",
      "```",
    ].join("\n\n");
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: { source, citationNamespace: "report", referenceCount: 4 },
    });

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
    expect(wrapper.text()).toContain(
      '<span style="color: red">raw styled span</span>'
    );
    expect(
      wrapper.findAll(".scientific-citation").map((citation) => citation.text())
    ).toEqual(["1", "[1-4]"]);
    expect(wrapper.text()).toContain('<sup class="not-a-citation">1</sup>');
    expect(wrapper.text()).toContain("<sup><em>1</em></sup>");
    expect(wrapper.text()).toContain("<sup>1</sub>");
    expect(wrapper.text()).toContain("graph TD; A-->B");
    expect(wrapper.find("code.language-mermaid").exists()).toBe(true);
    expect(wrapper.find(".mermaid").exists()).toBe(false);
    expect(wrapper.findAll("svg")).toHaveLength(0);
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

  it("falls back to the full escaped source and emits only a render category after a child error", async () => {
    const source = [
      '<span data-secret="do-not-emit">Whole report</span>',
      "",
      "```text",
      "child error",
      "```",
    ].join("\n");
    const ThrowingRenderer = defineComponent({
      name: "XMarkdown",
      setup() {
        throw new Error("forced child render failure");
      },
      render: () => h("div"),
    });
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: { source },
      slots: {
        "block-code": () => h(ThrowingRenderer),
      },
    });

    await nextTick();
    expect(wrapper.get(".scientific-markdown__fallback").text()).toBe(source);
    expect(wrapper.emitted("render-error")).toEqual([["render"]]);
    expect(JSON.stringify(wrapper.emitted("render-error"))).not.toContain(
      source
    );
  });

  it("coalesces streaming revisions into the latest animation frame and cancels frames on unmount", async () => {
    let nextFrame = 1;
    const frames = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const frame = nextFrame++;
      frames.set(frame, callback);
      return frame;
    });
    const cancelFrame = vi.fn((frame: number) => frames.delete(frame));
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    const wrapper = mountWithApp(ScientificMarkdown, {
      attachTo: document.body,
      props: { source: "initial", streaming: false },
    });
    await wrapper.setProps({ streaming: true, source: "first" });
    await wrapper.setProps({ source: "latest" });

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(cancelFrame).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("initial");

    frames.get(1)?.(0);
    await nextTick();
    expect(wrapper.text()).toContain("latest");

    await wrapper.setProps({ source: "after-unmount" });
    expect(requestFrame).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect(cancelFrame).toHaveBeenCalledWith(2);
    frames.get(2)?.(0);
    await nextTick();
    expect(document.body.textContent).not.toContain("after-unmount");
  });
});
