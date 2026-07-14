import { beforeEach, describe, expect, it, vi } from "vitest";
import { config, flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import { datetimeFormats } from "@/locales/datetime-formats";
import { formatDisplayDate } from "@/locales/format-display-date";

const mocks = vi.hoisted(() => ({
  getHistoryQuestionList: vi.fn(),
  renameHistory: vi.fn(),
  deleteHistory: vi.fn(),
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/api/chat", () => ({
  getHistoryQuestionList: mocks.getHistoryQuestionList,
  renameHistory: mocks.renameHistory,
  deleteHistory: mocks.deleteHistory,
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("element-plus", () => ({
  ElMessage: { success: mocks.success, error: mocks.error },
}));

import HistoryWorkspace from "@/views/history/index.vue";

const historyRows = [
  {
    id: 17,
    dialogue_id: "rice-dialogue",
    title_query: "Map a long rice flowering-time conversation title",
    created_at: "2026-07-10T15:30:45.000Z",
  },
  {
    id: 18,
    dialogue_id: "wheat-dialogue",
    title_query: "Review wheat disease resistance evidence",
    created_at: "2026-07-09T15:30:45.000Z",
  },
];

const makeHistoryRows = () => historyRows.map((history) => ({ ...history }));

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
          "data-loading": String(
            attrs.loading === true || attrs.loading === "true"
          ),
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default?.()
      );
  },
});

const ElDropdownStub = defineComponent({
  name: "ElDropdown",
  emits: ["command"],
  setup(_, { emit, slots }) {
    return () =>
      h("div", { class: "el-dropdown" }, [
        slots.default?.(),
        h(
          "button",
          {
            class: "dropdown-command-rename",
            onClick: () => emit("command", "rename"),
          },
          "Rename"
        ),
        h(
          "button",
          {
            class: "dropdown-command-delete",
            onClick: () => emit("command", "delete"),
          },
          "Delete"
        ),
      ]);
  },
});

const ElDialogStub = defineComponent({
  name: "ElDialog",
  props: { modelValue: Boolean, title: String },
  emits: ["update:modelValue", "close"],
  setup(props, { emit, slots }) {
    return () =>
      props.modelValue
        ? h("section", { class: "el-dialog", "data-title": props.title }, [
            slots.default?.(),
            slots.footer?.(),
            h(
              "button",
              {
                class: "dialog-close",
                onClick: () => {
                  emit("update:modelValue", false);
                  emit("close");
                },
              },
              "Close"
            ),
          ])
        : null;
  },
});

const ElFormStub = defineComponent({
  name: "ElForm",
  setup(_, { expose, slots }) {
    const resetFields = vi.fn();
    expose({ validate: () => Promise.resolve(true), resetFields });
    return () => h("form", slots.default?.());
  },
});

const ElInputStub = defineComponent({
  name: "ElInput",
  props: { modelValue: String },
  emits: ["update:modelValue", "keyup"],
  setup(props, { emit }) {
    return () =>
      h("input", {
        class: "rename-input",
        value: props.modelValue,
        onInput: (event: Event) =>
          emit("update:modelValue", (event.target as HTMLInputElement).value),
      });
  },
});

const stubs = {
  ElButton: ElButtonStub,
  ElDropdown: ElDropdownStub,
  ElDropdownMenu: { template: "<div><slot /></div>" },
  ElDropdownItem: { template: "<button><slot /></button>" },
  ElDialog: ElDialogStub,
  ElForm: ElFormStub,
  ElFormItem: { template: "<div><slot /></div>" },
  ElInput: ElInputStub,
  ElBacktop: {
    props: { target: String },
    template: '<div class="el-backtop" :data-target="target" />',
  },
  ElIcon: { template: "<span><slot /></span>" },
};

config.global.plugins = [];

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
    wrapper: mount(HistoryWorkspace, { global: { plugins: [i18n], stubs } }),
  };
};

describe("History workspace", () => {
  beforeEach(() => {
    mocks.getHistoryQuestionList.mockReset();
    mocks.renameHistory.mockReset();
    mocks.deleteHistory.mockReset();
    mocks.push.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
    mocks.getHistoryQuestionList.mockResolvedValue({
      code: 200,
      data: makeHistoryRows(),
    });
    mocks.renameHistory.mockResolvedValue({ code: 200 });
    mocks.deleteHistory.mockResolvedValue({ code: 200 });
  });

  it("loads the unchanged history request into the shared workspace and targets its scroll root", async () => {
    const { wrapper } = mountView();
    await flushPromises();

    expect(mocks.getHistoryQuestionList).toHaveBeenCalledTimes(1);
    expect(mocks.getHistoryQuestionList).toHaveBeenCalledWith();
    expect(
      wrapper.find(".phy-workspace-shell.history-workspace").exists()
    ).toBe(true);
    expect(wrapper.find(".phy-page-header h1").text()).toBe("History");
    expect(wrapper.find(".phy-data-toolbar").exists()).toBe(true);
    expect(wrapper.find(".phy-async-state--ready").exists()).toBe(true);
    expect(wrapper.findAll(".history-row")).toHaveLength(2);
    expect(wrapper.find(".el-backtop").attributes("data-target")).toBe(
      ".history-workspace"
    );
    expect(wrapper.findAll(".el-pagination")).toHaveLength(0);
  });

  it("opens the exact chat URL from rows, but menu controls do not open the row", async () => {
    const { wrapper } = mountView();
    await flushPromises();

    await wrapper.findAll(".history-row")[0].trigger("click");
    expect(mocks.push).toHaveBeenCalledWith("/chat?dialogue_id=rice-dialogue");

    mocks.push.mockClear();
    await wrapper.findAll(".history-action-menu")[0].trigger("click");
    await wrapper.findAll(".dropdown-command-rename")[0].trigger("click");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(wrapper.find(".rename-input").element.value).toBe(
      historyRows[0].title_query
    );
  });

  it("sends unchanged mutation payloads and only applies local rename/delete updates after success", async () => {
    let resolveRename: (value: { code: number }) => void;
    let resolveDelete: (value: { code: number }) => void;
    mocks.renameHistory.mockImplementationOnce(
      () => new Promise((resolve) => (resolveRename = resolve))
    );
    mocks.deleteHistory.mockImplementationOnce(
      () => new Promise((resolve) => (resolveDelete = resolve))
    );
    const { wrapper } = mountView();
    await flushPromises();

    await wrapper.findAll(".dropdown-command-rename")[0].trigger("click");
    await wrapper.get(".rename-input").setValue("Renamed rice history");
    await wrapper
      .findAll(".el-dialog button[type='button']:not(.dialog-close)")[1]
      .trigger("click");
    expect(wrapper.text()).toContain(historyRows[0].title_query);
    if (!resolveRename) throw new Error("rename resolver was not created");
    resolveRename({ code: 200 });
    await flushPromises();

    const renamePayload = mocks.renameHistory.mock.calls[0][0] as FormData;
    expect(renamePayload.get("id")).toBe("17");
    expect(renamePayload.get("rename")).toBe("Renamed rice history");
    expect(wrapper.text()).toContain("Renamed rice history");

    await wrapper.findAll(".dropdown-command-delete")[1].trigger("click");
    await wrapper
      .findAll(".el-dialog button[type='button']:not(.dialog-close)")[1]
      .trigger("click");
    expect(wrapper.findAll(".history-row")).toHaveLength(2);
    if (!resolveDelete) throw new Error("delete resolver was not created");
    resolveDelete({ code: 200 });
    await flushPromises();

    const deletePayload = mocks.deleteHistory.mock.calls[0][0] as FormData;
    expect(deletePayload.get("id")).toBe("18");
    expect(wrapper.findAll(".history-row")).toHaveLength(1);
  });

  it("keeps local rows unchanged when rename or delete responses fail and resets the rename form on close", async () => {
    mocks.renameHistory.mockResolvedValueOnce({
      code: 500,
      message: "rename failed",
    });
    mocks.deleteHistory.mockResolvedValueOnce({
      code: 500,
      message: "delete failed",
    });
    const { wrapper } = mountView();
    await flushPromises();

    await wrapper.findAll(".dropdown-command-rename")[0].trigger("click");
    await wrapper.get(".rename-input").setValue("Not saved");
    await wrapper.get(".dialog-close").trigger("click");
    expect(wrapper.find(".rename-input").exists()).toBe(false);
    await wrapper.findAll(".dropdown-command-rename")[0].trigger("click");
    expect(wrapper.get(".rename-input").element.value).toBe(
      historyRows[0].title_query
    );
    await wrapper
      .findAll(".el-dialog button[type='button']:not(.dialog-close)")[1]
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(historyRows[0].title_query);
    expect(wrapper.text()).not.toContain("Not saved");

    await wrapper.findAll(".dropdown-command-delete")[1].trigger("click");
    await wrapper
      .findAll(".el-dialog button[type='button']:not(.dialog-close)")[1]
      .trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".history-row")).toHaveLength(2);
  });

  it("shows shared empty and error states, including a retryable caught load failure", async () => {
    mocks.getHistoryQuestionList.mockResolvedValueOnce({ code: 200, data: [] });
    const empty = mountView().wrapper;
    await flushPromises();
    expect(empty.find(".phy-async-state--empty").exists()).toBe(true);
    await empty.get("button").trigger("click");
    expect(mocks.push).toHaveBeenCalledWith("/chat");

    mocks.getHistoryQuestionList.mockRejectedValueOnce(new Error("offline"));
    const failed = mountView().wrapper;
    await flushPromises();
    expect(failed.find(".phy-async-state--error").exists()).toBe(true);
    await failed.get(".phy-error-state__retry").trigger("click");
    await flushPromises();
    expect(mocks.getHistoryQuestionList).toHaveBeenCalledTimes(3);
  });

  it("formats raw dates reactively and only reports refresh success for true fetch results", async () => {
    const { i18n, wrapper } = mountView();
    await flushPromises();
    const englishDate = wrapper.get(".history-date").text();
    expect(englishDate).toBe(
      formatDisplayDate(i18n.global.d, historyRows[0].created_at, "datetime")
    );
    i18n.global.locale.value = "zh-CN";
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".history-date").text()).toBe(
      formatDisplayDate(i18n.global.d, historyRows[0].created_at, "datetime")
    );
    expect(wrapper.get(".history-date").text()).not.toBe(englishDate);

    mocks.getHistoryQuestionList.mockResolvedValueOnce({
      code: 500,
      message: "unavailable",
    });
    await wrapper.get(".history-refresh").trigger("click");
    await flushPromises();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(wrapper.find(".phy-async-state--error").exists()).toBe(true);

    const caught = mountView().wrapper;
    await flushPromises();
    mocks.getHistoryQuestionList.mockRejectedValueOnce(new Error("offline"));
    await caught.get(".history-refresh").trigger("click");
    await flushPromises();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(caught.find(".phy-async-state--error").exists()).toBe(true);

    const refreshed = mountView().wrapper;
    await flushPromises();
    mocks.getHistoryQuestionList.mockResolvedValueOnce({
      code: 200,
      data: makeHistoryRows(),
    });
    await refreshed.get(".history-refresh").trigger("click");
    await flushPromises();
    expect(mocks.success).toHaveBeenCalledWith("Refreshed successfully");
  });
});
