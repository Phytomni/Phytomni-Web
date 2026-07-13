import { describe, it, expect } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

// Locks the reference-renderer text fields. doc_list comes from the Bot
// `formatted.references` reshape (attacker-influenceable via agent output / RAG),
// and each reference is interpolated into ref.html and fed to v-html. The href
// parts are already scheme-checked; this pins the TEXT fields (title, citation
// au/so, plain-string and JSON fallbacks) so a raw tag can't reach the DOM.
const passthrough = { template: "<div><slot /></div>" };
const VIEWER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/DeepGenomeResultViewer.vue"),
  "utf8"
);
const VIEWER_TEMPLATE = VIEWER_SOURCE.slice(
  0,
  VIEWER_SOURCE.indexOf("<script setup")
);
const VIEWER_STYLES = [
  ...VIEWER_SOURCE.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g),
]
  .map((match) => match[1])
  .join("\n");
const TOC_PATH = resolve(
  __dirname,
  "../../src/components/research/DeepGenomeToc.vue"
);
const TYPES_PATH = resolve(
  __dirname,
  "../../src/components/research/deep-genome-types.ts"
);
const TOC_SOURCE = existsSync(TOC_PATH) ? readFileSync(TOC_PATH, "utf8") : "";
const TOC_TEMPLATE = TOC_SOURCE.slice(0, TOC_SOURCE.indexOf("<script setup"));
const TOC_STYLES = [
  ...TOC_SOURCE.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g),
]
  .map((match) => match[1])
  .join("\n");
const TYPES_SOURCE = existsSync(TYPES_PATH)
  ? readFileSync(TYPES_PATH, "utf8")
  : "";

function cssRule(styles: string, selector: string): string {
  return styles.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

const stubs = {
  ElContainer: passthrough,
  ElAside: passthrough,
  ElMain: passthrough,
  ElCard: passthrough,
  ElMenu: passthrough,
  ElMenuItem: passthrough,
  ElSubMenu: passthrough,
  ElDialog: passthrough,
  ElButton: passthrough,
  ElDropdown: passthrough,
  ElDropdownMenu: passthrough,
  ElDropdownItem: passthrough,
};

function render(
  references: unknown[],
  extraProps: Record<string, unknown> = {}
) {
  return mount(DeepGenomeResultViewer, {
    props: { markdown: "", references, ...extraProps },
    global: { stubs, mocks: { $t: (key: string) => key } },
  });
}

function renderMarkdown(markdown: string) {
  return mount(DeepGenomeResultViewer, {
    props: { markdown, references: [] },
    global: { stubs, mocks: { $t: (key: string) => key } },
  });
}

describe("DeepGenomeResultViewer — embedded renderer boundary", () => {
  it("always renders an embedded root without owning the viewport or page surface", () => {
    const wrapper = render([]);
    const root = wrapper.find('[data-testid="deep-genome-viewer"]');

    expect(root.element.tagName).toBe("DIV");
    expect(VIEWER_TEMPLATE).not.toContain("<el-container");
    expect(VIEWER_STYLES).not.toMatch(/100(?:d|s|l)?vh/);
    expect(VIEWER_STYLES).not.toContain("var(--phy-color-bg-page)");
    expect(cssRule(VIEWER_STYLES, "\\.deep-genome-viewer")).not.toMatch(
      /\boverflow\b/
    );
  });

  it("keeps the legacy embedded prop inert while compatibility actions and references default on", () => {
    const compatible = render([]);
    expect(compatible.props("embedded")).toBe(false);
    expect(compatible.props("showActions")).toBe(true);
    expect(compatible.props("showReferences")).toBe(true);
    expect(
      compatible.find('[data-testid="deep-genome-toolbar"]').exists()
    ).toBe(true);
    expect(compatible.find(".deep-genome-references").exists()).toBe(true);

    const composed = render([], {
      embedded: true,
      showActions: false,
      showReferences: false,
    });
    expect(composed.find('[data-testid="deep-genome-toolbar"]').exists()).toBe(
      false
    );
    expect(composed.find(".deep-genome-references").exists()).toBe(false);
    expect(
      composed.find('[data-testid="deep-genome-viewer"]').classes()
    ).not.toContain("deep-genome-viewer--embedded");
  });

  it("uses semantic hooks instead of hard-coded or dynamic inline layout styles", () => {
    expect(VIEWER_TEMPLATE).toContain('class="deep-genome-viewer"');
    expect(VIEWER_TEMPLATE).toContain("<DeepGenomeToc");
    expect(VIEWER_TEMPLATE).toContain('class="deep-genome-main"');
    expect(VIEWER_TEMPLATE).toContain('class="deep-genome-toolbar"');
    expect(VIEWER_TEMPLATE).not.toMatch(/\b:?style\s*=/);
    expect(TOC_TEMPLATE).not.toMatch(/\b:?style\s*=/);
    expect(VIEWER_TEMPLATE).not.toContain('width="400px"');
  });

  it("extracts an exact 232px desktop TOC that becomes a collapsed disclosure at 899px", () => {
    expect(TOC_SOURCE).not.toBe("");
    expect(TOC_TEMPLATE).toContain("<details");
    expect(TOC_TEMPLATE).toContain("<summary");
    expect(TOC_TEMPLATE).toContain(':open="disclosureOpen"');
    expect(TOC_SOURCE).toContain("const disclosureOpen = ref(false)");
    expect(TOC_SOURCE).toContain('window.matchMedia("(min-width: 900px)")');
    expect(TOC_STYLES).toMatch(
      /\.deep-genome-toc\s*\{[\s\S]*width:\s*232px[\s\S]*flex:\s*0 0 232px/
    );
    expect(TOC_STYLES).toMatch(
      /@media\s*\(max-width:\s*899px\)[\s\S]*\.deep-genome-toc\s*\{[\s\S]*width:\s*100%/
    );
    expect(VIEWER_STYLES).toMatch(
      /@media\s*\(max-width:\s*899px\)[\s\S]*\.deep-genome-viewer\s*\{[\s\S]*flex-direction:\s*column/
    );
  });

  it("exports and exposes one typed download facade that delegates to the existing methods", () => {
    const wrapper = render([]);

    expect(TYPES_SOURCE).toMatch(
      /export type DeepGenomeDownloadFormat\s*=\s*"pdf"\s*\|\s*"markdown"/
    );
    expect(TYPES_SOURCE).toMatch(
      /export interface DeepGenomeViewerHandle\s*\{[\s\S]*download\(format:\s*DeepGenomeDownloadFormat\):\s*Promise<void>/
    );
    expect(wrapper.vm).toHaveProperty("download");
    expect(VIEWER_SOURCE).toMatch(
      /defineExpose(?:<DeepGenomeViewerHandle>)?\(\{\s*download\s*\}\)/
    );
    expect(VIEWER_SOURCE).toMatch(
      /const download[\s\S]*format === "pdf"[\s\S]*downloadPDF\(\)[\s\S]*downloadMarkdown\(\)/
    );
  });

  it("preserves exactly the thirteen trusted HTML sinks across document, TOC, and references", () => {
    const sinkCount =
      (VIEWER_TEMPLATE.match(/\bv-html\s*=/g) ?? []).length +
      (TOC_TEMPLATE.match(/\bv-html\s*=/g) ?? []).length;

    expect(sinkCount).toBe(13);
    expect(VIEWER_TEMPLATE).toContain('v-html="ref.html"');
    expect(VIEWER_SOURCE).toContain(
      "buildDisplayReferences(props.references, props.ns)"
    );
  });
});

describe("DeepGenomeResultViewer — scientific document skin", () => {
  it("renders semantic document sections instead of an Element Plus card wall", async () => {
    const wrapper = renderMarkdown(
      "# Rice locus report\\n" +
        "Executive summary.\\n" +
        "## Evidence\\n" +
        "Section overview.\\n" +
        "### Expression\\n" +
        "Expression evidence."
    );
    await nextTick();
    await nextTick();

    expect(wrapper.find("article.deep-genome-document").exists()).toBe(true);
    expect(wrapper.find(".deep-genome-title").text()).toBe("Rice locus report");
    expect(wrapper.find(".deep-genome-heading--section").text()).toBe(
      "Evidence"
    );
    expect(wrapper.find("section.deep-genome-section").exists()).toBe(true);
    expect(wrapper.find(".deep-genome-section-body").text()).toContain(
      "Expression evidence."
    );
    expect(VIEWER_TEMPLATE).not.toContain("<el-card");
    expect(VIEWER_TEMPLATE).not.toContain('shadow="hover"');
  });

  it("localizes the references heading and empty state in both locale packs", () => {
    expect(VIEWER_TEMPLATE).toContain('$t("agents.deepGenome.references")');
    expect(VIEWER_TEMPLATE).toContain('$t("agents.deepGenome.noReferences")');
    expect(VIEWER_TEMPLATE).not.toContain("<h2>References</h2>");
    expect(VIEWER_TEMPLATE).not.toContain("No references available.");
    expect(enUS.agents.deepGenome.references).toBe("References");
    expect(enUS.agents.deepGenome.noReferences).toBe(
      "No references available."
    );
    expect(zhCN.agents.deepGenome.references).toBe("参考文献");
    expect(zhCN.agents.deepGenome.noReferences).toBe("暂无参考文献。");
  });

  it("uses only design tokens for the scoped color and surface skin", () => {
    expect(VIEWER_STYLES).toMatch(/var\(--phy-color-text\)/);
    expect(VIEWER_STYLES).toMatch(/var\(--phy-color-text-secondary\)/);
    expect(VIEWER_STYLES).toMatch(/var\(--phy-color-fill-subtle\)/);
    expect(VIEWER_STYLES).toMatch(/var\(--phy-color-border-subtle\)/);
    expect(VIEWER_STYLES).toMatch(/var\(--phy-color-action-text\)/);
    expect(VIEWER_STYLES).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(VIEWER_STYLES).not.toMatch(/rgba?\(/i);
    expect(VIEWER_STYLES).not.toMatch(/box-shadow\s*:/);
    expect(VIEWER_STYLES).not.toMatch(/transform:\s*translateY/);
    expect(VIEWER_STYLES).not.toMatch(/transition:\s*all/);
    expect(VIEWER_STYLES).not.toMatch(/\.theme-dark/);
  });

  it("gives the document a restrained scientific heading hierarchy", () => {
    expect(VIEWER_STYLES).toMatch(
      /\.deep-genome-title\s*\{[\s\S]*font-family:\s*var\(--phy-font-shell\)[\s\S]*font-size:\s*clamp\(/
    );
    expect(VIEWER_STYLES).toMatch(
      /\.deep-genome-heading--section\s*\{[\s\S]*border-bottom:\s*1px solid var\(--phy-color-border-subtle\)/
    );
    expect(VIEWER_STYLES).toMatch(
      /\.deep-genome-section-title\s*\{[\s\S]*font-size:\s*18px/
    );
    expect(VIEWER_STYLES).toMatch(
      /\.deep-genome-document\s*\{[\s\S]*max-width:\s*var\(--phy-layout-reading-max-width\)/
    );
  });

  it("keeps tables as the only local horizontal scroll surface", () => {
    expect(cssRule(VIEWER_STYLES, "\\.deep-genome-viewer")).not.toMatch(
      /overflow-x:\s*auto/
    );
    expect(cssRule(VIEWER_STYLES, "\\.deep-genome-main")).not.toMatch(
      /overflow-x:\s*auto/
    );
    expect(VIEWER_STYLES).toMatch(
      /\.deep-genome-document\s+:deep\(\.markdown-table\)\s*\{[\s\S]*display:\s*block[\s\S]*max-width:\s*100%[\s\S]*overflow-x:\s*auto/
    );
    expect(VIEWER_STYLES).toMatch(/overscroll-behavior-inline:\s*contain/);
  });

  it("uses quiet tokenized TOC and toolbar states", () => {
    expect(TOC_STYLES).toMatch(
      /\.deep-genome-toc\s+:deep\(\.el-menu-item\.is-active\)[\s\S]*background(?:-color)?:\s*var\(--phy-color-brand-blue-soft\)/
    );
    expect(TOC_STYLES).toMatch(
      /\.deep-genome-toc\s+:deep\(\.el-menu-item:hover\)[\s\S]*background(?:-color)?:\s*var\(--phy-color-fill-subtle\)/
    );
    expect(VIEWER_TEMPLATE).toMatch(
      /class="deep-genome-toolbar-button"[\s\S]*?plain/
    );
    expect(VIEWER_STYLES).toMatch(
      /\.deep-genome-toolbar-button[\s\S]*color:\s*var\(--phy-color-action-text\)/
    );
  });

  it("renders references and generated media as divider-led document sections", () => {
    expect(VIEWER_TEMPLATE).toContain('class="deep-genome-references"');
    expect(VIEWER_TEMPLATE).toContain('class="deep-genome-reference"');
    expect(VIEWER_TEMPLATE).toContain('class="deep-genome-empty-references"');
    expect(VIEWER_STYLES).toMatch(
      /\.deep-genome-references\s*\{[\s\S]*border-top:\s*1px solid var\(--phy-color-border-subtle\)/
    );
    expect(VIEWER_STYLES).toMatch(
      /\.deep-genome-document\s+:deep\(\.image-card\)\s*\{[\s\S]*border:\s*0/
    );
    expect(cssRule(VIEWER_STYLES, "\\.deep-genome-references")).not.toMatch(
      /background\s*:/
    );
  });
});

describe("DeepGenomeResultViewer — scoped responsive media viewers", () => {
  it("scopes CIF and clickable-image setup to this viewer document root", () => {
    expect(VIEWER_TEMPLATE).toMatch(
      /<article\b[^>]*class="deep-genome-document phy-reading"[^>]*ref="documentRef"/
    );
    expect(VIEWER_SOURCE).toContain("documentRef.value?.querySelectorAll(");
    expect(VIEWER_SOURCE).toContain(
      "setupImageClickListeners(documentRef.value)"
    );
    expect(VIEWER_SOURCE).not.toMatch(
      /document\.querySelectorAll\([\s\S]*?cif-container/
    );
  });

  it("cleans up owned image listeners when the component unmounts", () => {
    expect(VIEWER_SOURCE).toContain("onBeforeUnmount");
    expect(VIEWER_SOURCE).toContain("cleanupImageClickListeners");
    expect(VIEWER_SOURCE).toMatch(
      /onBeforeUnmount\(\(\)\s*=>\s*\{[\s\S]*cleanupImageClickListeners\(\)/
    );
  });

  it("renders CIF failures as text instead of interpolated HTML", () => {
    expect(VIEWER_SOURCE).toContain("errorNode.textContent = message");
    expect(VIEWER_SOURCE).not.toMatch(/\.innerHTML\s*=\s*`<div class="error">/);
  });

  it("cancels CIF work and releases active viewers on unmount", () => {
    expect(VIEWER_SOURCE).toContain("new AbortController()");
    expect(VIEWER_SOURCE).toContain("controller.abort()");
    expect(VIEWER_SOURCE).toContain("viewer.stopAnimate?.()");
    expect(VIEWER_SOURCE).toContain("viewer.clear?.()");
  });

  it("cancels delayed scroll-spy setup before unmount cleanup finishes", () => {
    expect(VIEWER_SOURCE).toMatch(
      /observerSetupTimer\s*=\s*window\.setTimeout\([\s\S]*setupIntersectionObserver/
    );
    expect(VIEWER_SOURCE).toMatch(
      /onBeforeUnmount\(\(\)\s*=>\s*\{[\s\S]*window\.clearTimeout\(observerSetupTimer\)/
    );
  });

  it("uses a semantic responsive class instead of fixed CIF inline dimensions", () => {
    expect(VIEWER_SOURCE).toContain(
      'viewerDiv.className = "deep-genome-cif-viewer"'
    );
    expect(VIEWER_SOURCE).not.toContain('viewerDiv.style.width = "100%"');
    expect(VIEWER_SOURCE).not.toContain('viewerDiv.style.height = "600px"');
    expect(VIEWER_STYLES).toMatch(
      /\.deep-genome-document\s+:deep\(\.deep-genome-cif-viewer\)\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*clamp\([\s\S]*var\(--phy-space-64\)/
    );
  });

  it("keeps the image dialog inside viewport gutters with a CSS-owned height", () => {
    expect(VIEWER_TEMPLATE).toContain(
      'width="min(800px, calc(100vw - var(--phy-space-32)))"'
    );
    expect(VIEWER_TEMPLATE).not.toMatch(
      /<div\b(?=[^>]*class="image-view-container")[^>]*\bstyle\s*=/
    );
    expect(VIEWER_STYLES).toMatch(
      /\.image-view-container\s*\{[\s\S]*height:\s*clamp\([\s\S]*var\(--phy-space-64\)[\s\S]*overflow:\s*hidden/
    );
  });
});

describe("DeepGenomeResultViewer — reference text-field XSS hardening", () => {
  it("escapes a raw tag in the title-only reference branch", () => {
    const w = render([{ title: '<img src=x onerror="alert(1)">' }]);
    const ref = w.find("#ref-1");
    expect(ref.exists()).toBe(true);
    expect(ref.find("img").exists()).toBe(false);
    expect(ref.html()).toContain("&lt;img");
  });

  it("escapes a raw tag smuggled through the citation author field", () => {
    const w = render([
      { au: '<img src=x onerror="alert(2)">', ti: "Title", so: "Nature" },
    ]);
    const ref = w.find("#ref-1");
    expect(ref.find("img").exists()).toBe(false);
  });

  it("escapes a plain-string reference", () => {
    const w = render(["<svg onload=alert(3)>"]);
    const ref = w.find("#ref-1");
    expect(ref.find("svg").exists()).toBe(false);
    expect(ref.html()).toContain("&lt;svg");
  });

  it("still renders a real, scheme-checked DOI anchor for a benign citation", () => {
    const w = render([
      {
        au: "Smith J",
        ti: "Gene study",
        so: "Nature",
        py: 2020,
        dl: "https://doi.org/10.1/x",
      },
    ]);
    const ref = w.find("#ref-1");
    const a = ref.find("a.doi-link");
    expect(a.exists()).toBe(true);
    expect(a.attributes("href")).toBe("https://doi.org/10.1/x");
  });
});

// The image-caption path feeds the first non-empty line after an image into
// processInlineMarkdown and on into a v-html sink. The caption text comes from
// props.markdown (agent/RAG output, attacker-influenceable), so it MUST be
// escapeHtml'd first like every other block path. convertMarkdown splits the
// prop on the literal two-char sequence "\n", so the input below uses literal
// backslash-n separators. A leading "## " puts the image card into a
// standalone-content block that renders through v-html.
describe("DeepGenomeResultViewer — image-caption XSS hardening", () => {
  it("escapes a raw <img onerror> smuggled into an image caption", async () => {
    const markdown =
      "## Figure section\\n" +
      "![fig](https://example.com/a.png)\\n" +
      '<img src=x onerror="window.__xss__=1">';

    const w = renderMarkdown(markdown);
    await nextTick();
    await nextTick();

    const html = w.html();
    // The caption block must render the raw tag as inert, escaped text.
    expect(html).toContain("&lt;img");
    // And there must be no live <img onerror> element from the caption.
    const captionImg = w
      .findAll("img")
      .find((el) => el.attributes("onerror") !== undefined);
    expect(captionImg).toBeUndefined();
  });

  it("still renders legitimate **bold** markdown in an image caption", async () => {
    const markdown =
      "## Figure section\\n" +
      "![fig](https://example.com/a.png)\\n" +
      "**Bold caption**";

    const w = renderMarkdown(markdown);
    await nextTick();
    await nextTick();

    expect(w.find("strong").exists()).toBe(true);
    expect(w.find("strong").text()).toBe("Bold caption");
  });
});
