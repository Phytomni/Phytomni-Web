import { describe, it, expect } from "vitest";
import { nextTick } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ChatAnalystLog from "@/views/chat/components/ChatAnalystLog.vue";
import type { LogErrorKind } from "@/views/chat/composables/useLogView";
import type { AnalystAgentLog } from "@/api/types";
import { createTestAppContext } from "../helpers/test-app-context";

const ANALYST_LOG_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatAnalystLog.vue"),
  "utf8"
);

const messages = {
  "en-US": {
    chat: {
      log: {
        loading: "Loading logs...",
        contentColumn: "Log Content",
        noData: "No log data",
        unavailable: "Log unavailable",
        fetchError: "Failed to load log",
        retry: "Retry",
        reconnecting: "Reconnecting to the Agent log…",
        pending: "The Agent log is not available yet.",
        terminalEmpty: "This Agent run completed without a log.",
        truncated: "Only the available portion of this log is shown.",
      },
    },
  },
  "zh-CN": {
    chat: {
      log: {
        loading: "加载日志中……",
        contentColumn: "日志内容",
        noData: "暂无日志数据",
        unavailable: "日志不可用",
        fetchError: "加载日志失败",
        retry: "重试",
        reconnecting: "正在重新连接智能体日志……",
        pending: "智能体日志暂不可用。",
        terminalEmpty: "该智能体任务已完成，但没有日志。",
        truncated: "仅显示当前可用的日志内容。",
      },
    },
  },
};

const log = (overrides: Partial<AnalystAgentLog> = {}): AnalystAgentLog => ({
  state: "AVAILABLE",
  source: "BOT_RUN",
  text: "",
  revision: 0,
  truncated: false,
  can_request_legacy_refresh: false,
  error_code: null,
  ...overrides,
});

type ChatAnalystLogProps = {
  rowId?: string;
  logData?: AnalystAgentLog;
  loading?: boolean;
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
    const w = mountLog({ rowId: undefined });
    expect(w.text()).toContain("Log unavailable");
    expect(w.find("[data-testid='analyst-log-update']").exists()).toBe(false);
  });

  it("never exposes the removed browser mutation path for historical DTOs", () => {
    const w = mountLog({
      rowId: "42",
      logData: log({
        source: "LEGACY_TASK",
        text: "persisted historical log",
        can_request_legacy_refresh: true,
      }),
    });
    expect(w.text()).toContain("persisted historical log");
    expect(w.find("[data-testid='analyst-log-update']").exists()).toBe(false);
    expect(ANALYST_LOG_SOURCE).not.toContain("canRequestLegacyRefresh");
    expect(ANALYST_LOG_SOURCE).not.toContain("emit('update')");
  });

  it("renders bounded log text via safe pre", () => {
    const stringW = mountLog({
      rowId: "1",
      logData: log({ text: "line1\nline2" }),
    });
    expect(stringW.find("pre.log-pre").exists()).toBe(true);
    expect(stringW.find("pre.log-pre").text()).toContain("line1");
  });

  it("shows loading and empty states", () => {
    const loading = mountLog({ rowId: "1", loading: true });
    expect(loading.text()).toContain("Loading logs...");

    const empty = mountLog({ rowId: "1", loading: false, logData: undefined });
    expect(empty.text()).toContain("No log data");
  });

  it("renders fetch errors with retry and translates from stored enum on locale switch", async () => {
    const context = makeAnalystContext();
    const w = context.mount(ChatAnalystLog, {
      props: {
        rowId: "9",
        errorKind: "fetch",
      },
    });
    expect(w.text()).toContain("Failed to load log");
    expect(w.find("[data-testid='analyst-log-retry']").exists()).toBe(true);
    expect(w.find("[data-testid='analyst-log-retry']").classes()).toContain(
      "is-text"
    );

    context.i18n.global.locale.value = "zh-CN";
    await nextTick();
    expect(w.text()).toContain("加载日志失败");

    await w.find("[data-testid='analyst-log-retry']").trigger("click");
    expect(w.emitted("retry")?.length).toBe(1);
  });

  it("labels pending, terminal empty, degraded cached text, and truncation", () => {
    expect(
      mountLog({ rowId: "1", logData: log({ state: "PENDING" }) }).text()
    ).toContain("not available yet");
    expect(
      mountLog({ rowId: "1", logData: log({ state: "TERMINAL_EMPTY" }) }).text()
    ).toContain("completed without a log");
    const degraded = mountLog({
      rowId: "1",
      logData: log({ state: "DEGRADED", text: "last safe", truncated: true }),
    });
    expect(degraded.text()).toContain("last safe");
    expect(
      degraded.find("[data-testid='analyst-log-reconnecting']").exists()
    ).toBe(true);
    expect(
      degraded.find("[data-testid='analyst-log-truncated']").exists()
    ).toBe(true);
  });

  it("keeps ANSI rendering escaped for injected handlers", () => {
    const w = mountLog({
      rowId: "1",
      logData: log({ text: "\u001b[31m<img src=x onerror=alert(1)>" }),
    });
    expect(w.find("pre.log-pre").html()).toContain("&lt;img");
    expect(w.find("pre.log-pre img").exists()).toBe(false);
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
