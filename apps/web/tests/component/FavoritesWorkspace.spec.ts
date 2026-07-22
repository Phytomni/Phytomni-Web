import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import { datetimeFormats } from "@/locales/datetime-formats";
import { formatDisplayDate } from "@/locales/format-display-date";

const mocks = vi.hoisted(() => ({
  getCollectHistory: vi.fn(),
  renameHistory: vi.fn(),
  collectHistory: vi.fn(),
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/api/chat", () => ({
  getCollectHistory: mocks.getCollectHistory,
  renameHistory: mocks.renameHistory,
  collectHistory: mocks.collectHistory,
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("element-plus", () => ({
  ElMessage: { success: mocks.success, error: mocks.error },
}));

import FavoritesWorkspace from "@/views/favorites/FavoritesView.vue";

const favoriteRows = [
  {
    id: 17,
    dialogue_id: "rice-dialogue",
    title_query: "Map a long rice flowering-time conversation title",
    created_at: "2026-07-10T15:30:45.000Z",
  },
  {
    id: 18,
    dialogue_id: "wheat-dialogue",
    title: "Review wheat disease resistance evidence",
    date: "2026-07-09T15:30:45.000Z",
  },
];

const makeFavoriteRows = () =>
  favoriteRows.map((favorite) => ({ ...favorite }));

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
          "aria-busy": attrs.loading ? "true" : "false",
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
            class: "dropdown-command-unfavorite",
            onClick: () => emit("command", "unfavorite"),
          },
          "Unfavorite"
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
    expose({ validate: () => Promise.resolve(true), resetFields: vi.fn() });
    return () => h("form", slots.default?.());
  },
});

const ElInputStub = defineComponent({
  name: "ElInput",
  props: { modelValue: String },
  emits: ["update:modelValue"],
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
    wrapper: mount(FavoritesWorkspace, { global: { plugins: [i18n], stubs } }),
  };
};

describe("Favorites workspace", () => {
  beforeEach(() => {
    mocks.getCollectHistory.mockReset();
    mocks.renameHistory.mockReset();
    mocks.collectHistory.mockReset();
    mocks.push.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
    mocks.getCollectHistory.mockResolvedValue({
      code: 200,
      data: makeFavoriteRows(),
    });
    mocks.renameHistory.mockResolvedValue({ code: 200 });
    mocks.collectHistory.mockResolvedValue({ code: 200 });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the exact favorites request into the shared workspace without pagination", async () => {
    const { wrapper } = mountView();
    await flushPromises();

    expect(mocks.getCollectHistory).toHaveBeenCalledTimes(1);
    expect(mocks.getCollectHistory).toHaveBeenCalledWith();
    expect(
      wrapper.find(".phy-workspace-shell.favorites-workspace").exists()
    ).toBe(true);
    expect(wrapper.find(".phy-page-header h1").text()).toBe("Favorites");
    expect(wrapper.find(".phy-data-toolbar").exists()).toBe(true);
    expect(wrapper.find(".phy-async-state--ready").exists()).toBe(true);
    expect(wrapper.findAll(".favorite-row")).toHaveLength(2);
    expect(wrapper.find(".el-backtop").attributes("data-target")).toBe(
      ".favorites-workspace"
    );
    expect(wrapper.findAll(".el-pagination")).toHaveLength(0);
  });

  it("opens the exact chat URL from rows while menu controls do not open the row", async () => {
    const { wrapper } = mountView();
    await flushPromises();

    await wrapper.findAll(".favorite-row")[0].trigger("click");
    expect(mocks.push).toHaveBeenCalledWith("/chat?dialogue_id=rice-dialogue");

    mocks.push.mockClear();
    await wrapper.findAll(".favorite-action-menu")[0].trigger("click");
    await wrapper.findAll(".dropdown-command-rename")[0].trigger("click");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(wrapper.find(".rename-input").element.value).toBe(
      favoriteRows[0].title_query
    );
  });

  it("preserves rename payload order and updates the title only after success", async () => {
    let resolveRename: (value: { code: number }) => void;
    mocks.renameHistory.mockImplementationOnce(
      () => new Promise((resolve) => (resolveRename = resolve))
    );
    const { wrapper } = mountView();
    await flushPromises();

    await wrapper.findAll(".dropdown-command-rename")[0].trigger("click");
    await wrapper.get(".rename-input").setValue("Renamed rice favorite");
    await wrapper
      .findAll(".el-dialog button[type='button']:not(.dialog-close)")[1]
      .trigger("click");
    expect(wrapper.text()).toContain(favoriteRows[0].title_query);
    if (!resolveRename) throw new Error("rename resolver was not created");
    resolveRename({ code: 200 });
    await flushPromises();

    const renamePayload = mocks.renameHistory.mock.calls[0][0] as FormData;
    expect([...renamePayload.entries()]).toEqual([
      ["id", "17"],
      ["rename", "Renamed rice favorite"],
    ]);
    expect(wrapper.text()).toContain("Renamed rice favorite");
  });

  it("resets a closed rename form and leaves its row unchanged after a failed rename", async () => {
    mocks.renameHistory.mockResolvedValueOnce({
      code: 500,
      message: "rename failed",
    });
    const { wrapper } = mountView();
    await flushPromises();

    await wrapper.findAll(".dropdown-command-rename")[0].trigger("click");
    await wrapper.get(".rename-input").setValue("Not saved");
    await wrapper.get(".dialog-close").trigger("click");
    await wrapper.findAll(".dropdown-command-rename")[0].trigger("click");
    expect(wrapper.get(".rename-input").element.value).toBe(
      favoriteRows[0].title_query
    );
    await wrapper
      .findAll(".el-dialog button[type='button']:not(.dialog-close)")[1]
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(favoriteRows[0].title_query);
    expect(wrapper.text()).not.toContain("Not saved");
  });

  it("immediately sends the exact unfavorite payload and removes a row only after success without payload logging", async () => {
    let resolveUnfavorite: (value: { code: number }) => void;
    mocks.collectHistory.mockImplementationOnce(
      () => new Promise((resolve) => (resolveUnfavorite = resolve))
    );
    const { wrapper } = mountView();
    await flushPromises();

    await wrapper.findAll(".dropdown-command-unfavorite")[0].trigger("click");
    expect(mocks.collectHistory).toHaveBeenCalledTimes(1);
    const unfavoritePayload = mocks.collectHistory.mock.calls[0][0] as FormData;
    expect([...unfavoritePayload.entries()]).toEqual([
      ["id", "17"],
      ["collect_type", "0"],
    ]);
    expect(wrapper.findAll(".favorite-row")).toHaveLength(2);
    expect(console.log).not.toHaveBeenCalled();
    if (!resolveUnfavorite)
      throw new Error("unfavorite resolver was not created");
    resolveUnfavorite({ code: 200 });
    await flushPromises();
    expect(wrapper.findAll(".favorite-row")).toHaveLength(1);
  });

  it("keeps a row after an unsuccessful unfavorite and exposes shared empty and retryable error states", async () => {
    mocks.collectHistory.mockResolvedValueOnce({
      code: 500,
      message: "unfavorite failed",
    });
    const { wrapper } = mountView();
    await flushPromises();
    await wrapper.findAll(".dropdown-command-unfavorite")[0].trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".favorite-row")).toHaveLength(2);

    mocks.getCollectHistory.mockResolvedValueOnce({ code: 200, data: [] });
    const empty = mountView().wrapper;
    await flushPromises();
    expect(empty.find(".phy-async-state--empty").exists()).toBe(true);
    await empty.get("button").trigger("click");
    expect(mocks.push).toHaveBeenCalledWith("/chat");

    mocks.getCollectHistory.mockRejectedValueOnce(new Error("offline"));
    const failed = mountView().wrapper;
    await flushPromises();
    expect(failed.find(".phy-async-state--error").exists()).toBe(true);
    await failed.get(".phy-error-state__retry").trigger("click");
    await flushPromises();
    expect(mocks.getCollectHistory).toHaveBeenCalledTimes(4);
  });

  it("retains loaded rows when a refresh request rejects", async () => {
    const { wrapper } = mountView();
    await flushPromises();
    expect(wrapper.findAll(".favorite-row")).toHaveLength(2);

    mocks.getCollectHistory.mockRejectedValueOnce(new Error("offline"));
    await wrapper.get(".favorites-refresh").trigger("click");
    await flushPromises();

    expect(wrapper.findAll(".favorite-row")).toHaveLength(2);
    expect(mocks.error).toHaveBeenCalledWith("Failed to load favorites");
    expect(mocks.success).not.toHaveBeenCalled();
    expect(wrapper.get(".favorites-refresh").attributes("aria-busy")).toBe(
      "false"
    );
  });

  it("keeps the loaded rows visible while refresh owns its independent busy state", async () => {
    let resolveRefresh:
      | ((value: { code: number; data: typeof favoriteRows }) => void)
      | undefined;
    const { wrapper } = mountView();
    await flushPromises();
    mocks.getCollectHistory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );

    await wrapper.get(".favorites-refresh").trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll(".favorite-row")).toHaveLength(2);
    expect(wrapper.get(".favorites-refresh").attributes("aria-busy")).toBe(
      "true"
    );

    if (!resolveRefresh) throw new Error("refresh resolver was not created");
    resolveRefresh({ code: 200, data: makeFavoriteRows() });
    await flushPromises();
    expect(wrapper.get(".favorites-refresh").attributes("aria-busy")).toBe(
      "false"
    );
  });

  it("formats raw dates reactively and reports refresh success only for successful requests", async () => {
    const { i18n, wrapper } = mountView();
    await flushPromises();
    const englishDate = wrapper.get(".favorite-date").text();
    expect(englishDate).toBe(
      formatDisplayDate(i18n.global.d, favoriteRows[0].created_at, "datetime")
    );
    i18n.global.locale.value = "zh-CN";
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".favorite-date").text()).toBe(
      formatDisplayDate(i18n.global.d, favoriteRows[0].created_at, "datetime")
    );
    expect(wrapper.get(".favorite-date").text()).not.toBe(englishDate);

    mocks.getCollectHistory.mockResolvedValueOnce({
      code: 500,
      message: "unavailable",
    });
    await wrapper.get(".favorites-refresh").trigger("click");
    await flushPromises();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(wrapper.findAll(".favorite-row")).toHaveLength(2);

    const refreshed = mountView().wrapper;
    await flushPromises();
    mocks.getCollectHistory.mockResolvedValueOnce({
      code: 200,
      data: makeFavoriteRows(),
    });
    await refreshed.get(".favorites-refresh").trigger("click");
    await flushPromises();
    expect(mocks.success).toHaveBeenCalledWith("Refreshed successfully");
    expect(refreshed.get(".favorites-refresh").attributes("aria-busy")).toBe(
      "false"
    );
  });
});
