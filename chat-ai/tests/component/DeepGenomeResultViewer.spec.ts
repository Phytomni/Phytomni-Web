import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";

// Locks the reference-renderer text fields. doc_list comes from the Bot
// `formatted.references` reshape (attacker-influenceable via agent output / RAG),
// and each reference is interpolated into ref.html and fed to v-html. The href
// parts are already scheme-checked; this pins the TEXT fields (title, citation
// au/so, plain-string and JSON fallbacks) so a raw tag can't reach the DOM.
const passthrough = { template: "<div><slot /></div>" };

function render(references: unknown[]) {
  return mount(DeepGenomeResultViewer, {
    props: { markdown: "", references },
    global: {
      stubs: {
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
      },
    },
  });
}

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
