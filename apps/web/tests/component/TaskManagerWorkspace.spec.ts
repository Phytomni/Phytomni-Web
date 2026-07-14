import { beforeEach, describe, expect, it, vi } from "vitest";
import { config, flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { computed, defineComponent, h, inject, provide, type ComputedRef, type InjectionKey } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import { datetimeFormats } from "@/locales/datetime-formats";
import { formatDisplayDate } from "@/locales/format-display-date";

const mocks = vi.hoisted(() => ({
  getTaskList: vi.fn(),
  getChatdownloadURL: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/api/task", () => ({ getTaskList: mocks.getTaskList }));
vi.mock("@/api/chat", () => ({ getChatdownloadURL: mocks.getChatdownloadURL }));
vi.mock("element-plus", () => ({ ElMessage: { error: mocks.error } }));

import TaskManager from "@/views/task-manager/index.vue";

type TaskRow = Record<string, unknown>;
const tableDataKey: InjectionKey<ComputedRef<TaskRow[]>> = Symbol("table-data");

const ElButtonStub = defineComponent({
  name: "ElButton",
  inheritAttrs: false,
  emits: ["click"],
  setup(_, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        { ...attrs, type: "button", onClick: (event: MouseEvent) => emit("click", event) },
        slots.default?.()
      );
  },
});

const ElTableStub = defineComponent({
  name: "ElTable",
  props: { data: { type: Array as () => TaskRow[], default: () => [] } },
  setup(props, { slots }) {
    provide(tableDataKey, computed(() => props.data));
    return () => h("div", { class: "el-table" }, slots.default?.());
  },
});

const ElTableColumnStub = defineComponent({
  name: "ElTableColumn",
  props: { prop: String, label: String, minWidth: [Number, String], width: [Number, String] },
  setup(props, { slots }) {
    const rows = inject(tableDataKey, computed(() => []));
    return () =>
      h("div", { class: "el-table-column", "data-label": props.label }, [
        h("span", { class: "el-table-column__label" }, props.label ?? ""),
        ...rows.value.map((row) =>
          h(
            "div",
            { class: "el-table-cell" },
            slots.default?.({ row }) ?? String(row[props.prop ?? ""] ?? "")
          )
        ),
      ]);
  },
});

const ElPaginationStub = defineComponent({
  name: "ElPagination",
  props: { currentPage: Number, pageSize: Number, pageSizes: Array, layout: String, total: Number },
  emits: ["update:currentPage", "update:pageSize", "current-change", "size-change"],
  setup() {
    return () => h("nav", { class: "el-pagination", "aria-label": "Pagination" });
  },
});

const ElTagStub = defineComponent({
  name: "ElTag",
  props: { type: String, effect: String },
  setup(props, { slots }) {
    return () => h("span", { class: "el-tag", "data-type": props.type }, slots.default?.());
  },
});

const stubs = {
  ElButton: ElButtonStub,
  ElTable: ElTableStub,
  ElTableColumn: ElTableColumnStub,
  ElPagination: ElPaginationStub,
  ElTag: ElTagStub,
  ElIcon: { template: "<span><slot /></span>" },
  ElSpace: { template: "<div><slot /></div>" },
};

config.global.plugins = [];

const rows = [
  {
    query: "Build a rice callpeak workflow",
    status: "SUCCEEDED",
    updated_at: "2026-07-09T15:30:45.000Z",
    dialogue_id: "dialogue-fallback",
    f_dialogue_id: "dialogue-preferred",
    download_path: "/obs/results.zip",
  },
  {
    query: "Summarize the failed workflow",
    status: "FAILED",
    updated_at: "2026-07-08T15:30:45.000Z",
    dialogue_id: "dialogue-fallback-only",
  },
  {
    query: "Track a running workflow",
    status: "RUNNING",
    updated_at: "2026-07-07T15:30:45.000Z",
    dialogue_id: "dialogue-running",
  },
];

const successResponse = {
  code: 200,
  message: "ok",
  data: { gene_list: rows, total: 31 },
};

const makeI18n = () =>
  createI18n({
    legacy: false,
    locale: "en-US",
    fallbackLocale: "en-US",
    messages: { "en-US": enUS, "zh-CN": zhCN },
    datetimeFormats,
  });

const mountView = () => {
  const i18n = makeI18n();
  return {
    i18n,
    wrapper: mount(TaskManager, {
      global: {
        plugins: [i18n],
        stubs,
        directives: { loading: () => undefined },
      },
    }),
  };
};

describe("Task Manager workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTaskList.mockResolvedValue(successResponse);
    mocks.getChatdownloadURL.mockResolvedValue({ code: 200, data: "https://signed.example/results.zip" });
  });

  it("loads once initially and refetches the unchanged request shape on page changes without polling", async () => {
    const setInterval = vi.spyOn(window, "setInterval");
    const { wrapper } = mountView();
    await flushPromises();

    expect(mocks.getTaskList).toHaveBeenCalledTimes(1);
    expect(mocks.getTaskList).toHaveBeenCalledWith({ current: 1, size: 10 });
    expect(setInterval).not.toHaveBeenCalled();
    expect(wrapper.find(".phy-workspace-shell").exists()).toBe(true);
    expect(wrapper.find(".phy-page-header h1").text()).toBe("Task Management");
    expect(wrapper.find(".phy-data-toolbar").exists()).toBe(true);
    expect(wrapper.find(".phy-table-frame").exists()).toBe(true);
    expect(wrapper.find(".phy-async-state--ready").exists()).toBe(true);

    const pagination = wrapper.findComponent({ name: "ElPagination" });
    pagination.vm.$emit("current-change", 2);
    await flushPromises();
    wrapper.findComponent({ name: "ElPagination" }).vm.$emit("size-change", 50);
    await flushPromises();

    expect(mocks.getTaskList).toHaveBeenNthCalledWith(2, { current: 2, size: 10 });
    expect(mocks.getTaskList).toHaveBeenNthCalledWith(3, { current: 2, size: 50 });
  });

  it("renders semantic statuses, signed downloads, and the preferred dialogue target", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { wrapper } = mountView();
    await flushPromises();

    expect(wrapper.findAll(".task-status-badge").map((badge) => badge.text())).toEqual([
      "Finished",
      "Failed",
      "Running",
    ]);
    expect(wrapper.findAll("button.task-download-action")).toHaveLength(1);

    await wrapper.get("button.task-download-action").trigger("click");
    expect(mocks.getChatdownloadURL).toHaveBeenCalledWith({ obs_path: "/obs/results.zip" });
    expect(open).toHaveBeenCalledWith(
      "https://signed.example/results.zip",
      "_blank",
      "noopener,noreferrer"
    );

    await wrapper.findAll("button.task-dialogue-action")[0].trigger("click");
    await wrapper.findAll("button.task-dialogue-action")[1].trigger("click");
    expect(open).toHaveBeenNthCalledWith(2, "/chat?dialogue_id=dialogue-preferred", "_blank");
    expect(open).toHaveBeenNthCalledWith(3, "/chat?dialogue_id=dialogue-fallback-only", "_blank");
  });

  it("shows retryable error state and preserves raw date values for locale reformatting", async () => {
    mocks.getTaskList
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(successResponse);
    const { i18n, wrapper } = mountView();
    await flushPromises();

    expect(wrapper.find(".phy-async-state--error").exists()).toBe(true);
    await wrapper.get(".phy-error-state__retry").trigger("click");
    await flushPromises();
    expect(mocks.getTaskList).toHaveBeenCalledTimes(2);

    const englishDate = wrapper.get(".task-updated-at").text();
    expect(englishDate).toBe(
      formatDisplayDate(i18n.global.d, rows[0].updated_at, "date")
    );
    i18n.global.locale.value = "zh-CN";
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".task-updated-at").text()).toBe(
      formatDisplayDate(i18n.global.d, rows[0].updated_at, "date")
    );
    expect(wrapper.get(".task-updated-at").text()).not.toBe(englishDate);
  });

  it("keeps the table horizontally scrollable and does not log task data or paths", async () => {
    const { wrapper } = mountView();
    await flushPromises();

    expect(wrapper.findAll('[data-horizontal-scroll="table"]')).toHaveLength(1);
    expect(wrapper.find(".phy-table-frame__pagination .el-pagination").exists()).toBe(true);

    const source = readFileSync(
      resolve(__dirname, "../../src/views/task-manager/index.vue"),
      "utf8"
    );
    expect(source).not.toMatch(/console\.(?:log|info|debug)\(/);
    expect(source).not.toMatch(/console\.error\([^\n]*(?:download_path|f_dialogue_id|dialogue_id|query)/);
  });
});
