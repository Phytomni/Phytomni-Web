<template>
  <el-config-provider :locale="epLocale">
    <main
      data-testid="chat-visual-root"
      class="report-integrity-fixture"
      :data-case="caseName"
    >
      <header>
        <h1>Phytomni</h1>
        <LangSwitch />
        <ThemeSwitch />
      </header>
      <ChatMessageContent
        :message="message"
        :index="0"
        :is-last-message="true"
        :artifact-preview="preview"
        :gene-network-images="{}"
        :gene-network-images-loading="{}"
        :digital-design-images="{}"
        :digital-design-images-loading="{}"
        :lifecycle="lifecycle"
        @open-artifact="viewerOpen = true"
        @download-result-archive="downloadArchive"
      />
      <el-drawer
        v-model="viewerOpen"
        :title="t(decision.labelKey)"
        size="100%"
        append-to-body
      >
        <DeepGenomeArtifact
          title="Phytomni"
          :status="t(decision.labelKey)"
          :report-state="reportState"
          :markdown="decision.reportText"
          :references="reportReferences"
          ns="integrity"
          :tab-labels="{
            content: t('common.view'),
            evidence: t('agents.deepGenome.references'),
          }"
          :tablist-label="t('common.operation')"
          :back-label="t('common.back')"
          :close-label="t('common.close')"
          :action-label="t('common.operation')"
          @back="viewerOpen = false"
          @close="viewerOpen = false"
        />
      </el-drawer>
    </main>
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import en from "element-plus/es/locale/lang/en";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import LangSwitch from "@/components/LangSwitch.vue";
import ThemeSwitch from "@/components/ThemeSwitch.vue";
import DeepGenomeArtifact from "@/components/research/DeepGenomeArtifact.vue";
import ChatMessageContent from "@/views/chat/components/ChatMessageContent.vue";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { useResultArchiveDelivery } from "@/views/chat/composables/useResultArchiveDelivery";
import { parseBotProjection } from "@/views/chat/botProjection";
import { initBotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import {
  reportLifecycleForMessage,
  reportPresentationFor,
} from "@/views/chat/utils/report-presentation";
import {
  decodeAgentTaskLifecycle,
  decodeConversationArtifacts,
  type AgentTaskLifecycle,
  type ConversationArtifactLink,
} from "@/api/types";
import type { ChatMessage } from "@/views/chat/types";
import type { ChatVisualFixtureDefinition } from "./fixture-registry";
import publicGolden from "../../fixtures/report-integrity/public-projection.json";

defineProps<{
  fixture: ChatVisualFixtureDefinition | null;
  errorMessage: string | null;
}>();

type CaseName = "partial" | "archive";
type AgentName = "deep_genome" | "design" | "network" | "research" | "analyst";
const tools = {
  deep_genome: "DeepGenomeAgent",
  design: "DigitalDesignAgent",
  network: "GeneNetworkAgent",
  research: "InSilicoResearchAgent",
  analyst: "AnalystAgent",
} as const;
const params = new URLSearchParams(window.location.search);
const caseName = ref<CaseName>(
  params.get("case") === "archive" ? "archive" : "partial"
);
const agent = params.get("agent") as AgentName;
const selectedAgent =
  agent in tools
    ? agent
    : caseName.value === "archive"
      ? "design"
      : "deep_genome";
const { t, locale } = useI18n();
const epLocale = computed(() => (locale.value === "zh-CN" ? zhCn : en));
const { getChatState } = useChatStates();
const { downloadResultArchive } = useResultArchiveDelivery({ getChatState });
const viewerOpen = ref(false);
const message = ref<ChatMessage>(buildMessage(false));
const reportState = computed(() => reportLifecycleForMessage(message.value));
const reportReferences = computed<unknown[]>(() => {
  if (caseName.value !== "partial") return [];
  const answer = JSON.parse(goldenCase().history.answer) as {
    doc_list: unknown[];
  };
  return answer.doc_list;
});
const decision = computed(() =>
  reportPresentationFor(reportState.value, undefined, message.value.tool_name)
);
const preview = computed(() =>
  decision.value.reportText
    ? {
        title: t(decision.value.labelKey),
        kind: t("common.view"),
        summary: decision.value.reportText,
        openLabel: t("common.view"),
      }
    : null
);
const lifecycle = computed<AgentTaskLifecycle>(() =>
  reportState.value.status !== "RUNNING"
    ? decodeAgentTaskLifecycle(goldenCase().lifecycle)
    : {
        id: goldenCase().history.id,
        phase: "RUNNING",
        terminal: false,
        child_task_count: selectedAgent === "deep_genome" ? 12 : 1,
        child_work_accepted: true,
        report_revision: reportState.value.reportRevision,
        artifact_summary: {
          image_count: 0,
          output_directory_count: message.value.delivery ? 1 : 0,
          has_report: !!decision.value.reportText,
        },
        reconciliation: "FRESH",
        tracking_degraded: false,
        error_code: null,
      }
);

function goldenCase() {
  const id =
    caseName.value === "partial"
      ? "partial-failed-deep-genome"
      : `no-science-archive-${selectedAgent === "deep_genome" ? "design" : selectedAgent}`;
  const fixture = publicGolden.cases.find((candidate) => candidate.id === id);
  if (!fixture)
    throw new Error(`Missing public report integrity fixture: ${id}`);
  return fixture;
}

function buildMessage(terminal: boolean): ChatMessage {
  if (terminal) {
    const history = goldenCase().history;
    return {
      id: String(history.id),
      role: "assistant",
      tool_name: history.tool_name,
      status: history.status,
      content: history.answer,
      botProjection: parseBotProjection(history),
      botLifecycle: initBotLifecycleState(),
      ...(history.delivery
        ? {
            delivery: decodeAgentTaskLifecycle(goldenCase().lifecycle).delivery,
            result_archive_v1: history.result_archive_v1,
            artifacts: decodeConversationArtifacts(history.artifacts),
          }
        : {}),
    };
  }
  const projection = parseBotProjection({
    run_id: goldenCase().history.bot_run_id,
    agent: selectedAgent,
    status: "RUNNING",
    report_revision: 1,
    report_stage: "waiting_for_brief_gene",
    intermediate_report: "",
    final_report: "",
    report: {
      state: "none",
      degraded: false,
      source_artifact_count: 0,
    },
    report_warning_codes: [],
    progress: {
      completed: 1,
      total: 12,
      failed: 0,
      pending: 11,
    },
  });
  return {
    id: String(goldenCase().history.id),
    role: "assistant",
    tool_name: tools[selectedAgent],
    status: "RUNNING",
    content: "",
    botProjection: projection,
    // Exercise reconciliation with an existing, nondegraded cached lifecycle.
    botLifecycle: initBotLifecycleState(),
  };
}

async function downloadArchive(artifact: ConversationArtifactLink) {
  await downloadResultArchive({
    dialogueId: goldenCase().history.dialogue_id,
    messageId: String(goldenCase().history.id),
    artifact,
  });
}

const fixtureWindow = window as Window & {
  reportIntegrity?: {
    finish(): void;
    reset(nextCase?: CaseName): void;
    report(): string;
  };
};
onMounted(() => {
  fixtureWindow.reportIntegrity = {
    finish: () => {
      message.value = buildMessage(true);
    },
    reset: (nextCase = caseName.value) => {
      caseName.value = nextCase;
      viewerOpen.value = false;
      message.value = buildMessage(false);
    },
    report: () => decision.value.reportText,
  };
  if (params.get("terminal") === "true") fixtureWindow.reportIntegrity.finish();
});
onUnmounted(() => {
  delete fixtureWindow.reportIntegrity;
});
</script>

<style scoped>
.report-integrity-fixture {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--phy-space-16);
  height: 100dvh;
  overflow-y: auto;
}
header {
  display: flex;
  align-items: center;
  gap: var(--phy-space-16);
  margin-bottom: var(--phy-space-16);
}
h1 {
  flex: 1;
  font-size: 24px;
}
</style>
