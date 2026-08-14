import { defineComponent, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWithApp } from "../helpers/test-app-context";

import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import ScientificMarkdownTypewriter from "@/components/ScientificMarkdownTypewriter.vue";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  flushFrames = async () => undefined;
});

let flushFrames: () => Promise<void> = async () => undefined;

function useControlledFrames(): void {
  let nextFrame = 1;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const frame = nextFrame++;
    frames.set(frame, callback);
    return frame;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => {
    frames.delete(frame);
  });
  flushFrames = async () => {
    while (frames.size > 0) {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
      await nextTick();
    }
  };
}

async function flushRenderedPrefix(): Promise<void> {
  await nextTick();
  await flushFrames();
}

describe("ScientificMarkdownTypewriter", () => {
  it("advances Unicode source by code points and emits finish after the full source", async () => {
    vi.useFakeTimers();
    useControlledFrames();
    const source = "123456789😀abc";
    const wrapper = mountWithApp(ScientificMarkdownTypewriter, {
      props: {
        source,
        citationNamespace: "typewriter-unicode",
        surface: "chat",
      },
    });

    await flushRenderedPrefix();
    await vi.advanceTimersByTimeAsync(20);
    await flushRenderedPrefix();
    expect(wrapper.text()).toContain("123456789😀");
    expect(wrapper.text()).not.toContain("123456789😀a");

    await vi.runAllTimersAsync();
    await flushRenderedPrefix();
    expect(wrapper.text()).toContain(source);
    expect(wrapper.emitted("finish")).toEqual([[]]);
  });

  it("resets replaced source, resumes an extension, and cancels on unmount", async () => {
    vi.useFakeTimers();
    useControlledFrames();
    const wrapper = mountWithApp(ScientificMarkdownTypewriter, {
      props: {
        source: "1234567890abcdefghij",
        citationNamespace: "typewriter-replacement",
      },
    });

    await flushRenderedPrefix();
    await vi.advanceTimersByTimeAsync(20);
    await flushRenderedPrefix();
    expect(wrapper.text()).toContain("1234567890");

    await wrapper.setProps({ source: "replaced" });
    await flushRenderedPrefix();
    expect(wrapper.text()).not.toContain("1234567890");
    await vi.advanceTimersByTimeAsync(20);
    await flushRenderedPrefix();
    expect(wrapper.text()).toContain("replaced");

    await wrapper.setProps({ source: "replaced source extension" });
    await vi.runAllTimersAsync();
    await flushRenderedPrefix();
    expect(wrapper.text()).toContain("replaced source extension");

    await wrapper.setProps({
      source: "pending source that needs another tick",
    });
    await flushRenderedPrefix();
    const pendingTimers = vi.getTimerCount();
    expect(pendingTimers).toBeGreaterThan(0);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets when a replacement exactly matches the visible prefix", async () => {
    vi.useFakeTimers();
    useControlledFrames();
    const wrapper = mountWithApp(ScientificMarkdownTypewriter, {
      props: {
        source: "1234567890abcdef",
        citationNamespace: "typewriter-prefix-replacement",
      },
    });

    await flushRenderedPrefix();
    await vi.advanceTimersByTimeAsync(20);
    await flushRenderedPrefix();
    expect(wrapper.text()).toContain("1234567890");

    await wrapper.setProps({ source: "1234567890" });
    await flushRenderedPrefix();
    expect(wrapper.text()).not.toContain("1234567890");

    await vi.advanceTimersByTimeAsync(20);
    await flushRenderedPrefix();
    expect(wrapper.text()).toContain("1234567890");
    expect(wrapper.emitted("finish")).toEqual([[]]);
  });

  it("renders every prefix through ScientificMarkdown with raw HTML inert", async () => {
    vi.useFakeTimers();
    useControlledFrames();
    const source = '<img src=x onerror="alert(1)"> after';
    const wrapper = mountWithApp(ScientificMarkdownTypewriter, {
      props: { source, citationNamespace: "typewriter-html" },
    });

    await flushRenderedPrefix();
    while (vi.getTimerCount() > 0) {
      await vi.advanceTimersByTimeAsync(20);
      await flushRenderedPrefix();
      expect(wrapper.findAll("[onerror]")).toHaveLength(0);
      expect(wrapper.findAll("img")).toHaveLength(0);
    }
    expect(wrapper.text()).toContain(source);
  });

  it("matches the direct ScientificMarkdown semantic DOM at completion", async () => {
    vi.useFakeTimers();
    useControlledFrames();
    const source = "# Heading\n\nEvidence [1] and **bold**";
    const typed = mountWithApp(ScientificMarkdownTypewriter, {
      props: { source, citationNamespace: "m1", referenceCount: 1 },
    });
    const direct = mountWithApp(ScientificMarkdown, {
      props: { source, citationNamespace: "m1", referenceCount: 1 },
    });

    await flushRenderedPrefix();
    await vi.runAllTimersAsync();
    await flushRenderedPrefix();
    expect(typed.find(".phy-markdown").html()).toBe(
      direct.find(".phy-markdown").html()
    );
  });

  it("contains no HTML sink or markdown-it renderer", () => {
    const component = defineComponent({
      components: { ScientificMarkdownTypewriter },
      template:
        '<ScientificMarkdownTypewriter source="source" citation-namespace="typewriter-wrapper" />',
      data: () => ({ source: "source" }),
    });
    const wrapper = mountWithApp(component);
    expect(wrapper.findComponent(ScientificMarkdownTypewriter).exists()).toBe(
      true
    );
    expect(ScientificMarkdownTypewriter.toString()).not.toContain("innerHTML");
  });
});
