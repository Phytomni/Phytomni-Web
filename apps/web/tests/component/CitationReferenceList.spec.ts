import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import CitationReferenceList from "@/components/CitationReferenceList.vue";

const CITATION_LIST_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/CitationReferenceList.vue"),
  "utf8"
);

const mountList = (props: Record<string, unknown>) =>
  mount(CitationReferenceList, {
    props,
    global: {
      mocks: {
        $t: (key: string) => key,
      },
    },
  });

describe("CitationReferenceList", () => {
  it("keeps long citation titles within the reference-list container", () => {
    expect(CITATION_LIST_SOURCE).toContain("min-width: 0;");
    expect(CITATION_LIST_SOURCE).toContain("max-width: 100%;");
    expect(CITATION_LIST_SOURCE).toContain("overflow-wrap: anywhere;");
  });

  it("renders one safe row per buildDisplayReferences output with namespaced ids", () => {
    const wrapper = mountList({
      references: [{ title: "Doc A" }, { au: "Smith", ti: "T", so: "Nature" }],
      ns: "m3",
    });
    const rows = wrapper.findAll(".doc-list-item");
    expect(rows).toHaveLength(2);
    expect(rows[0].attributes("id")).toBe("m3-ref-1");
    expect(rows[1].attributes("id")).toBe("m3-ref-2");
    expect(wrapper.html()).toContain("Doc A");
    expect(wrapper.html()).toContain("Smith");
  });

  it("renders nothing when references are empty or absent", () => {
    expect(
      mountList({ references: [], ns: "m0" }).find(".doc-list").exists()
    ).toBe(false);
    expect(mountList({ ns: "m0" }).find(".doc-list").exists()).toBe(false);
  });

  it("escapes malicious title/DOI through buildDisplayReferences only (no raw HTML)", () => {
    const wrapper = mountList({
      references: [
        {
          title: '<img src=x onerror="alert(1)">',
          dl: 'javascript:alert(1)"onmouseover="alert(2)',
        },
      ],
      ns: "m1",
    });
    const html = wrapper.html();
    // Escaped text may still contain the characters "onerror="; the live tag must not.
    expect(html).not.toMatch(/<img\b/i);
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/<a[^>]+javascript:/i);
    expect(html).not.toMatch(/\sonmouseover=/i);
  });

  it("renders malformed and partially populated references without throwing", () => {
    const wrapper = mountList({
      references: [null, 42, { au: null, title: "Fallback" }],
      ns: "m2",
    });

    expect(wrapper.findAll(".doc-list-item")).toHaveLength(3);
    expect(wrapper.text()).toContain("Fallback");
    expect(wrapper.html()).not.toContain("undefined");
  });

  it("gives two lists with different ns disjoint DOM ids", () => {
    const a = mountList({ references: [{ title: "A" }], ns: "m0" });
    const b = mountList({ references: [{ title: "B" }], ns: "m1" });
    expect(a.find(".doc-list-item").attributes("id")).toBe("m0-ref-1");
    expect(b.find(".doc-list-item").attributes("id")).toBe("m1-ref-1");
  });
});
