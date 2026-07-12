import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import ChatAnalystLog from "@/views/chat/components/ChatAnalystLog.vue";

const messages = {
  "en-US": {
    chat: {
      log: {
        updateLog: "Update Log",
        updateUnavailable: "Update unavailable",
        loading: "Loading logs...",
        contentColumn: "Log Content",
        noData: "No log data",
        unavailable: "Log unavailable",
        fetchError: "Failed to load log",
        updateError: "Failed to update log",
        retry: "Retry",
      },
    },
  },
  "zh-CN": {
    chat: {
      log: {
        updateLog: "更新日志",
        updateUnavailable: "无法更新",
        loading: "加载日志中……",
        contentColumn: "日志内容",
        noData: "暂无日志数据",
        unavailable: "日志不可用",
        fetchError: "加载日志失败",
        updateError: "更新日志失败",
        retry: "重试",
      },
    },
  },
};

function mountLog(props: Record<string, unknown>, locale = "en-US") {
  const i18n = createI18n({
    legacy: false,
    locale,
    messages,
  });
  return mount(ChatAnalystLog, {
    props: props as any,
    global: { plugins: [i18n, ElementPlus] },
  });
}

describe("ChatAnalystLog", () => {
  it("shows unavailable when rowId is missing and does not offer update", () => {
    const w = mountLog({ rowId: undefined, taskId: "t1" });
    expect(w.text()).toContain("Log unavailable");
    expect(w.find("[data-testid='analyst-log-update']").exists()).toBe(false);
  });

  it("disables update with localized unavailable label when taskId is missing", () => {
    const w = mountLog({ rowId: "42", taskId: undefined, logData: "ok" });
    const btn = w.find("[data-testid='analyst-log-update']");
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.text()).toContain("Update unavailable");
  });

  it("renders string log via safe pre and array log via table", () => {
    const stringW = mountLog({
      rowId: "1",
      taskId: "t",
      logData: "line1\nline2",
    });
    expect(stringW.find("pre.log-pre").exists()).toBe(true);
    expect(stringW.find("pre.log-pre").text()).toContain("line1");

    const i18n = createI18n({
      legacy: false,
      locale: "en-US",
      messages,
    });
    const arrayW = mount(ChatAnalystLog, {
      props: {
        rowId: "1",
        taskId: "t",
        logData: [{ content: "row-a" }],
      } as any,
      global: {
        plugins: [i18n, ElementPlus],
        // happy-dom cannot host Element Plus table's MutationObserver
        stubs: {
          "el-table": {
            props: ["data"],
            template:
              '<div class="el-table-stub"><div v-for="(r, i) in data" :key="i">{{ r.content }}</div></div>',
          },
          "el-table-column": true,
        },
      },
    });
    expect(arrayW.find(".el-table-stub").exists()).toBe(true);
    expect(arrayW.text()).toContain("row-a");
  });

  it("shows loading and empty states", () => {
    const loading = mountLog({ rowId: "1", loading: true });
    expect(loading.text()).toContain("Loading logs...");

    const empty = mountLog({ rowId: "1", loading: false, logData: undefined });
    expect(empty.text()).toContain("No log data");
  });

  it("renders fetch/update errors with retry and translates from stored enum on locale switch", async () => {
    const locale = ref("en-US");
    const i18n = createI18n({
      legacy: false,
      locale: locale.value,
      messages,
    });
    const w = mount(ChatAnalystLog, {
      props: {
        rowId: "9",
        taskId: "task-9",
        errorKind: "fetch",
      } as any,
      global: { plugins: [i18n, ElementPlus] },
    });
    expect(w.text()).toContain("Failed to load log");
    expect(w.find("[data-testid='analyst-log-retry']").exists()).toBe(true);

    await w.setProps({ errorKind: "update" });
    expect(w.text()).toContain("Failed to update log");

    locale.value = "zh-CN";
    i18n.global.locale.value = "zh-CN";
    await nextTick();
    expect(w.text()).toContain("更新日志失败");

    await w.find("[data-testid='analyst-log-retry']").trigger("click");
    expect(w.emitted("retry")?.length).toBe(1);
  });

  it("emits update when update button is clicked with a taskId", async () => {
    const w = mountLog({
      rowId: "5",
      taskId: "task-5",
      logData: "x",
    });
    await w.find("[data-testid='analyst-log-update']").trigger("click");
    await flushPromises();
    expect(w.emitted("update")?.length).toBe(1);
  });
});
