import { beforeEach, describe, expect, it, vi } from "vitest";
import { config, flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computed,
  defineComponent,
  h,
  inject,
  nextTick,
  provide,
  type ComputedRef,
  type InjectionKey,
} from "vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const mocks = vi.hoisted(() => ({
  getGeneList: vi.fn(),
}));

vi.mock("@/api/gene-display", () => ({
  getGeneList: mocks.getGeneList,
}));

import GeneDisplay from "@/views/gene-display/GeneDisplayView.vue";

const GENE_DISPLAY_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/gene-display/GeneDisplayView.vue"),
  "utf8"
);

const rows = [
  {
    id: 1,
    species_code: "osa",
    gene_id: "Os01g0177400",
    file_name: "Os01g0177400.md",
  },
  {
    id: 2,
    species_code: "zma",
    gene_id: "Zm00001eb122500",
    file_name: "Zm00001eb122500.md",
  },
];

const successResponse = {
  code: 200,
  message: "ok",
  data: {
    gene_list: rows,
    total: rows.length,
    total_pages: 1,
  },
};

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

config.global.plugins = [i18n];

type Row = Record<string, unknown>;
const tableDataKey: InjectionKey<ComputedRef<Row[]>> = Symbol("table-data");

// Element Plus's table MutationObserver currently trips happy-dom's private
// fields. Keep the UI-library boundary thin while rendering the page-owned
// scoped slots and forwarding the public v-model/event contracts under test.
const ElInputStub = defineComponent({
  name: "ElInput",
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" }, placeholder: String },
  emits: ["update:modelValue", "keyup"],
  setup(props, { attrs, emit, slots }) {
    return () => {
      const { class: className, ...inputAttrs } = attrs;
      return h("div", { class: ["el-input", className] }, [
        h("input", {
          ...inputAttrs,
          value: props.modelValue,
          placeholder: props.placeholder,
          onInput: (event: Event) =>
            emit("update:modelValue", (event.target as HTMLInputElement).value),
          onKeyup: (event: KeyboardEvent) => emit("keyup", event),
        }),
        slots.append?.(),
      ]);
    };
  },
});

const ElButtonStub = defineComponent({
  name: "ElButton",
  inheritAttrs: false,
  emits: ["click"],
  setup(_, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: "button",
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default?.()
      );
  },
});

const ElTableStub = defineComponent({
  name: "ElTable",
  props: { data: { type: Array as () => Row[], default: () => [] } },
  setup(props, { slots }) {
    provide(
      tableDataKey,
      computed(() => props.data)
    );
    return () => h("div", { class: "el-table" }, slots.default?.());
  },
});

const ElTableColumnStub = defineComponent({
  name: "ElTableColumn",
  props: { prop: String, label: String, type: String },
  setup(props, { slots }) {
    const data = inject(
      tableDataKey,
      computed(() => [])
    );
    return () =>
      h("div", { class: "el-table-column", "data-label": props.label }, [
        h("span", { class: "el-table-column__label" }, props.label ?? ""),
        ...data.value.map((row, index) =>
          h(
            "div",
            { class: "el-table-cell" },
            slots.default?.({ row, $index: index }) ??
              String(
                props.type === "index"
                  ? index + 1
                  : (row[props.prop ?? ""] ?? "")
              )
          )
        ),
      ]);
  },
});

const ElPaginationStub = defineComponent({
  name: "ElPagination",
  props: {
    currentPage: Number,
    pageSize: Number,
    pageSizes: Array,
    layout: String,
    total: Number,
  },
  emits: [
    "update:currentPage",
    "update:pageSize",
    "current-change",
    "size-change",
  ],
  setup() {
    return () =>
      h("nav", { class: "el-pagination", "aria-label": "Pagination" });
  },
});

const mountView = () =>
  mount(GeneDisplay, {
    global: {
      stubs: {
        ElInput: ElInputStub,
        ElButton: ElButtonStub,
        ElTable: ElTableStub,
        ElTableColumn: ElTableColumnStub,
        ElPagination: ElPaginationStub,
      },
      directives: { loading: () => undefined },
    },
  });

describe("Gene Display workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGeneList.mockResolvedValue(successResponse);
  });

  it("keeps the table width bounded while its frame owns narrow-screen scrolling", () => {
    const tableStyleStart = GENE_DISPLAY_SOURCE.indexOf(".gene-table {");
    const tableStyleEnd = GENE_DISPLAY_SOURCE.indexOf("}", tableStyleStart);
    const tableStyle = GENE_DISPLAY_SOURCE.slice(
      tableStyleStart,
      tableStyleEnd + 1
    );

    expect(tableStyle).toContain("max-width: 100%;");
    expect(GENE_DISPLAY_SOURCE).toContain("<PhyTableFrame>");
  });

  it("loads the first page into the shared workspace and table frame", async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(mocks.getGeneList).toHaveBeenCalledWith({
      title: "",
      current: 1,
      size: 20,
    });
    expect(wrapper.find(".phy-workspace-shell").exists()).toBe(true);
    expect(wrapper.find(".phy-page-header h1").text()).toBe(
      "Deep Genome Database"
    );
    expect(wrapper.find(".phy-data-toolbar").exists()).toBe(true);
    expect(wrapper.find(".phy-table-frame").exists()).toBe(true);
    expect(wrapper.find(".phy-async-state--ready").exists()).toBe(true);
    expect(wrapper.text()).toContain("Os01g0177400");
    expect(wrapper.findAll(".table-header-cell")).toHaveLength(0);
  });

  it("labels the search field and gives its icon button an accessible name", async () => {
    const wrapper = mountView();
    await flushPromises();

    const label = wrapper.get("label.gene-search-label");
    const input = wrapper.get("#gene-display-search");
    const button = wrapper.get("button.gene-search-button");

    expect(label.attributes("for")).toBe("gene-display-search");
    expect(input.attributes("aria-label")).toBe(
      "Please enter species or gene to search"
    );
    expect(button.attributes("aria-label")).toBe(
      "Please enter species or gene to search"
    );
  });

  it("shows the fetched result count in the data toolbar", async () => {
    const wrapper = mountView();
    await flushPromises();

    const results = wrapper.get(".gene-results-count");
    expect(results.attributes("aria-live")).toBe("polite");
    expect(results.text()).toBe("2 results");
  });

  it("searches on Enter and resets the current page to one", async () => {
    const wrapper = mountView();
    await flushPromises();

    const pagination = wrapper.findComponent({ name: "ElPagination" });
    pagination.vm.$emit("current-change", 3);
    await flushPromises();

    mocks.getGeneList.mockClear();
    const input = wrapper.get("#gene-display-search");
    await input.setValue("rice");
    await input.trigger("keyup.enter");
    await flushPromises();

    expect(mocks.getGeneList).toHaveBeenCalledTimes(1);
    expect(mocks.getGeneList).toHaveBeenCalledWith({
      title: "rice",
      current: 1,
      size: 20,
    });
  });

  it("searches from the named search button", async () => {
    const wrapper = mountView();
    await flushPromises();
    mocks.getGeneList.mockClear();

    await wrapper.get("#gene-display-search").setValue("maize");
    await wrapper.get("button.gene-search-button").trigger("click");
    await flushPromises();

    expect(mocks.getGeneList).toHaveBeenCalledWith({
      title: "maize",
      current: 1,
      size: 20,
    });
  });

  it("refetches with unchanged API parameters for page and page-size changes", async () => {
    const wrapper = mountView();
    await flushPromises();
    mocks.getGeneList.mockClear();

    const pagination = wrapper.findComponent({ name: "ElPagination" });
    pagination.vm.$emit("current-change", 2);
    await flushPromises();
    wrapper.findComponent({ name: "ElPagination" }).vm.$emit("size-change", 50);
    await flushPromises();

    expect(mocks.getGeneList).toHaveBeenNthCalledWith(1, {
      title: "",
      current: 2,
      size: 20,
    });
    expect(mocks.getGeneList).toHaveBeenNthCalledWith(2, {
      title: "",
      current: 2,
      size: 50,
    });
  });

  it("shows a polite loading state before the request resolves", async () => {
    let resolveRequest: (value: typeof successResponse) => void = () =>
      undefined;
    mocks.getGeneList.mockReturnValue(
      new Promise<typeof successResponse>((resolve) => {
        resolveRequest = resolve;
      })
    );

    const wrapper = mountView();
    await nextTick();

    expect(wrapper.get(".phy-async-state").attributes("aria-busy")).toBe(
      "true"
    );
    expect(wrapper.find(".phy-skeleton").exists()).toBe(true);

    resolveRequest(successResponse);
    await flushPromises();
    expect(wrapper.find(".phy-async-state--ready").exists()).toBe(true);
  });

  it("shows the shared empty state for an empty successful response", async () => {
    mocks.getGeneList.mockResolvedValue({
      ...successResponse,
      data: { gene_list: [], total: 0, total_pages: 0 },
    });

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find(".phy-async-state--empty").exists()).toBe(true);
    expect(wrapper.text()).toContain("No Data");
    expect(wrapper.find(".phy-table-frame").exists()).toBe(false);
  });

  it("shows an actionable error and retries the same query", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getGeneList
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(successResponse);

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find(".phy-async-state--error").exists()).toBe(true);
    const retry = wrapper.get(".phy-error-state__retry");
    expect(retry.text()).toBe("Retry");

    await retry.trigger("click");
    await flushPromises();

    expect(mocks.getGeneList).toHaveBeenCalledTimes(2);
    expect(mocks.getGeneList).toHaveBeenLastCalledWith({
      title: "",
      current: 1,
      size: 20,
    });
    expect(wrapper.find(".phy-async-state--ready").exists()).toBe(true);
  });

  it("opens one semantic primary gene identifier in the exact existing new-tab URL", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = mountView();
    await flushPromises();

    const primaryActions = wrapper.findAll("button.gene-primary-action");
    expect(primaryActions).toHaveLength(rows.length);
    expect(wrapper.findAll(".gene-species-action")).toHaveLength(0);

    await primaryActions[0].trigger("click");

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      "/gene-display/detail?file_name=Os01g0177400.md",
      "_blank"
    );
  });

  it("keeps horizontal table scrolling and pagination inside the table frame", async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(
      wrapper.findAll('.phy-table-frame [data-horizontal-scroll="table"]')
    ).toHaveLength(1);
    expect(
      wrapper.find(".phy-table-frame__pagination .el-pagination").exists()
    ).toBe(true);
    expect(wrapper.findAll('[data-horizontal-scroll="table"]')).toHaveLength(1);
  });
});
