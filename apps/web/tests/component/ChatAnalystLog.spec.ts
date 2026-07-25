import { describe, it, expect } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ChatAnalystLog from "@/views/chat/components/ChatAnalystLog.vue";
import type { LogErrorKind } from "@/views/chat/composables/useLogView";
import { createTestAppContext } from "../helpers/test-app-context";

const ANALYST_LOG_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatAnalystLog.vue"),
  "utf8"
);

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

type ChatAnalystLogProps = {
  rowId?: string;
  taskId?: string;
  logData?: unknown;
  loading?: boolean;
  updating?: boolean;
  errorKind?: LogErrorKind;
};

function makeAnalystContext(locale: "en-US" | "zh-CN" = "en-US") {
  const context = createTestAppContext({ locale });
  context.i18n.global.mergeLocaleMessage("en-US", messages["en-US"]);
  context.i18n.global.mergeLocaleMessage("zh-CN", messages["zh-CN"]);
  return context;
}

function mountLog(
  props: ChatAnalystLogProps,
  locale: "en-US" | "zh-CN" = "en-US"
) {
  return makeAnalystContext(locale).mount(ChatAnalystLog, {
    props,
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
    expect(btn.classes()).toContain("is-text");
    expect(btn.classes()).not.toContain("el-button--primary");
  });

  it("renders string log via safe pre and array log via table", () => {
    const stringW = mountLog({
      rowId: "1",
      taskId: "t",
      logData: "line1\nline2",
    });
    expect(stringW.find("pre.log-pre").exists()).toBe(true);
    expect(stringW.find("pre.log-pre").text()).toContain("line1");

    const arrayW = makeAnalystContext().mount(ChatAnalystLog, {
      props: {
        rowId: "1",
        taskId: "t",
        logData: [{ content: "row-a" }],
      },
      global: {
        // happy-dom cannot host Element Plus table's MutationObserver
        stubs: {
          "el-table": {
            name: "ElTable",
            props: {
              data: { type: Array, default: () => [] },
              border: { type: Boolean, default: false },
              size: { type: String, default: undefined },
            },
            template:
              '<div class="el-table-stub"><div v-for="(r, i) in data" :key="i">{{ r.content }}</div></div>',
          },
          "el-table-column": true,
        },
      },
    });
    expect(arrayW.find(".el-table-stub").exists()).toBe(true);
    expect(arrayW.text()).toContain("row-a");
    const table = arrayW.findComponent({ name: "ElTable" });
    expect(table.props("border")).toBe(false);
    expect(table.props("size")).toBe("small");
  });

  it("shows loading and empty states", () => {
    const loading = mountLog({ rowId: "1", loading: true });
    expect(loading.text()).toContain("Loading logs...");

    const empty = mountLog({ rowId: "1", loading: false, logData: undefined });
    expect(empty.text()).toContain("No log data");
  });

  it("renders fetch/update errors with retry and translates from stored enum on locale switch", async () => {
    const context = makeAnalystContext();
    const w = context.mount(ChatAnalystLog, {
      props: {
        rowId: "9",
        taskId: "task-9",
        errorKind: "fetch",
      },
    });
    expect(w.text()).toContain("Failed to load log");
    expect(w.find("[data-testid='analyst-log-retry']").exists()).toBe(true);
    expect(w.find("[data-testid='analyst-log-retry']").classes()).toContain(
      "is-text"
    );

    await w.setProps({ errorKind: "update" });
    expect(w.text()).toContain("Failed to update log");

    context.i18n.global.locale.value = "zh-CN";
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

  it("uses one quiet semantic surface instead of a nested dashboard", () => {
    const styles = ANALYST_LOG_SOURCE.slice(
      ANALYST_LOG_SOURCE.indexOf("<style")
    );
    expect(styles).toContain("var(--phy-font-mono)");
    expect(styles).toContain("var(--phy-color-bg-elevated)");
    expect(styles).toContain("var(--phy-color-border-subtle)");
    expect(styles).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(styles).not.toContain("background-color: #1e1e1e");
  });

  it("keeps long analyst log content inside its local scroll owner", () => {
    const logContentStart = ANALYST_LOG_SOURCE.indexOf(".log-content {");
    const logContentEnd = ANALYST_LOG_SOURCE.indexOf("\n}", logContentStart);
    const logContentStyles = ANALYST_LOG_SOURCE.slice(
      logContentStart,
      logContentEnd + 2
    );

    expect(logContentStyles).toContain("min-width: 0;");
    expect(logContentStyles).toContain("overflow-y: auto;");
    expect(ANALYST_LOG_SOURCE).toContain("white-space: pre-wrap;");
  });
});
