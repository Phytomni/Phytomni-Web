import { describe, expect, it, vi } from "vitest";
import type { BotArtifact } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import BotReportState from "@/components/research/BotReportState.vue";
import BotArtifactList from "@/components/research/BotArtifactList.vue";
import enUS from "@/locales/langs/en-US";
import {
  createTestAppContext,
  mountWithApp,
} from "../helpers/test-app-context";

vi.mock("@/components/MarkdownViewer.vue", () => ({
  default: {
    props: ["content"],
    template: '<article data-test="report-markdown">{{ content }}</article>',
  },
}));

type ReportStage = "waiting_for_brief_gene" | "intermediate" | "final";

function lifecycle(
  overrides: Partial<BotLifecycleState> & { reportStage?: ReportStage } = {}
): BotLifecycleState & { reportStage?: ReportStage } {
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

function mountReport(state: BotLifecycleState & { reportStage?: ReportStage }) {
  return mountWithApp(BotReportState, {
    props: { state },
    global: {
      stubs: {
        MarkdownViewer: {
          props: ["content"],
          template:
            '<article data-test="report-markdown">{{ content }}</article>',
        },
      },
    },
  });
}

describe("BotReportState", () => {
  it.each([
    ["waiting", "waiting_for_brief_gene", "loading"],
    ["partial", "intermediate", "degraded"],
    ["final", "final", "complete"],
    ["failed", "final", "failed"],
  ] as const)("renders %s with localized status", (_name, stage, expected) => {
    const state = lifecycle({
      reportStage: stage,
      status:
        expected === "failed"
          ? "FAILED"
          : expected === "complete"
            ? "SUCCEEDED"
            : "RUNNING",
      visibleReport: expected === "complete" ? "# Final report" : "",
      finalReport: expected === "complete" ? "# Final report" : "",
    });
    const wrapper = mountReport(state);

    expect(wrapper.attributes("data-report-status")).toBe(expected);
    expect(wrapper.text()).not.toContain("raw.phytomni_state");
  });

  it("renders the sanitized report body and a localized timestamp", () => {
    const wrapper = mountReport(
      lifecycle({
        status: "SUCCEEDED",
        visibleReport: "# Final report",
        finalReport: "# Final report",
      })
    );

    expect(wrapper.get('[data-test="bot-report-content"]').text()).toContain(
      "# Final report"
    );
    expect(wrapper.find('[data-test="bot-report-updated-at"]').exists()).toBe(
      false
    );
  });

  it("formats report timestamps through the locale-aware datetime preset", () => {
    const updatedAt = "2026-07-16T08:30:00";
    const wrapper = createTestAppContext({ locale: "en-US" }).mount(
      BotReportState,
      {
        props: {
          state: lifecycle({
            status: "SUCCEEDED",
            visibleReport: "# Final report",
            finalReport: "# Final report",
          }),
          updatedAt,
        },
        global: {
          stubs: {
            MarkdownViewer: {
              props: ["content"],
              template:
                '<article data-test="report-markdown">{{ content }}</article>',
            },
          },
        },
      }
    );

    expect(wrapper.get('[data-test="bot-report-updated-at"]').text()).toBe(
      "7/16/2026, 8:30 AM"
    );
  });

  it("uses a failure-specific message when a failed report has no body", () => {
    const wrapper = mountReport(lifecycle({ status: "FAILED" }));

    expect(wrapper.get('[data-test="bot-report-empty"]').text()).toBe(
      enUS.common.failed
    );
    expect(wrapper.get('[data-test="bot-report-empty"]').text()).not.toBe(
      "common.loading"
    );
  });
});

describe("BotArtifactList", () => {
  it("warns for empty paths and only calls the signed download action for safe OBS paths", async () => {
    const download = vi.fn();
    const artifacts: BotArtifact[] = [
      {
        outputDir: "/obs/bucket/run-1",
        paths: [
          "/obs/bucket/run-1/report.pdf",
          "/obs/bucket/run-1/../secret",
          "/obs/other-run/private.txt",
        ],
      },
      { outputDir: "/obs/bucket/run-1", paths: [] },
    ];
    const wrapper = mountWithApp(BotArtifactList, {
      props: { artifacts, download, emptyLabel: "Warning" },
    });

    expect(wrapper.text()).toContain("Warning");
    expect(
      wrapper.findAll('button[data-test="bot-artifact-download"]')
    ).toHaveLength(1);
    await wrapper
      .get('button[data-test="bot-artifact-download"]')
      .trigger("click");
    expect(download).toHaveBeenCalledWith("/obs/bucket/run-1");
    expect(wrapper.html()).not.toContain('href="/obs/');
  });
});
