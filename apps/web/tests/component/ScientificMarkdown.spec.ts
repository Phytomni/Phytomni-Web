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
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.get(".scientific-citation__link").element.dispatchEvent(event);
    expect(wrapper.emitted("citation-activate")).toEqual([
      [{ namespace: "report", indices: [1, 2, 3] }],
    ]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves modified and non-primary citation clicks to the browser", async () => {
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source: "Evidence [1]",
        citationNamespace: "report",
        referenceCount: 1,
      },
    });

    await vi.dynamicImportSettled();
    const link = wrapper.get(".scientific-citation__link");
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { button: 1 }]) {
      link.element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, ...init })
      );
    }

    expect(wrapper.emitted("citation-activate")).toBeUndefined();
  });

  it("keeps escaped and reference-link citation text inert", async () => {
    const source = [
      String.raw`Entity &amp; escaped \[document:1].`,
      "[Evidence [document:2]][source].",
      "Active [3].",
      "",
      "[source]: https://example.org/report",
    ].join("\n");
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source,
        citationNamespace: "report",
        referenceCount: 3,
      },
    });

    await vi.dynamicImportSettled();
    expect(
      wrapper.findAll(".scientific-citation__link").map((link) => link.text())
    ).toEqual(["[3]"]);
    expect(wrapper.findAll("a a")).toHaveLength(0);
    expect(wrapper.text()).toContain("Entity & escaped [document:1]");
    expect(wrapper.text()).toContain("Evidence [document:2]");
  });

  it("renders and activates Bot document citation markers", async () => {
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source: "Evidence [document:1] and [document 3, 4].",
        citationNamespace: "report",
        referenceCount: 4,
      },
    });

    await vi.dynamicImportSettled();
    const links = wrapper.findAll(".scientific-citation__link");
    expect(links.map((link) => link.text())).toEqual([
      "[document:1]",
      "[document 3, 4]",
    ]);

    await links[1].trigger("click");
    expect(wrapper.emitted("citation-activate")).toEqual([
      [{ namespace: "report", indices: [3, 4] }],
    ]);
  });

  it("falls back only the failed child node and preserves the rest of the report", async () => {
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
      props: { source, citationNamespace: "report-error" },
      slots: {
        "block-code": ({ content }: { content: string }) =>
          content.trim() === "child error"
            ? h(ThrowingRenderer)
            : h("strong", { class: "recovered-node" }, content),
      },
    });

    await nextTick();
    expect(wrapper.find(".scientific-markdown__fallback").exists()).toBe(false);
    expect(wrapper.text()).toContain("Whole report");
    expect(wrapper.get(".scientific-markdown__node-fallback").text()).toContain(
      "child error"
    );
    expect(wrapper.emitted("render-error")).toEqual([["render"]]);
    expect(JSON.stringify(wrapper.emitted("render-error"))).not.toContain(
      source
    );

    await wrapper.setProps({
      source: source.replace("child error", "recovered child"),
    });
    await nextTick();
    await nextTick();
    expect(wrapper.find(".scientific-markdown__node-fallback").exists()).toBe(
      false
    );
    expect(wrapper.get(".recovered-node").text()).toContain("recovered child");
  });

  it("keeps citations interactive when they follow escaped raw HTML", async () => {
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source: "<span>x</span> Evidence [1]",
        citationNamespace: "raw-adjacent",
        referenceCount: 1,
      },
    });

    await vi.dynamicImportSettled();
    expect(wrapper.text()).toContain("<span>x</span> Evidence");
    expect(wrapper.get(".scientific-citation__link").text()).toBe("[1]");
  });

  it("opens only external HTTP links in a new tab", async () => {
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source: [
          "[Fragment](#results)",
          "[Root](/reports/1)",
          "[Relative](notes.md)",
          `[Same origin](${window.location.origin}/reports/1)`,
          "[External](https://example.org/report)",
          "[Mail](mailto:science@example.org)",
        ].join(" "),
        citationNamespace: "link-policy",
      },
    });

    await vi.dynamicImportSettled();
    const links = Object.fromEntries(
      wrapper.findAll("a").map((link) => [link.text(), link.attributes()])
    );
    expect(links.Fragment.target).toBeUndefined();
    expect(links.Root.target).toBeUndefined();
    expect(links.Relative.target).toBeUndefined();
    expect(links["Same origin"].target).toBeUndefined();
    expect(links.Mail.target).toBeUndefined();
    expect(links.External.target).toBe("_blank");
    expect(links.External.rel).toBe("noopener noreferrer");
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
      props: {
        source: "initial",
        citationNamespace: "streaming-report",
        streaming: false,
      },
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

  it("keeps CJK bold-label lists and the closing paragraph visible", async () => {
    // Tester copy from 20260817/chat: raw markdown is complete in Word,
    // but the chat bubble dropped list bodies and left leftover **.
    const source = [
      "#### **三、关键注意事项**",
      "1. **无菌操作**：所有步骤需严格无菌，避免杂菌污染。",
      "2. **重复与统计**：检测设 3 次生物学重复，数据采用 ANOVA 分析 (p<0.05)。",
      "3. **菌株保藏**：高效菌株用 **20%甘油** 于-80°C 保存，并做 16S rRNA 鉴定。",
      "4. **培养基标准化**：统一培养基成分与 pH (如 pH=7.0)，减少批次误差。",
      "",
      "---",
      "",
      "#### **四、试剂与仪器建议**",
      "- **试剂**：Salkowski 试剂、ACC (Sigma)、钼蓝比色试剂盒。",
      "- **仪器**：分光光度计、离心机、HPLC、恒温摇床、pH 计。",
      "",
      "---",
      "",
      "通过以上流程，可系统评估菌株功能并构建具有协同效应的合成菌群，为微生物肥料开发或植物-微生物互作研究提供可靠基础。如需具体培养基配方或数据分析方法，可进一步提供详细信息。",
    ].join("\n");

    const wrapper = mountWithApp(ScientificMarkdown, {
      props: { source, surface: "chat" },
    });
    await vi.dynamicImportSettled();

    const text = wrapper.text();
    expect(text).toContain("所有步骤需严格无菌");
    expect(text).toContain("ANOVA");
    expect(text).toContain("Salkowski");
    expect(text).toContain("分光光度计");
    expect(text).toContain("可系统评估菌株功能");
    expect(text).toContain("进一步提供详细信息");
    expect(text).not.toMatch(/无菌操作\*\*无菌操作/);
    expect(text).not.toMatch(/仪器\*\*仪器/);
    expect(wrapper.findAll("li").map((item) => item.text())).toEqual([
      "无菌操作：所有步骤需严格无菌，避免杂菌污染。",
      "重复与统计：检测设 3 次生物学重复，数据采用 ANOVA 分析 (p<0.05)。",
      "菌株保藏：高效菌株用 20%甘油 于-80°C 保存，并做 16S rRNA 鉴定。",
      "培养基标准化：统一培养基成分与 pH (如 pH=7.0)，减少批次误差。",
      "试剂：Salkowski 试剂、ACC (Sigma)、钼蓝比色试剂盒。",
      "仪器：分光光度计、离心机、HPLC、恒温摇床、pH 计。",
    ]);
  });
});
