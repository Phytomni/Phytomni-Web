import { describe, expect, it, vi } from "vitest";
import { type VueWrapper } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Real MarkdownViewer / DeepGenome import graphs pull vue-element-plus-x CSS.
vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div></div>" },
  FilesCard: { name: "FilesCard", template: "<div></div>" },
  Prompts: { name: "Prompts", template: "<div></div>" },
}));

import ChatMessageContent from "@/views/chat/components/ChatMessageContent.vue";
import type { ChatMessage, ContentBlock } from "@/views/chat/types";
import type { A2uiSurfaceActionEvent } from "@/views/chat/composables/useA2uiInteraction";
import {
  MESSAGE_SHORT_GENERIC,
  MESSAGE_LONG_GENERIC,
  MESSAGE_CITED,
  MESSAGE_DEEP_GENOME,
  MESSAGE_TABLE,
  MESSAGE_STEPS,
  MESSAGE_IMAGE,
  MESSAGE_STREAMING,
  MESSAGE_INTERLEAVED_STREAMING,
  MESSAGE_STREAM_REFS_CAPTURED,
  MESSAGE_FIXTURES,
  PHASE_3B_MESSAGE_KEYS,
  SHORT_GENERIC_MARKDOWN,
  LONG_GENERIC_MARKDOWN,
  CITED_MARKDOWN,
  FIXTURE_REFERENCE_DOC,
} from "../fixtures/chat";
import { getSharedMessageFixture } from "../visual/chat/fixture-data";
import { mountWithApp } from "../helpers/test-app-context";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/ChatView.vue"),
  "utf8"
);

const EMPTY_IMAGES = {} as Record<string, string[]>;
const EMPTY_LOADING = {} as Record<string, boolean>;

type Branch =
  | "stream"
  | "gene-network"
  | "digital-design"
  | "deep-genome"
  | "artifact-preview"
  | "cited"
  | "markdown"
  | "table"
  | "legacy";

/** Mirror of the live truthiness gate (empty arrays are truthy). */
function expectedBranch(message: ChatMessage): Branch {
  const entersBubble =
    message.role === "user" || (!message.steps && !message.tableHeaders);
  if (entersBubble) {
    if (
      message.role === "assistant" &&
      (message.streaming || (message.blocks && message.blocks.length))
    ) {
      return "stream";
    }
    if (
      message.role === "assistant" &&
      message.tool_name === "GeneNetworkAgent"
    ) {
      return "gene-network";
    }
    if (
      message.role === "assistant" &&
      message.tool_name === "DigitalDesignAgent"
    ) {
      return "digital-design";
    }
    if (
      message.role === "assistant" &&
      message.tool_name === "DeepGenomeAgent" &&
      message.id &&
      typeof message.content === "string" &&
      message.content.trim()
    ) {
      return "artifact-preview";
    }
    if (
      message.role === "assistant" &&
      message.tool_name === "DeepGenomeAgent"
    ) {
      return "deep-genome";
    }
    if (
      message.doc_list &&
      message.doc_list.length > 0 &&
      message.role === "assistant"
    ) {
      return "cited";
    }
    return "markdown";
  }
  if (message.tableHeaders) {
    return "table";
  }
  return "legacy";
}

function detectBranch(wrapper: VueWrapper): Branch {
  if (wrapper.find('[data-testid="stream-message"]').exists()) return "stream";
  if (wrapper.find(".research-artifact-preview").exists())
    return "artifact-preview";
  if (wrapper.find('[data-testid="deep-genome"]').exists())
    return "deep-genome";
  if (wrapper.find('[data-testid="cited-answer"]').exists()) return "cited";
  if (wrapper.find(".gene-network-images").exists()) {
    const tool = (wrapper.props("message") as ChatMessage).tool_name;
    return tool === "DigitalDesignAgent" ? "digital-design" : "gene-network";
  }
  if (wrapper.find(".table-response").exists()) return "table";
  if (wrapper.find(".ai-response").exists()) return "legacy";
  if (wrapper.find('[data-testid="markdown-viewer"]').exists())
    return "markdown";
  throw new Error(`Unable to detect branch from: ${wrapper.html()}`);
}

const mountContent = (
  message: ChatMessage,
  overrides: Record<string, unknown> = {}
) =>
  mountWithApp(ChatMessageContent, {
    props: {
      message,
      index: 0,
      isLastMessage: true,
      artifactPreview:
        message.tool_name === "DeepGenomeAgent" &&
        message.id &&
        typeof message.content === "string" &&
        message.content.trim()
          ? {
              title: "Finished",
              kind: "Deep Genome Agent",
              summary: "Deep genome analysis",
              openLabel: "View",
            }
          : null,
      geneNetworkImages: EMPTY_IMAGES,
      geneNetworkImagesLoading: EMPTY_LOADING,
      digitalDesignImages: EMPTY_IMAGES,
      digitalDesignImagesLoading: EMPTY_LOADING,
      ...overrides,
    },
    global: {
      stubs: {
        StreamMessage: {
          name: "StreamMessage",
          props: ["blocks", "ns", "references"],
          emits: ["a2ui-action", "a2ui-retry"],
          template:
            "<div data-testid=\"stream-message\" :data-ns=\"ns === undefined || ns === '' ? '__absent__' : ns\" :data-ref-count=\"Array.isArray(references) && references.length ? String(references.length) : '0'\" />",
        },
        DeepGenomeResultViewer: {
          name: "DeepGenomeResultViewer",
          props: {
            markdown: String,
            references: Array,
            ns: String,
            embedded: Boolean,
          },
          template:
            "<div data-testid=\"deep-genome\" :data-ns=\"ns === undefined ? '__absent__' : ns\" :data-embedded=\"embedded ? 'true' : 'false'\" />",
        },
        CitedAnswer: {
          name: "CitedAnswer",
          props: ["content", "references", "ns", "instantMessage"],
          template:
            '<div data-testid="cited-answer" :data-ns="ns === undefined ? \'__absent__\' : ns" />',
        },
        MarkdownViewer: {
          name: "MarkdownViewer",
          props: ["content", "instantMessage", "ns"],
          template:
            '<div data-testid="markdown-viewer" :data-ns="ns === undefined ? \'__absent__\' : ns" />',
        },
        ElTable: {
          name: "ElTable",
          template: '<div data-testid="el-table" />',
        },
        ElTableColumn: true,
        ElIcon: true,
        Loading: true,
      },
      mocks: {
        $t: (key: string) => key,
      },
    },
  });

const block = (text = "hi"): ContentBlock => ({
  type: "markdown",
  authority: "web",
  text,
});

describe("ChatMessageContent branch selection (truthiness gate)", () => {
  it("renders a non-blocking degraded context status without replacing the answer", () => {
    const wrapper = mountContent({
      role: "assistant",
      content: "Answer remains visible",
      contextNotice: { rebuilt: false, degraded: true },
    });

    expect(wrapper.get('[role="status"]').text()).toBe("chat.contextDegraded");
    expect(
      wrapper.findComponent({ name: "MarkdownViewer" }).props("content")
    ).toBe("Answer remains visible");
  });

  it("keeps rebuilt-only context notices silent", () => {
    const wrapper = mountContent({
      role: "assistant",
      content: "Answer remains visible",
      contextNotice: { rebuilt: true, degraded: false },
    });

    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  const cases: Array<{ name: string; message: ChatMessage }> = [
    {
      name: "user bubble → markdown",
      message: { role: "user", content: "hello" },
    },
    {
      name: "assistant plain → markdown",
      message: { role: "assistant", content: "answer", tool_name: "ChatAgent" },
    },
    {
      name: "legacy object content → markdown",
      message: {
        role: "assistant",
        content: { final_answer: "legacy answer", steps: ["retrieve"] },
        tool_name: "ChatAgent",
      },
    },
    {
      name: "assistant streaming → stream",
      message: {
        role: "assistant",
        content: "",
        streaming: true,
        blocks: [block()],
        tool_name: "ChatAgent",
      },
    },
    {
      name: "assistant non-empty blocks → stream",
      message: {
        role: "assistant",
        content: "",
        blocks: [block()],
        tool_name: "ChatAgent",
      },
    },
    {
      name: "GeneNetworkAgent → gene-network",
      message: {
        role: "assistant",
        content: "",
        tool_name: "GeneNetworkAgent",
        id: "gn-1",
      },
    },
    {
      name: "DigitalDesignAgent → digital-design",
      message: {
        role: "assistant",
        content: "",
        tool_name: "DigitalDesignAgent",
        id: "dd-1",
      },
    },
    {
      name: "DeepGenomeAgent with docs → artifact preview",
      message: {
        role: "assistant",
        content: "md",
        tool_name: "DeepGenomeAgent",
        doc_list: [{ title: "Doc" }],
      },
    },
    {
      name: "referenced assistant → cited",
      message: {
        role: "assistant",
        content: "cited body",
        tool_name: "KnowledgeAgent",
        doc_list: [{ title: "Doc" }],
      },
    },
    {
      name: "truthy tableHeaders → table",
      message: {
        role: "assistant",
        content: [{ a: 1 }],
        tableHeaders: [{ prop: "a", label: "A" }],
        tool_name: "DataAgent",
      },
    },
    {
      name: "truthy steps (no table) → legacy",
      message: {
        role: "assistant",
        content: "final",
        steps: ["step-1"],
        tool_name: "ChatAgent",
      },
    },
    {
      name: "absent steps/tableHeaders → bubble markdown",
      message: { role: "assistant", content: "x", tool_name: "ChatAgent" },
    },
    {
      name: "empty steps=[] is truthy → legacy",
      message: {
        role: "assistant",
        content: "final",
        steps: [],
        tool_name: "ChatAgent",
      },
    },
    {
      name: "empty tableHeaders=[] is truthy → table",
      message: {
        role: "assistant",
        content: [],
        tableHeaders: [],
        tool_name: "DataAgent",
      },
    },
    {
      name: "user with structural fields still enters bubble",
      message: {
        role: "user",
        content: "q",
        steps: ["s"],
        tableHeaders: [{ prop: "a", label: "A" }],
      },
    },
    {
      name: "streaming + steps does not jump ahead of outer gate → legacy",
      message: {
        role: "assistant",
        content: "final",
        streaming: true,
        blocks: [block()],
        steps: ["s"],
        tool_name: "ChatAgent",
      },
    },
    {
      name: "streaming + tableHeaders → table",
      message: {
        role: "assistant",
        content: [],
        streaming: true,
        blocks: [block()],
        tableHeaders: [{ prop: "a", label: "A" }],
        tool_name: "DataAgent",
      },
    },
    {
      name: "blocks + empty steps=[] → legacy (mixed)",
      message: {
        role: "assistant",
        content: "final",
        blocks: [block()],
        steps: [],
        tool_name: "ChatAgent",
      },
    },
    {
      name: "blocks + empty tableHeaders=[] → table (mixed)",
      message: {
        role: "assistant",
        content: [],
        blocks: [block()],
        tableHeaders: [],
        tool_name: "DataAgent",
      },
    },
  ];

  for (const { name, message } of cases) {
    it(name, () => {
      const want = expectedBranch(message);
      const wrapper = mountContent(message);
      expect(detectBranch(wrapper)).toBe(want);
    });
  }
});

describe("ChatMessageContent shared Phase 3B fixtures (branch order)", () => {
  const expectedByKey: Record<string, Branch> = {
    "short-generic": "markdown",
    "long-generic": "markdown",
    cited: "cited",
    "deep-genome": "artifact-preview",
    table: "table",
    steps: "legacy",
    image: "gene-network",
    streaming: "stream",
    "interleaved-streaming": "stream",
  };

  for (const key of PHASE_3B_MESSAGE_KEYS) {
    it(`fixture ${key} selects ${expectedByKey[key]}`, () => {
      const message = MESSAGE_FIXTURES[key];
      expect(detectBranch(mountContent(message))).toBe(expectedByKey[key]);
      expect(expectedBranch(message)).toBe(expectedByKey[key]);
    });
  }

  it("DeepGenome uses the artifact preview before generic cited rendering", () => {
    const wrapper = mountContent(MESSAGE_DEEP_GENOME, {
      artifactPreview: {
        title: "Finished",
        kind: "Deep Genome Agent",
        summary: "Deep genome analysis",
        openLabel: "View",
      },
    });
    expect(detectBranch(wrapper)).toBe("artifact-preview");
    expect(wrapper.find('[data-testid="cited-answer"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="markdown-viewer"]').exists()).toBe(
      false
    );
  });

  it("formats InSilico artifact labels only on the Chat preview path", () => {
    const artifactPreview = {
      title: "Finished",
      kind: "In Silico Research Agent",
      summary: "Research report",
      openLabel: "View",
    };
    const wrapper = mountContent(
      { ...MESSAGE_DEEP_GENOME, tool_name: "InSilicoResearchAgent" },
      { artifactPreview }
    );
    expect(wrapper.get(".research-artifact-preview__kind em").text()).toBe(
      "In Silico"
    );
  });

  it("specialized families are never captured by generic Markdown", () => {
    for (const message of [
      MESSAGE_CITED,
      MESSAGE_DEEP_GENOME,
      MESSAGE_IMAGE,
      MESSAGE_TABLE,
      MESSAGE_STEPS,
      MESSAGE_STREAMING,
      MESSAGE_INTERLEAVED_STREAMING,
    ]) {
      const wrapper = mountContent(message);
      const branch = detectBranch(wrapper);
      // Bubble-path generic Markdown must not win over specialized families.
      expect(branch).not.toBe("markdown");
      // Bubble specialized renderers (not legacy, which embeds MarkdownViewer).
      if (
        branch === "cited" ||
        branch === "deep-genome" ||
        branch === "artifact-preview" ||
        branch === "stream" ||
        branch === "gene-network" ||
        branch === "digital-design" ||
        branch === "table"
      ) {
        expect(wrapper.find('[data-testid="markdown-viewer"]').exists()).toBe(
          false
        );
      }
    }
  });

  it("harness imports the identical fixture objects (no copied bodies)", () => {
    expect(getSharedMessageFixture("short-generic")).toBe(
      MESSAGE_SHORT_GENERIC
    );
    expect(getSharedMessageFixture("long-generic")).toBe(MESSAGE_LONG_GENERIC);
    expect(getSharedMessageFixture("cited")).toBe(MESSAGE_CITED);
    expect(getSharedMessageFixture("deep-genome")).toBe(MESSAGE_DEEP_GENOME);
    expect(getSharedMessageFixture("table")).toBe(MESSAGE_TABLE);
    expect(getSharedMessageFixture("steps")).toBe(MESSAGE_STEPS);
    expect(getSharedMessageFixture("image")).toBe(MESSAGE_IMAGE);
    expect(getSharedMessageFixture("streaming")).toBe(MESSAGE_STREAMING);
    expect(getSharedMessageFixture("interleaved-streaming")).toBe(
      MESSAGE_INTERLEAVED_STREAMING
    );
    expect(MESSAGE_SHORT_GENERIC.content).toBe(SHORT_GENERIC_MARKDOWN);
    expect(MESSAGE_LONG_GENERIC.content).toBe(LONG_GENERIC_MARKDOWN);
    expect(MESSAGE_CITED.content).toBe(CITED_MARKDOWN);
    expect(MESSAGE_CITED.doc_list?.[0]).toEqual(FIXTURE_REFERENCE_DOC);
  });
});

describe("ChatMessageContent namespace and message-owned stream context", () => {
  it("does not forward runtime transport props to StreamMessage", () => {
    const transport = async () => undefined;
    const wrapper = mountContent(
      {
        role: "assistant",
        content: "",
        streaming: true,
        blocks: [block()],
        tool_name: "ChatAgent",
        a2uiRuntime: {
          dialogueId: "dialogue-42",
          messageId: "142",
          runId: "run-42",
          transport,
        },
      },
      { index: 4 }
    );
    const stream = wrapper.findComponent({ name: "StreamMessage" });
    expect(stream.exists()).toBe(true);
    expect(stream.attributes("data-ns")).toBe("__absent__");
    expect(stream.props("runId")).toBeUndefined();
    expect(stream.props("transport")).toBeUndefined();
    expect(transport).toBeTypeOf("function");
  });

  it("keeps a context-free row free of transport props", () => {
    const wrapper = mountContent({
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [block()],
      tool_name: "ChatAgent",
    });
    const stream = wrapper.findComponent({ name: "StreamMessage" });
    expect(stream.props("runId")).toBeUndefined();
    expect(stream.props("transport")).toBeUndefined();
  });

  it("preserves typed A2UI action and retry events from StreamMessage", async () => {
    const wrapper = mountContent({
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [block()],
      tool_name: "ChatAgent",
    });
    const stream = wrapper.findComponent({ name: "StreamMessage" });
    const event: A2uiSurfaceActionEvent = {
      surfaceId: "surface-1",
      intent: { widget: "confirm", payload: { accepted: true } },
    };
    await stream.vm.$emit("a2ui-action", event);
    await stream.vm.$emit("a2ui-retry", "surface-1");
    expect(wrapper.emitted("a2ui-action")).toEqual([[event]]);
    expect(wrapper.emitted("a2ui-retry")).toEqual([["surface-1"]]);
  });

  it("reference-free streaming fixtures invent no namespace", () => {
    for (const message of [MESSAGE_STREAMING, MESSAGE_INTERLEAVED_STREAMING]) {
      const wrapper = mountContent(message, { index: 5 });
      expect(detectBranch(wrapper)).toBe("stream");
      expect(
        wrapper.find('[data-testid="stream-message"]').attributes("data-ns")
      ).toBe("__absent__");
    }
  });

  it("keeps the DeepGenome full source out of the Chat preview", () => {
    const deep = mountContent(MESSAGE_DEEP_GENOME, {
      index: 7,
      artifactPreview: {
        title: "Finished",
        kind: "Deep Genome Agent",
        summary: "Deep genome analysis",
        openLabel: "View",
      },
    });
    expect(deep.find(".research-artifact-preview").exists()).toBe(true);
    expect(deep.text()).not.toContain(String(MESSAGE_DEEP_GENOME.content));

    const cited = mountContent(MESSAGE_CITED, { index: 3 });
    expect(
      cited.find('[data-testid="cited-answer"]').attributes("data-ns")
    ).toBe("m3");

    const plain = mountContent(MESSAGE_SHORT_GENERIC, { index: 9 });
    expect(
      plain.find('[data-testid="markdown-viewer"]').attributes("data-ns")
    ).toBe("__absent__");
  });

  it("emits finish from CitedAnswer and MarkdownViewer paths", async () => {
    const cited = mountContent(MESSAGE_CITED);
    await cited.findComponent({ name: "CitedAnswer" }).vm.$emit("finish");
    expect(cited.emitted("finish")).toBeTruthy();

    const md = mountContent(MESSAGE_SHORT_GENERIC);
    await md.findComponent({ name: "MarkdownViewer" }).vm.$emit("finish");
    expect(md.emitted("finish")).toBeTruthy();
  });
});

describe("ChatMessageContent live streaming citations", () => {
  it("passes doc_list + ns=m${index} to StreamMessage when references are nonempty", () => {
    expect(MESSAGE_STREAM_REFS_CAPTURED.doc_list).toEqual([
      FIXTURE_REFERENCE_DOC,
    ]);
    expect(MESSAGE_STREAM_REFS_CAPTURED.blocks?.length).toBeGreaterThan(0);

    const wrapper = mountContent(MESSAGE_STREAM_REFS_CAPTURED, { index: 2 });
    expect(detectBranch(wrapper)).toBe("stream");
    const stream = wrapper.find('[data-testid="stream-message"]');
    expect(stream.attributes("data-ns")).toBe("m2");
    expect(stream.attributes("data-ref-count")).toBe("1");
    // Still StreamMessage — never a CitedAnswer duplicate body for the same turn.
    expect(wrapper.find('[data-testid="cited-answer"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="deep-genome"]').exists()).toBe(false);
  });

  it("keeps empty namespace before doc_list arrives, then wires ns without remounting", async () => {
    const message: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [block("See [1].")],
      tool_name: "ChatAgent",
    };
    const wrapper = mountContent(message, { index: 5 });
    const stream = wrapper.find('[data-testid="stream-message"]');
    expect(stream.attributes("data-ns")).toBe("__absent__");
    expect(stream.attributes("data-ref-count")).toBe("0");

    // Finalizer reactively assigns phyto.references → doc_list on the same message.
    message.doc_list = [{ title: "Live Paper" }];
    message.streaming = false;
    await wrapper.setProps({ message: { ...message } });

    const after = wrapper.find('[data-testid="stream-message"]');
    expect(after.attributes("data-ns")).toBe("m5");
    expect(after.attributes("data-ref-count")).toBe("1");
    expect(detectBranch(wrapper)).toBe("stream");
  });

  it("gives two cited streams disjoint page namespaces", () => {
    const msg = (text: string): ChatMessage => ({
      role: "assistant",
      content: "",
      blocks: [block(text)],
      doc_list: [{ title: "Doc" }],
      tool_name: "ChatAgent",
    });
    const a = mountContent(msg("A [1]"), { index: 0 });
    const b = mountContent(msg("B [1]"), { index: 1 });
    expect(a.find('[data-testid="stream-message"]').attributes("data-ns")).toBe(
      "m0"
    );
    expect(b.find('[data-testid="stream-message"]').attributes("data-ns")).toBe(
      "m1"
    );
  });

  /**
   * Live-session limitation: the Go accumulator does not persist a dedicated
   * streaming-reference field. After history reload, blocks-bearing messages
   * without doc_list have no safe citation targets — do not invent rows here.
   */
  it("documents history-refresh fixtures as references-unavailable", () => {
    // MESSAGE_STREAMING / interleaved fixtures mimic a reloaded stream without
    // persisted phyto.references — empty ns, no reference rows.
    for (const message of [MESSAGE_STREAMING, MESSAGE_INTERLEAVED_STREAMING]) {
      expect(message.doc_list).toBeUndefined();
      const wrapper = mountContent(message, { index: 3 });
      expect(detectBranch(wrapper)).toBe("stream");
      expect(
        wrapper.find('[data-testid="stream-message"]').attributes("data-ns")
      ).toBe("__absent__");
      expect(
        wrapper
          .find('[data-testid="stream-message"]')
          .attributes("data-ref-count")
      ).toBe("0");
    }
  });
});

describe("ChatMessageContent integration in chat index", () => {
  it("is mounted from ChatView.vue and ChatView no longer inlines StreamMessage/CitedAnswer branches", () => {
    expect(CHAT_SOURCE).toContain("<ChatMessageContent");
    expect(CHAT_SOURCE).toMatch(
      /import ChatMessageContent from ["']\.\/components\/ChatMessageContent\.vue["']/
    );
    // Content renderers live in ChatMessageContent; index keeps log MarkdownViewer only.
    expect(CHAT_SOURCE).not.toMatch(
      /<StreamMessage[\s\S]*:blocks="message\.blocks/
    );
    expect(CHAT_SOURCE).not.toMatch(/<CitedAnswer[\s\S]*:ns="'m' \+ index"/);
    expect(CHAT_SOURCE).not.toMatch(
      /<DeepGenomeResultViewer[\s\S]*:ns="'m' \+ index"/
    );
  });
});

describe("ChatMessageContent overflow and agent image presentation", () => {
  const CONTENT_SOURCE = readFileSync(
    resolve(
      __dirname,
      "../../src/views/chat/components/ChatMessageContent.vue"
    ),
    "utf8"
  );
  const contentStyles = [
    ...CONTENT_SOURCE.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g),
  ]
    .map((m) => m[1])
    .join("\n");

  it("owns internal overflow so wide table/code/image children stay in transcript", () => {
    expect(contentStyles).toMatch(/min-width:\s*0/);
    expect(contentStyles).toMatch(/overflow-x:\s*auto/);
    // Table branch and bubble body both need an overflow owner.
    expect(contentStyles).toMatch(/\.table-response|\.message-text/);
  });

  it("uses locale-reactive result image alt with one-based index", () => {
    expect(CONTENT_SOURCE).toMatch(
      /\$t\(\s*["']chat\.resultImageAlt["']\s*,\s*\{\s*index:\s*imgIndex\s*\+\s*1\s*\}\s*\)/
    );
    expect(CONTENT_SOURCE).not.toMatch(/['"]Result ['"]\s*\+\s*\(imgIndex/);
  });

  it("renders GeneNetwork/DigitalDesign alt from the locale key at mount", () => {
    const gn = mountContent(
      {
        role: "assistant",
        content: "",
        tool_name: "GeneNetworkAgent",
        id: "gn-alt",
      },
      {
        geneNetworkImages: {
          "gn-alt": ["data:image/svg+xml,%3Csvg/%3E"],
        },
      }
    );
    const img = gn.find("img.result-image");
    expect(img.exists()).toBe(true);
    // Mock $t returns the key; production interpolates {index}.
    expect(img.attributes("alt")).toBe("chat.resultImageAlt");

    const dd = mountContent(
      {
        role: "assistant",
        content: "",
        tool_name: "DigitalDesignAgent",
        id: "dd-alt",
      },
      {
        digitalDesignImages: {
          "dd-alt": ["data:image/svg+xml,%3Csvg/%3E"],
        },
      }
    );
    expect(dd.find("img.result-image").attributes("alt")).toBe(
      "chat.resultImageAlt"
    );
  });

  it("styles image/loading/no-image with semantic tokens and contained overflow", () => {
    expect(contentStyles).toMatch(/var\(--phy-color-text-muted\)/);
    expect(contentStyles).toMatch(
      /var\(--phy-shadow-soft\)|var\(--phy-radius-sm\)/
    );
    expect(contentStyles).not.toMatch(/#909399/);
    expect(contentStyles).not.toMatch(
      /box-shadow:\s*0\s+2px\s+8px\s+rgba\(0,\s*0,\s*0,\s*0\.1\)/
    );
    // Gene image chrome left ChatView.vue — styles live on Content now.
    expect(CHAT_SOURCE).not.toMatch(/\.gene-network-images\s*\{[\s\S]*#909399/);
  });

  it("does not change GeneNetwork image map keys or loading gates", () => {
    expect(CONTENT_SOURCE).toMatch(
      /geneNetworkImagesLoading\[message\.id \|\| ['"]['"]\]/
    );
    expect(CONTENT_SOURCE).toMatch(
      /geneNetworkImages\[message\.id \|\| ['"]['"]\]/
    );
    expect(CONTENT_SOURCE).toMatch(
      /digitalDesignImagesLoading\[message\.id \|\| ['"]['"]\]/
    );
    expect(CONTENT_SOURCE).toMatch(
      /digitalDesignImages\[message\.id \|\| ['"]['"]\]/
    );
  });
});
