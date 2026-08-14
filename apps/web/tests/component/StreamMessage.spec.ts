import { describe, it, expect, vi } from "vitest";
import { nextTick } from "vue";
import StreamMessage from "@/views/chat/components/StreamMessage.vue";
import ChatActivity from "@/views/chat/components/ChatActivity.vue";
import type { ContentBlock } from "@/views/chat/types";
import { mountWithApp } from "../helpers/test-app-context";

describe("StreamMessage", () => {
  it("renders a markdown block through ScientificMarkdown", () => {
    const blocks: ContentBlock[] = [
      { type: "markdown", authority: "web", text: "**hi**" },
    ];
    const w = mountWithApp(StreamMessage, { props: { blocks } });
    expect(w.html()).toContain("<strong>hi</strong>");
  });

  it("skins the streaming markdown wrapper with chat classes without a legacy renderer", async () => {
    const blocks: ContentBlock[] = [
      { type: "markdown", authority: "web", text: "**hi**" },
    ];
    const w = mountWithApp(StreamMessage, { props: { blocks } });
    await vi.dynamicImportSettled();
    const md = w.find(".md-block.phy-markdown.phy-markdown--chat");
    expect(md.exists()).toBe(true);
    expect(md.html()).toContain("<strong>hi</strong>");
    // Streaming stays on MarkdownBlock and the shared ScientificMarkdown engine.
    expect(w.find(".markdown-viewer").exists()).toBe(false);
    expect(w.findComponent({ name: "ScientificMarkdown" }).exists()).toBe(true);
  });

  it("skips an unregistered block type without throwing", () => {
    const blocks: ContentBlock[] = [{ type: "mol3d", authority: "web" }];
    const w = mountWithApp(StreamMessage, { props: { blocks } });
    expect(w.html()).not.toContain("mol3d");
  });

  it("emits a message-scoped surface action without injecting transport", async () => {
    const blocks: ContentBlock[] = [
      {
        type: "agent-surface",
        authority: "agent",
        interactive: true,
        a2ui: {
          surface: {
            catalog_version: "v1.0",
            surface_id: "surf-inject",
            widget: "confirm",
            props: { title: "Go?", confirm_label: "Yes", cancel_label: "No" },
          },
          state: { status: "ready", round: 1 },
        },
      },
    ];
    const w = mountWithApp(StreamMessage, {
      props: { blocks },
    });
    await w
      .find(".a2ui-confirm button[type='button']:last-child")
      .trigger("click");
    await nextTick();
    expect(w.emitted("a2ui-action")).toEqual([
      [
        {
          surfaceId: "surf-inject",
          intent: { widget: "confirm", payload: { accepted: true } },
        },
      ],
    ]);
    expect(w.emitted("a2ui-retry")).toBeUndefined();
    await w.findComponent({ name: "AgentSurfaceBlock" }).vm.$emit("retry");
    expect(w.emitted("a2ui-retry")).toEqual([["surf-inject"]]);
    expect(w.vm.$.provides).not.toHaveProperty("a2uiRunId");
    expect(w.vm.$.provides).not.toHaveProperty("a2uiTransport");
  });

  it("leaves [N] literal when ns is absent (reference-free streaming)", () => {
    const blocks: ContentBlock[] = [
      {
        type: "markdown",
        authority: "web",
        text: "See [1] for the claim.",
      },
    ];
    const w = mountWithApp(StreamMessage, { props: { blocks } });
    // Scope gate: without ns / references, ScientificMarkdown keeps [N] literal.
    expect(w.html()).toContain("[1]");
    expect(w.html()).not.toContain('href="#');
    expect(w.find(".doc-list").exists()).toBe(false);
  });

  it("keeps [N] literal when ns is set but references are empty or absent", () => {
    const blocks: ContentBlock[] = [
      {
        type: "markdown",
        authority: "web",
        text: "See [1] for the claim.",
      },
    ];
    for (const references of [undefined, [] as unknown[]]) {
      const w = mountWithApp(StreamMessage, {
        props: { blocks, ns: "m0", references },
        global: { mocks: { $t: (k: string) => k } },
      });
      expect(w.html()).toContain("[1]");
      expect(w.html()).not.toContain("#m0-ref-");
      expect(w.html()).not.toContain('href="#');
      expect(w.find(".doc-list").exists()).toBe(false);
    }
  });

  it("linkifies [N] and renders CitationReferenceList only when references are nonempty", async () => {
    const blocks: ContentBlock[] = [
      {
        type: "markdown",
        authority: "web",
        text: "See [1] for the claim.",
      },
    ];
    const w = mountWithApp(StreamMessage, {
      props: {
        blocks,
        ns: "",
        references: undefined,
      },
      global: { mocks: { $t: (k: string) => k } },
    });
    // Before references: empty ns → literal marker, no rows.
    expect(w.html()).toContain("[1]");
    expect(w.html()).not.toContain('class="citation-ref"');
    expect(w.find(".doc-list").exists()).toBe(false);

    // Reactive arrival of real references + page ns (same StreamMessage instance).
    await w.setProps({
      ns: "m2",
      references: [{ title: "Paper One" }],
    });
    await nextTick();

    // Streaming path: ScientificMarkdown emits #ns-ref-N anchors (not citation-ref).
    expect(w.html()).toContain('href="#m2-ref-1"');
    expect(w.get(".scientific-citation__link").attributes("href")).toBe(
      "#m2-ref-1"
    );
    const row = w.find(".doc-list-item");
    expect(row.exists()).toBe(true);
    expect(row.attributes("id")).toBe("m2-ref-1");
    expect(row.html()).toContain("Paper One");
    // Ordered blocks stay ahead of the reference list (no collapse/remount of markdown).
    const md = w.find(".md-block");
    expect(md.exists()).toBe(true);
    expect(md.html()).toContain('href="#m2-ref-1"');
  });

  it("activates its grouped reference rows before relaying the citation", async () => {
    const w = mountWithApp(StreamMessage, {
      props: {
        blocks: [
          { type: "markdown", authority: "web", text: "Evidence [1-2]." },
        ],
        ns: "m-citation",
        references: [{ title: "Reference one" }, { title: "Reference two" }],
      },
    });
    await vi.dynamicImportSettled();

    const rows = w.findAll(".doc-list-item");
    const scrollIntoView = vi.fn();
    Object.defineProperty(rows[0].element, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const focus = vi.spyOn(rows[0].element as HTMLElement, "focus");

    expect(rows.map((row) => row.attributes("id"))).toEqual([
      "m-citation-ref-1",
      "m-citation-ref-2",
    ]);
    await w.get(".scientific-citation__link").trigger("click");
    expect(
      rows.map((row) => row.classes().includes("is-citation-target"))
    ).toEqual([true, true]);
    expect(rows.map((row) => row.attributes("aria-current"))).toEqual([
      "true",
      undefined,
    ]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(w.emitted("citation-activate")).toEqual([
      [{ namespace: "m-citation", indices: [1, 2] }],
    ]);
  });

  it("keeps two streams' citation targets disjoint; empty references stay a no-op", () => {
    const blocks: ContentBlock[] = [
      { type: "markdown", authority: "web", text: "Claim [1]." },
    ];
    const a = mountWithApp(StreamMessage, {
      props: { blocks, ns: "m0", references: [{ title: "A" }] },
      global: { mocks: { $t: (k: string) => k } },
    });
    const b = mountWithApp(StreamMessage, {
      props: { blocks, ns: "m1", references: [{ title: "B" }] },
      global: { mocks: { $t: (k: string) => k } },
    });
    const none = mountWithApp(StreamMessage, {
      props: { blocks, ns: undefined, references: [] },
      global: { mocks: { $t: (k: string) => k } },
    });

    expect(a.find(".doc-list-item").attributes("id")).toBe("m0-ref-1");
    expect(b.find(".doc-list-item").attributes("id")).toBe("m1-ref-1");
    expect(a.html()).toContain('href="#m0-ref-1"');
    expect(b.html()).toContain('href="#m1-ref-1"');
    expect(a.html()).not.toContain('href="#m1-ref-1"');
    expect(b.html()).not.toContain('href="#m0-ref-1"');

    expect(none.html()).toContain("[1]");
    expect(none.html()).not.toContain('href="#');
    expect(none.find(".doc-list").exists()).toBe(false);
  });

  it("preserves A2UI surface events while references appear after blocks", async () => {
    const blocks: ContentBlock[] = [
      {
        type: "agent-surface",
        authority: "agent",
        interactive: true,
        a2ui: {
          surface: {
            catalog_version: "v1.0",
            surface_id: "surf-refs",
            widget: "confirm",
            props: { title: "Go?", confirm_label: "Yes", cancel_label: "No" },
          },
          state: { status: "ready", round: 1 },
        },
      },
      { type: "markdown", authority: "web", text: "See [1]." },
    ];
    const w = mountWithApp(StreamMessage, {
      props: {
        blocks,
        ns: "",
        references: undefined,
      },
      global: { mocks: { $t: (k: string) => k } },
    });
    expect(w.find(".a2ui-confirm, .agent-surface, button").exists()).toBe(true);

    await w.setProps({
      ns: "m4",
      references: [{ title: "R" }],
    });
    await nextTick();

    expect(w.find(".doc-list-item").attributes("id")).toBe("m4-ref-1");
    const buttons = w.findAll("button");
    await buttons[buttons.length - 1].trigger("click");
    await nextTick();
    expect(w.emitted("a2ui-action")).toEqual([
      [
        {
          surfaceId: "surf-refs",
          intent: { widget: "confirm", payload: { accepted: true } },
        },
      ],
    ]);
    expect(
      w.find(".a2ui-confirm").attributes("reference-count")
    ).toBeUndefined();
    expect(w.find(".a2ui-confirm").attributes("ns")).toBeUndefined();
  });

  it("groups consecutive activity blocks and keeps markdown/A2UI outside ChatActivity", () => {
    const blocks: ContentBlock[] = [
      { type: "markdown", authority: "web", text: "intro" },
      { type: "tool", authority: "web", toolName: "knowledge_search" },
      { type: "step", authority: "web", label: "retrieving" },
      {
        type: "agent-surface",
        authority: "agent",
        interactive: true,
        a2ui: {
          surface: {
            catalog_version: "v1.0",
            surface_id: "surf-vis",
            widget: "confirm",
            props: { title: "Go?", confirm_label: "Yes", cancel_label: "No" },
          },
          state: { status: "ready", round: 1 },
        },
      },
      { type: "tool", authority: "web", toolName: "after" },
      { type: "markdown", authority: "web", text: "outro" },
    ];
    const w = mountWithApp(StreamMessage, {
      props: {
        blocks,
        streamPresentationKey: "req-act",
        activityExpandedByMessage: {},
        streaming: true,
      },
      global: { mocks: { $t: (k: string) => k } },
    });

    const activities = w.findAllComponents(ChatActivity);
    // Two activity groups split by agent-surface (indices 1 and 4).
    expect(activities).toHaveLength(2);
    expect(w.html()).toContain("intro");
    expect(w.html()).toContain("outro");
    // A2UI stays visible outside collapsed Activity.
    expect(w.find(".a2ui-confirm, .agent-surface").exists()).toBe(true);
    expect(w.text()).toContain("Go?");
    // Default closed: tool labels not visible in collapsed groups.
    expect(w.find(".tool-block").exists()).toBe(false);
  });

  it("missing presentation key expands activity content without a disclosure (hard stop)", () => {
    const blocks: ContentBlock[] = [
      { type: "tool", authority: "web", toolName: "knowledge_search" },
      { type: "reasoning", authority: "web", text: "plan" },
    ];
    const w = mountWithApp(StreamMessage, {
      props: { blocks },
      global: { mocks: { $t: (k: string) => k } },
    });
    expect(w.find("button[aria-expanded]").exists()).toBe(false);
    expect(w.find(".tool-block").exists()).toBe(true);
    // Reasoning inside missing-key activity still withinActivity (no nested toggle).
    expect(w.find(".reasoning-toggle").exists()).toBe(false);
    expect(w.find(".reasoning-body").exists()).toBe(true);
  });

  it("keeps A2UI surface events beside a collapsed Activity group", async () => {
    const blocks: ContentBlock[] = [
      { type: "tool", authority: "web", toolName: "knowledge_search" },
      {
        type: "agent-surface",
        authority: "agent",
        interactive: true,
        a2ui: {
          surface: {
            catalog_version: "v1.0",
            surface_id: "surf-beside",
            widget: "confirm",
            props: {
              title: "Confirm?",
              confirm_label: "Yes",
              cancel_label: "No",
            },
          },
          state: { status: "ready", round: 1 },
        },
      },
    ];
    const w = mountWithApp(StreamMessage, {
      props: {
        blocks,
        streamPresentationKey: "req-a2ui",
        activityExpandedByMessage: {},
      },
      global: { mocks: { $t: (k: string) => k } },
    });
    expect(w.find(".tool-block").exists()).toBe(false);
    expect(w.text()).toContain("Confirm?");
    const buttons = w.findAll("button");
    // Last button is the A2UI confirm (Activity toggle is first).
    await buttons[buttons.length - 1].trigger("click");
    await nextTick();
    expect(w.emitted("a2ui-action")).toEqual([
      [
        {
          surfaceId: "surf-beside",
          intent: { widget: "confirm", payload: { accepted: true } },
        },
      ],
    ]);
  });

  it("emits activity expand toggles keyed by stream:<messageKey>:activity-<startIndex>", async () => {
    const blocks: ContentBlock[] = [
      { type: "tool", authority: "web", toolName: "knowledge_search" },
    ];
    const w = mountWithApp(StreamMessage, {
      props: {
        blocks,
        streamPresentationKey: "req-toggle",
        activityExpandedByMessage: {},
      },
      global: { mocks: { $t: (k: string) => k } },
    });
    await w.find("button[aria-expanded]").trigger("click");
    expect(w.emitted("update:activity-expanded")?.[0]).toEqual([
      "stream:req-toggle:activity-0",
      true,
    ]);
  });
});
