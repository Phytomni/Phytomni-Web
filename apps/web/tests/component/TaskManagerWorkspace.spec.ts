import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import {
  computed,
  defineComponent,
  h,
  inject,
  provide,
  type ComputedRef,
  type InjectionKey,
} from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTestAppContext } from "../helpers/test-app-context";

const mocks = vi.hoisted(() => ({
  getTaskList: vi.fn(),
  getChatdownloadURL: vi.fn(),
  error: vi.fn(),
  lifecycleOptions: undefined as
    | {
        maxConcurrent?: number;
        onSnapshot?: (...args: unknown[]) => void | Promise<void>;
      }
    | undefined,
  lifecycleSnapshots: undefined as unknown as {
    value: Record<string, Record<string, unknown>>;
  },
  watchRow: vi.fn(),
  unwatchRow: vi.fn(),
  disposeLifecycle: vi.fn(),
}));

vi.mock("@/api/task", () => ({ getTaskList: mocks.getTaskList }));
vi.mock("@/api/chat", () => ({ getChatdownloadURL: mocks.getChatdownloadURL }));
vi.mock("@/views/chat/composables/useAgentRunLifecycle", async () => {
  const { ref } = await vi.importActual<typeof import("vue")>("vue");
  mocks.lifecycleSnapshots = ref({});
  return {
    useAgentRunLifecycle: vi.fn((options) => {
      mocks.lifecycleOptions = options;
      return {
        snapshots: mocks.lifecycleSnapshots,
        watchRow: mocks.watchRow,
        unwatchRow: mocks.unwatchRow,
        pollNow: vi.fn(),
        dispose: mocks.disposeLifecycle,
      };
    }),
  };
});
vi.mock("element-plus", async () => {
  const actual =
    await vi.importActual<typeof import("element-plus")>("element-plus");
  return { ...actual, ElMessage: { error: mocks.error } };
});

import TaskManager from "@/views/task-manager/TaskManagerView.vue";

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
  props: { data: { type: Array as () => TaskRow[], default: () => [] } },
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
  props: {
    prop: String,
    label: String,
    minWidth: [Number, String],
    width: [Number, String],
  },
  setup(props, { slots }) {
    const rows = inject(
      tableDataKey,
      computed(() => [])
    );
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

const ElTagStub = defineComponent({
  name: "ElTag",
  props: { type: String, effect: String },
  setup(props, { slots }) {
    return () =>
      h(
        "span",
        { class: "el-tag", "data-type": props.type },
        slots.default?.()
      );
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

const rows = [
  {
    id: 11,
    query: "Build a rice callpeak workflow",
    status: "SUCCEEDED",
    tool_name: "AnalystAgent",
    updated_at: "2026-07-09T15:30:45",
    dialogue_id: "dialogue-fallback",
    f_dialogue_id: "dialogue-preferred",
    download_path: "/obs/results.zip",
  },
  {
    id: 12,
    query: "Summarize the failed workflow",
    status: "FAILED",
    tool_name: "InSilicoResearchAgent",
    updated_at: "2026-07-08T15:30:45",
    dialogue_id: "dialogue-fallback-only",
  },
  {
    id: 13,
    query: "Track a running workflow",
    status: "RUNNING",
    tool_name: "GeneNetworkAgent",
    updated_at: "2026-07-07T15:30:45",
    dialogue_id: "dialogue-running",
  },
];

const successResponse = {
  code: 200,
  message: "ok",
  data: { gene_list: rows, total: 31 },
};

const terminalLifecycle = {
  id: 13,
  phase: "SUCCEEDED",
  terminal: true,
  child_task_count: 1,
  child_work_accepted: true,
  report_revision: 2,
  artifact_summary: {
    image_count: 0,
    output_directory_count: 0,
    has_report: true,
  },
  reconciliation: "EXACT",
  tracking_degraded: false,
  error_code: null,
};

const mountView = () => {
  const context = createTestAppContext();
  return {
    i18n: context.i18n,
    wrapper: context.mount(TaskManager, {
      global: {
        stubs,
      },
    }),
  };
};

describe("Task Manager workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lifecycleOptions = undefined;
    mocks.lifecycleSnapshots.value = {};
    mocks.getTaskList.mockResolvedValue(successResponse);
    mocks.getChatdownloadURL.mockResolvedValue({
      code: 200,
      data: "https://signed.example/results.zip",
    });
  });

  it("watches only positive current-page background rows with three-way concurrency", async () => {
    mocks.getTaskList.mockResolvedValueOnce({
      code: 200,
      data: {
        total: 9,
        gene_list: [
          { id: 1, status: "RUNNING", tool_name: "AnalystAgent" },
          {
            id: 2,
            status: "PREPARING",
            tool_name: "InSilicoResearchAgent",
          },
          { id: 3, status: "RUNNING", tool_name: "GeneNetworkAgent" },
          { id: 4, status: "PENDING", tool_name: "DigitalDesignAgent" },
          { id: 5, status: "SUCCEEDED", tool_name: "AnalystAgent" },
          { status: "RUNNING", tool_name: "AnalystAgent" },
          { id: 0, status: "RUNNING", tool_name: "AnalystAgent" },
          { id: 6, status: "RUNNING", tool_name: "ChatAgent" },
          { id: -7, status: "RUNNING", tool_name: "GeneNetworkAgent" },
        ],
      },
    });

    mountView();
    await flushPromises();

    expect(mocks.lifecycleOptions?.maxConcurrent).toBe(3);
    expect(mocks.watchRow.mock.calls.map(([rowId]) => rowId)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("overrides stale status labels from lifecycle snapshots without changing row actions", async () => {
    const { wrapper } = mountView();
    await flushPromises();

    mocks.lifecycleSnapshots.value = {
      "13": terminalLifecycle,
    };
    await wrapper.vm.$nextTick();

    expect(
      wrapper.findAll(".task-status-badge").map((badge) => badge.text())
    ).toEqual(["Finished", "Failed", "Finished"]);
    expect(wrapper.findAll("button.task-download-action")).toHaveLength(1);
  });

  it("coalesces lifecycle refreshes while a task-list request is active", async () => {
    let resolveRefresh: ((value: typeof successResponse) => void) | undefined;
    const pendingRefresh = new Promise<typeof successResponse>((resolve) => {
      resolveRefresh = resolve;
    });
    mocks.getTaskList
      .mockResolvedValueOnce(successResponse)
      .mockReturnValueOnce(pendingRefresh)
      .mockResolvedValue(successResponse);
    mountView();
    await flushPromises();

    const onSnapshot = mocks.lifecycleOptions?.onSnapshot;
    expect(onSnapshot).toBeTypeOf("function");
    void onSnapshot?.("13", terminalLifecycle, undefined);
    await Promise.resolve();
    expect(mocks.getTaskList).toHaveBeenCalledTimes(2);

    void onSnapshot?.("13", terminalLifecycle, undefined);
    void onSnapshot?.("13", terminalLifecycle, undefined);
    expect(mocks.getTaskList).toHaveBeenCalledTimes(2);

    resolveRefresh?.(successResponse);
    await flushPromises();
    expect(mocks.getTaskList).toHaveBeenCalledTimes(3);
  });

  it("retains a terminal snapshot when a refresh still returns a stale running row", async () => {
    mountView();
    await flushPromises();
    expect(mocks.watchRow).toHaveBeenCalledWith("13");

    mocks.lifecycleSnapshots.value = { "13": terminalLifecycle };
    await mocks.lifecycleOptions?.onSnapshot?.(
      "13",
      terminalLifecycle,
      undefined
    );
    await flushPromises();

    expect(
      mocks.watchRow.mock.calls.filter(([id]) => id === "13")
    ).toHaveLength(1);
    expect(mocks.unwatchRow).not.toHaveBeenCalledWith("13");
  });

  it("ignores an old page response after pagination changes during its request", async () => {
    let resolveOldPage:
      | ((value: {
          code: number;
          data: { gene_list: typeof rows; total: number };
        }) => void)
      | undefined;
    const oldPage = new Promise<{
      code: number;
      data: { gene_list: typeof rows; total: number };
    }>((resolve) => {
      resolveOldPage = resolve;
    });
    mocks.getTaskList
      .mockResolvedValueOnce(successResponse)
      .mockReturnValueOnce(oldPage)
      .mockResolvedValueOnce({ code: 200, data: { gene_list: [], total: 0 } });
    const { wrapper } = mountView();
    await flushPromises();
    const pagination = wrapper.findComponent({ name: "ElPagination" });

    void mocks.lifecycleOptions?.onSnapshot?.(
      "13",
      terminalLifecycle,
      undefined
    );
    pagination.vm.$emit("current-change", 2);
    resolveOldPage?.(successResponse);
    await flushPromises();

    expect(mocks.getTaskList).toHaveBeenNthCalledWith(3, {
      current: 2,
      size: 10,
    });
    expect(
      mocks.watchRow.mock.calls.filter(([id]) => id === "13")
    ).toHaveLength(1);
    expect(wrapper.find(".phy-async-state--empty").exists()).toBe(true);
  });

  it("does not register lifecycle rows after unmounting an in-flight request", async () => {
    let resolveRequest: ((value: typeof successResponse) => void) | undefined;
    mocks.getTaskList.mockReturnValueOnce(
      new Promise<typeof successResponse>((resolve) => {
        resolveRequest = resolve;
      })
    );
    const { wrapper } = mountView();
    const watchCallsBeforeResolution = mocks.watchRow.mock.calls.length;
    wrapper.unmount();

    resolveRequest?.(successResponse);
    await flushPromises();

    expect(mocks.disposeLifecycle).toHaveBeenCalledTimes(1);
    expect(mocks.watchRow).toHaveBeenCalledTimes(watchCallsBeforeResolution);
    expect(mocks.getTaskList).toHaveBeenCalledTimes(1);
  });

  it("unwatches replaced pages and disposes lifecycle polling on unmount", async () => {
    const { wrapper } = mountView();
    await flushPromises();
    expect(mocks.watchRow).toHaveBeenCalledWith("13");

    wrapper
      .findComponent({ name: "ElPagination" })
      .vm.$emit("current-change", 2);
    expect(mocks.unwatchRow).toHaveBeenCalledWith("13");
    await flushPromises();

    wrapper.findComponent({ name: "ElPagination" }).vm.$emit("size-change", 20);
    await flushPromises();
    wrapper.unmount();
    expect(mocks.disposeLifecycle).toHaveBeenCalledTimes(1);
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

    expect(mocks.getTaskList).toHaveBeenNthCalledWith(2, {
      current: 2,
      size: 10,
    });
    expect(mocks.getTaskList).toHaveBeenNthCalledWith(3, {
      current: 2,
      size: 50,
    });
  });

  it("renders semantic statuses, signed downloads, and the preferred dialogue target", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { wrapper } = mountView();
    await flushPromises();

    expect(
      wrapper.findAll(".task-status-badge").map((badge) => badge.text())
    ).toEqual(["Finished", "Failed", "Running"]);
    expect(wrapper.findAll("button.task-download-action")).toHaveLength(1);

    await wrapper.get("button.task-download-action").trigger("click");
    expect(mocks.getChatdownloadURL).toHaveBeenCalledWith({
      obs_path: "/obs/results.zip",
    });
    expect(open).toHaveBeenCalledWith(
      "https://signed.example/results.zip",
      "_blank",
      "noopener,noreferrer"
    );

    await wrapper.findAll("button.task-dialogue-action")[0].trigger("click");
    await wrapper.findAll("button.task-dialogue-action")[1].trigger("click");
    expect(open).toHaveBeenNthCalledWith(
      2,
      "/chat?dialogue_id=dialogue-preferred",
      "_blank"
    );
    expect(open).toHaveBeenNthCalledWith(
      3,
      "/chat?dialogue_id=dialogue-fallback-only",
      "_blank"
    );
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
    expect(englishDate).toBe("7/9/2026");
    i18n.global.locale.value = "zh-CN";
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".task-updated-at").text()).toBe("2026/7/9");
    expect(wrapper.get(".task-updated-at").text()).not.toBe(englishDate);
  });

  it("keeps the table horizontally scrollable and does not log task data or paths", async () => {
    const { wrapper } = mountView();
    await flushPromises();

    expect(wrapper.findAll('[data-horizontal-scroll="table"]')).toHaveLength(1);
    expect(
      wrapper.find(".phy-table-frame__pagination .el-pagination").exists()
    ).toBe(true);

    const source = readFileSync(
      resolve(__dirname, "../../src/views/task-manager/TaskManagerView.vue"),
      "utf8"
    );
    expect(source).not.toMatch(/console\.(?:log|info|debug)\(/);
    expect(source).not.toMatch(
      /console\.error\([^\n]*(?:download_path|f_dialogue_id|dialogue_id|query)/
    );
    expect(source).toContain("overflow-x: auto");
    expect(source).toContain("@container (max-width: 720px)");
    expect(source).toContain(".el-pagination__jump");
  });
});
