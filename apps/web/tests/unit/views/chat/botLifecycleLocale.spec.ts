import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import BotArtifactList from "@/components/research/BotArtifactList.vue";
import BotReportState from "@/components/research/BotReportState.vue";
import ChatMessageActions from "@/views/chat/components/ChatMessageActions.vue";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import {
  createTestAppContext,
  mountWithApp,
} from "../../../helpers/test-app-context";

vi.mock("@/components/ScientificMarkdown.vue", () => ({
  default: {
    props: ["source"],
    template: '<article data-test="report-markdown">{{ source }}</article>',
  },
}));

const REQUIRED_BOT_LIFECYCLE_KEYS = [
  "chat.botReport.waiting",
  "chat.botReport.partial",
  "chat.botReport.degraded",
  "chat.botReport.failed",
  "chat.botReport.inputRequired",
  "chat.botReport.emptyArtifacts",
] as const;

const REQUIRED_RESEARCH_LIFECYCLE_LABELS = [
  ["chat.lifecycle.resolving_inputs", "Resolving inputs"],
  ["chat.lifecycle.planning", "Planning tasks"],
  ["chat.lifecycle.finalizing", "Finalizing"],
] as const;
const RESEARCH_TIMEOUT_LIFECYCLE_LABEL = [
  "chat.lifecycle.timed_out",
  "Timed out",
] as const;

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../../../src/views/chat/ChatView.vue"),
  "utf8"
);

type LocalePack = typeof enUS;
type SupportedLocale = "en-US" | "zh-CN";
type ReportStage = "waiting_for_brief_gene" | "intermediate" | "final";
type LifecycleWithMetadata = BotLifecycleState & {
  reportStage?: ReportStage | null;
  reportUpdatedAt?: string | null;
  progress?: {
    completed: number;
    total: number;
    failed: number;
    pending: number;
    briefGeneStatus: string;
  };
};

const valueAt = (pack: LocalePack, path: string): unknown =>
  path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object" && key in node) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, pack);

function localePack(locale: SupportedLocale): LocalePack {
  return locale === "zh-CN" ? zhCN : enUS;
}

function lifecycle(
  overrides: Partial<LifecycleWithMetadata> = {}
): LifecycleWithMetadata {
  return {
    runId: "run-1",
    status: "RUNNING",
    reportRevision: 1,
    visibleReport: "",
    intermediateReport: "",
    finalReport: "",
    degraded: false,
    failures: [],
    artifacts: [],
    ...overrides,
  };
}

function reportLabels(pack: LocalePack, state: ReturnType<typeof lifecycle>) {
  const botReport = pack.chat.botReport;
  const stage = state.reportStage;
  const lifecycleLabel =
    state.status === "TIMED_OUT"
      ? pack.chat.lifecycle.timed_out
      : state.status === "FAILED"
        ? botReport.failed
        : state.status === "INPUT_REQUIRED"
          ? botReport.inputRequired
          : stage === "waiting_for_brief_gene"
            ? botReport.waiting
            : state.degraded
              ? botReport.degraded
              : stage === "intermediate"
                ? botReport.partial
                : state.status === "RUNNING"
                  ? botReport.waiting
                  : botReport.complete;

  return {
    loading: lifecycleLabel,
    degraded: lifecycleLabel,
    failed:
      state.status === "TIMED_OUT"
        ? pack.chat.lifecycle.timed_out
        : botReport.failed,
    complete: botReport.complete,
  };
}

function mountReport(
  locale: SupportedLocale,
  state: ReturnType<typeof lifecycle>
) {
  const pack = localePack(locale);
  return createTestAppContext({ locale }).mount(BotReportState, {
    props: {
      state,
      ns: `bot-report-${locale}`,
      labels: reportLabels(pack, state),
      emptyReportLabel: reportLabels(pack, state).loading,
    },
    global: {
      stubs: {
        ScientificMarkdown: {
          props: ["source"],
          template:
            '<article data-test="report-markdown">{{ source }}</article>',
        },
      },
    },
  });
}

const ACTION_STUBS = {
  ElTooltip: {
    template: "<span><slot /></span>",
    props: ["content", "effect", "placement"],
  },
  ElDropdown: {
    template: '<div><slot /><slot name="dropdown" /></div>',
    props: ["placement", "trigger"],
  },
  ElDropdownMenu: { template: "<div><slot /></div>" },
  ElDropdownItem: { template: "<div><slot /></div>", props: ["command"] },
  ElIcon: { template: "<i><slot /></i>" },
  CopyDocument: true,
  SuccessFilled: true,
  Refresh: true,
  Download: true,
  CircleCheck: true,
  CircleClose: true,
  CircleCloseFilled: true,
};

describe("Bot lifecycle locale contract", () => {
  it("has non-empty bilingual values for every stable Bot lifecycle key", () => {
    for (const key of REQUIRED_BOT_LIFECYCLE_KEYS) {
      expect(valueAt(enUS, key)).toEqual(expect.any(String));
      expect(String(valueAt(enUS, key)).trim()).not.toBe("");
      expect(valueAt(zhCN, key)).toEqual(expect.any(String));
      expect(String(valueAt(zhCN, key)).trim()).not.toBe("");
    }
  });

  it.each(REQUIRED_RESEARCH_LIFECYCLE_LABELS)(
    "defines exact English and translated Research lifecycle copy for %s",
    (key, english) => {
      expect(valueAt(enUS, key)).toBe(english);

      const translated = valueAt(zhCN, key);
      expect(translated).toEqual(expect.any(String));
      const normalized = String(translated).trim();
      expect(normalized).not.toBe("");
      expect(normalized).not.toBe(english);
      expect(normalized).not.toBe(key);
      expect(normalized).not.toMatch(/[{}]/u);
    }
  );

  it("defines exact English and translated Research timeout copy", () => {
    const [key, english] = RESEARCH_TIMEOUT_LIFECYCLE_LABEL;
    expect(valueAt(enUS, key)).toBe(english);

    const translated = valueAt(zhCN, key);
    expect(translated).toEqual(expect.any(String));
    const normalized = String(translated).trim();
    expect(normalized).not.toBe("");
    expect(normalized).not.toBe(english);
    expect(normalized).not.toBe(key);
    expect(normalized).not.toMatch(/[{}]/u);
  });

  it("wires Bot-owned artifact states to the stable render-time keys", () => {
    for (const key of REQUIRED_BOT_LIFECYCLE_KEYS) {
      expect(CHAT_SOURCE).toContain(key);
    }
    expect(CHAT_SOURCE).toContain(':labels="currentArtifactBotReportLabels"');
    expect(CHAT_SOURCE).toContain(
      ":empty-label=\"t('chat.botReport.emptyArtifacts')\""
    );
  });

  it.each([
    ["waiting", "RUNNING", "waiting_for_brief_gene", false, "waiting"],
    ["partial", "RUNNING", "intermediate", false, "partial"],
    ["degraded", "RUNNING", "intermediate", true, "degraded"],
    ["failed", "FAILED", "final", false, "failed"],
    ["timed-out", "TIMED_OUT", "final", false, "timed_out"],
    ["input-required", "INPUT_REQUIRED", null, false, "inputRequired"],
    ["complete", "SUCCEEDED", "final", false, "complete"],
  ] as const)(
    "renders %s copy in both locales without raw lifecycle values",
    (_name, status, reportStage, degraded, key) => {
      for (const locale of ["en-US", "zh-CN"] as const) {
        const state = lifecycle({ status, reportStage, degraded });
        const wrapper = mountReport(locale, state);
        const expected = valueAt(
          localePack(locale),
          key === "timed_out"
            ? "chat.lifecycle.timed_out"
            : `chat.botReport.${key}`
        );

        expect(wrapper.get('[data-test="bot-report-status"]').text()).toContain(
          expected as string
        );
        expect(wrapper.text()).not.toContain("INPUT_REQUIRED");
        expect(wrapper.text()).not.toContain("provider_secret");
        wrapper.unmount();
      }
    }
  );

  it("localizes empty artifacts and keeps the retry control keyboard reachable", () => {
    const locale: SupportedLocale = "en-US";
    const pack = localePack(locale);
    const artifacts = mountWithApp(BotArtifactList, {
      props: {
        artifacts: [],
        emptyLabel: pack.chat.botReport.emptyArtifacts,
      },
    });
    expect(artifacts.get('[data-test="bot-artifact-warning"]').text()).toBe(
      pack.chat.botReport.emptyArtifacts
    );

    const actions = mountWithApp(ChatMessageActions, {
      props: {
        role: "assistant",
        canRefresh: true,
        canReact: false,
      },
      global: {
        stubs: ACTION_STUBS,
      },
    });
    const retry = actions.get('[data-testid="action-refresh"]');
    expect(retry.attributes("type")).toBe("button");
    expect(retry.attributes("aria-label")).toBe(pack.chat.refreshReply);
    expect(retry.attributes("tabindex")).not.toBe("-1");
  });

  it("announces progress and formats the raw timestamp at render time", () => {
    const wrapper = mountReport(
      "en-US",
      lifecycle({
        reportStage: "intermediate",
        progress: {
          completed: 1,
          total: 2,
          failed: 0,
          pending: 1,
          briefGeneStatus: "",
        },
        reportUpdatedAt: "2026-07-16T00:00:00Z",
      })
    );

    const progress = wrapper.get('[data-test="bot-report-progress"]');
    expect(progress.attributes("aria-live")).toBe("polite");
    expect(progress.text()).toContain("1/2");
    expect(wrapper.get('[data-test="bot-report-updated-at"]').text()).not.toBe(
      "2026-07-16T00:00:00Z"
    );
  });

  it("never renders raw Bot status or upstream diagnostic text", () => {
    const wrapper = mountReport(
      "en-US",
      lifecycle({
        status: "FAILED",
        reportStage: "final",
        failures: ["provider_secret", "stack trace: internal"],
      })
    );

    expect(wrapper.text()).toContain(enUS.chat.botReport.failed);
    expect(wrapper.text()).not.toContain("FAILED");
    expect(wrapper.text()).not.toContain("provider_secret");
    expect(wrapper.text()).not.toContain("stack trace: internal");
  });
});
