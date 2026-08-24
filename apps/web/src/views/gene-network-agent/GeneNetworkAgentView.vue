<template>
  <main
    class="gene-network-page"
    data-scroll-root="gene-network-agent"
    aria-labelledby="gene-network-title"
  >
    <section
      v-if="!capabilityLoaded"
      class="gene-network-state"
      data-test="network-capability-loading"
      role="status"
      aria-live="polite"
    >
      <h1 id="gene-network-title">{{ t("agents.geneNetwork.title") }}</h1>
      <p>{{ t("agents.geneNetwork.capabilityLoading") }}</p>
      <button
        type="button"
        class="gene-network-back"
        data-test="network-back"
        @click="goBack"
      >
        {{ t("common.back") }}
      </button>
    </section>

    <section
      v-else-if="!capabilityAllowed"
      class="gene-network-state"
      data-test="network-unavailable"
      role="status"
      aria-live="polite"
    >
      <h1 id="gene-network-title">
        {{ t("agents.geneNetwork.unavailableTitle") }}
      </h1>
      <p>{{ t("agents.geneNetwork.unavailableMessage") }}</p>
      <button
        type="button"
        class="gene-network-back"
        data-test="network-back"
        @click="goBack"
      >
        {{ t("common.back") }}
      </button>
    </section>

    <template v-else>
      <header class="gene-network-header">
        <div>
          <p class="gene-network-eyebrow">
            {{ t("agents.geneNetwork.agentLabel") }}
          </p>
          <h1 id="gene-network-title">
            {{ t("agents.geneNetwork.title") }}
          </h1>
          <p class="gene-network-subtitle">
            {{ t("agents.geneNetwork.subtitle") }}
          </p>
        </div>
        <button
          type="button"
          class="gene-network-back"
          data-test="network-back"
          @click="goBack"
        >
          {{ t("common.back") }}
        </button>
      </header>

      <form
        class="gene-network-form"
        novalidate
        @submit.prevent="submitNetwork"
      >
        <div class="gene-network-field">
          <label for="network-question">
            {{ t("agents.geneNetwork.questionLabel") }}
          </label>
          <textarea
            id="network-question"
            v-model="question"
            data-test="network-question"
            :placeholder="t('agents.geneNetwork.questionPlaceholder')"
            rows="5"
            aria-required="true"
          />
        </div>

        <div class="gene-network-field">
          <label for="network-trait">
            {{ t("agents.geneNetwork.traitLabel") }}
          </label>
          <select
            id="network-trait"
            v-model="toId"
            data-test="network-trait"
            aria-required="true"
          >
            <option value="">
              {{ t("agents.geneNetwork.traitPlaceholder") }}
            </option>
            <option
              v-for="trait in TRAIT_OPTIONS"
              :key="trait.id"
              :value="trait.id"
            >
              {{ t(trait.labelKey) }} ({{ trait.id }})
            </option>
          </select>
        </div>

        <div class="gene-network-field">
          <label for="network-species">
            {{ t("agents.geneNetwork.speciesLabel") }}
          </label>
          <select
            id="network-species"
            v-model="speciesCode"
            data-test="network-species"
            aria-required="true"
          >
            <option value="">
              {{ t("agents.geneNetwork.speciesPlaceholder") }}
            </option>
            <option
              v-for="species in SPECIES_OPTIONS"
              :key="species.code"
              :value="species.code"
            >
              {{ t(species.labelKey) }} ({{ species.code }})
            </option>
          </select>
        </div>

        <ul
          v-if="validationMessages.length"
          class="gene-network-error-list"
          data-test="network-validation"
          role="alert"
        >
          <li
            v-for="message in validationMessages"
            :key="message"
            class="gene-network-error"
          >
            {{ message }}
          </li>
        </ul>
        <p
          v-if="formError"
          class="gene-network-error"
          data-test="network-form-error"
          role="alert"
        >
          {{ formError }}
        </p>

        <div class="gene-network-actions">
          <button
            type="submit"
            class="gene-network-submit"
            data-test="network-submit"
            :disabled="isSubmitting"
            @click="submitNetwork"
            @keydown.enter.prevent="submitNetwork"
          >
            {{
              isSubmitting
                ? t("agents.geneNetwork.submitting")
                : t("agents.geneNetwork.submit")
            }}
          </button>
          <button
            type="button"
            class="gene-network-reset"
            data-test="network-reset"
            @click="resetNetwork"
          >
            {{ t("agents.geneNetwork.reset") }}
          </button>
          <button
            v-if="isRunActive"
            type="button"
            class="gene-network-cancel"
            data-test="network-cancel"
            @click="cancelNetwork"
          >
            {{ t("common.cancel") }}
          </button>
        </div>
      </form>

      <p
        v-if="trackingDegraded"
        class="gene-network-degraded"
        data-test="network-tracking-degraded"
        role="status"
        aria-live="polite"
      >
        {{ t("agents.geneNetwork.trackingDegraded") }}
      </p>
      <p
        v-if="displayedState.degraded"
        class="gene-network-degraded"
        data-test="network-degraded"
        role="status"
        aria-live="polite"
      >
        {{ t("agents.geneNetwork.degraded") }}
      </p>

      <section
        v-if="hasRun"
        class="gene-network-artifact"
        data-test="network-artifact"
      >
        <ResearchArtifactShell
          :title="t('agents.geneNetwork.reportTitle')"
          :metadata="t('agents.geneNetwork.agentLabel')"
          :status="reportStatusLabel"
          :report-status="reportStatus"
          :tab-labels="tabLabels"
          :tabs="artifactTabs"
          artifact-id="gene-network-artifact"
          :back-label="t('common.back')"
          :close-label="t('common.close')"
          :action-label="t('agents.geneNetwork.reset')"
          :menu-items="resetArtifactMenuItems(t('agents.geneNetwork.reset'))"
          :tablist-label="t('agents.geneNetwork.sectionsLabel')"
          @back="goBack"
          @close="resetNetwork"
          @action="onArtifactMenu"
        >
          <template #content>
            <BotReportState
              :state="displayedState"
              :progress="reportProgress"
              :updated-at="reportUpdatedAt"
              agent-name="GeneNetworkAgent"
              ns="gene-network-agent"
              :labels="reportLabels"
              :empty-report-label="t('agents.geneNetwork.emptyReport')"
            />
          </template>

          <template #evidence>
            <p
              class="gene-network-empty"
              data-test="network-evidence-empty"
              role="status"
            >
              {{ t("agents.geneNetwork.noEvidence") }}
            </p>
          </template>

          <template #activity>
            <div
              class="gene-network-activity"
              data-test="network-progress"
              role="status"
              aria-live="polite"
            >
              <p>{{ progressLabel }}</p>
              <p v-if="displayedState.failures.length">
                {{ t("agents.geneNetwork.degraded") }}
              </p>
            </div>
          </template>

          <template #downloads>
            <ResultArchiveDelivery
              v-if="isResultArchiveV1"
              :delivery="displayedState.delivery"
              :artifacts="displayedState.artifactLinks"
              :retrying="archiveRetrying"
              @download="downloadResultArchive"
              @retry="retryResultArchive"
            />
            <template v-else>
              <div
                :data-test="
                  displayedState.artifacts.length === 0
                    ? 'network-empty-artifacts'
                    : undefined
                "
              >
                <BotArtifactList
                  :artifacts="displayedState.artifacts"
                  :download="downloadArtifact"
                  :title-label="t('agents.geneNetwork.downloads')"
                  :download-text="t('agents.geneNetwork.download')"
                  :empty-label="t('agents.geneNetwork.noDownloads')"
                />
              </div>
              <p
                v-if="downloadError"
                class="gene-network-error"
                data-test="network-download-error"
                role="alert"
              >
                {{ downloadError }}
              </p>
            </template>
          </template>
        </ResearchArtifactShell>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { getChatdownloadURL } from "@/api/chat";
import BotArtifactList from "@/components/research/BotArtifactList.vue";
import BotReportState from "@/components/research/BotReportState.vue";
import ResearchArtifactShell from "@/components/research/ResearchArtifactShell.vue";
import { resetArtifactMenuItems } from "@/components/research/artifact-overflow";
import {
  artifactChrome,
  artifactHasDownloadableFiles,
} from "@/views/chat/utils/artifact-chrome";
import ResultArchiveDelivery from "@/components/research/ResultArchiveDelivery.vue";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import { useBotCapabilities } from "@/views/chat/composables/useBotCapabilities";
import {
  useBotRemoteAgentRun,
  type BotRemoteAgentRunState,
} from "@/views/chat/composables/useBotRemoteAgentRun";
import { useRemoteAgentLifecycle } from "@/views/chat/composables/useRemoteAgentLifecycle";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { useResultArchiveDelivery } from "@/views/chat/composables/useResultArchiveDelivery";
import { isSafeBotObsPath, type BotProgress } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import type {
  AgentResultDelivery,
  ConversationArtifactLink,
} from "@/api/types";

const MAX_QUERY_LENGTH = 4000;
const SAFE_DIALOGUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const SAFE_TRAIT_ID = /^TO:\d{7}$/u;

const TRAIT_OPTIONS = [
  {
    id: "TO:0000011",
    labelKey: "agents.geneNetwork.traits.nitrogenSensitivity",
  },
  { id: "TO:0000019", labelKey: "agents.geneNetwork.traits.seedlingHeight" },
  { id: "TO:0000040", labelKey: "agents.geneNetwork.traits.panicleLength" },
  { id: "TO:0000128", labelKey: "agents.geneNetwork.traits.harvestIndex" },
  { id: "TO:0000207", labelKey: "agents.geneNetwork.traits.plantHeight" },
  { id: "TO:0000430", labelKey: "agents.geneNetwork.traits.germinationRate" },
] as const;
const TRAIT_IDS = new Set<string>(TRAIT_OPTIONS.map((trait) => trait.id));
const SPECIES_OPTIONS = [
  { code: "ath", labelKey: "agents.geneNetwork.species.arabidopsis" },
  { code: "osa", labelKey: "agents.geneNetwork.species.rice" },
  { code: "zma", labelKey: "agents.geneNetwork.species.maize" },
  { code: "sbi", labelKey: "agents.geneNetwork.species.sorghum" },
  { code: "gma", labelKey: "agents.geneNetwork.species.soybean" },
] as const;
const SPECIES_CODES = new Set<string>(
  SPECIES_OPTIONS.map((species) => species.code)
);

const props = defineProps<{ state?: BotLifecycleState }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { getChatState } = useChatStates();
const capabilities = useBotCapabilities("gene-network-agent-view");

const routeDialogueId =
  typeof route.query.dialogue_id === "string" ? route.query.dialogue_id : "";
const dialogueId = SAFE_DIALOGUE_ID.test(routeDialogueId)
  ? routeDialogueId
  : "gene-network-agent";
const run = useBotRemoteAgentRun({
  tool: "GeneNetworkAgent",
  dialogueId,
  getChatState,
  capabilities,
});
const remoteLifecycle = useRemoteAgentLifecycle({
  tool: "GeneNetworkAgent",
  run,
  dialogueId,
});

const question = ref("");
const toId = ref("");
const speciesCode = ref("osa");
const validationMessages = ref<string[]>([]);
const formError = ref("");
const downloadError = ref("");
const isSubmitting = ref(false);

const capabilityLoaded = computed(() => capabilities.loaded.value === true);
const networkCapability = computed(
  () => capabilities.byTool.value.GeneNetworkAgent
);
const networkProduct = REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent;
const capabilityAllowed = computed(() => {
  const capability = networkCapability.value;
  return (
    capabilityLoaded.value &&
    networkProduct.live === true &&
    capability?.enabled === true &&
    capability.execution === "agent_run" &&
    capability.resolver === true &&
    capability.artifacts === true
  );
});

const displayedState = computed(
  () => (props.state ?? run.state.value) as BotRemoteAgentRunState
);
const archiveDelivery = useResultArchiveDelivery({ getChatState });
const isResultArchiveV1 = computed(
  () => displayedState.value.projection?.resultArchiveV1 === true
);
const archiveRetrying = computed(() => {
  const messageId = displayedState.value.messageId;
  const ownerDialogueId = displayedState.value.dialogueId ?? dialogueId;
  return Boolean(
    messageId &&
    getChatState(ownerDialogueId).archiveRetryingByMessageId[messageId]
  );
});
const reportProgress = computed<BotProgress | null>(
  () => displayedState.value.projection?.progress ?? null
);
const reportUpdatedAt = computed(
  () => displayedState.value.projection?.reportUpdatedAt ?? null
);
const trackingDegraded = computed(
  () => displayedState.value.projection?.trackingDegraded === true
);
const isRunActive = computed(
  () =>
    Boolean(displayedState.value.requestId) &&
    ["submitting", "running", "input_required"].includes(
      displayedState.value.phase
    )
);
const hasRun = computed(
  () =>
    props.state !== undefined ||
    displayedState.value.phase !== "idle" ||
    displayedState.value.projection !== null ||
    displayedState.value.degraded
);
const reportStatus = computed<"loading" | "degraded" | "complete" | "failed">(
  () => {
    if (displayedState.value.phase === "failed") return "failed";
    if (displayedState.value.degraded) return "degraded";
    if (displayedState.value.phase === "succeeded") return "complete";
    return "loading";
  }
);
const reportStatusLabel = computed(() => {
  switch (reportStatus.value) {
    case "complete":
      return t("agents.geneNetwork.complete");
    case "degraded":
      return t("agents.geneNetwork.degraded");
    case "failed":
      return t("common.failed");
    default:
      return t("agents.geneNetwork.progress");
  }
});
const progressLabel = computed(() =>
  isRunActive.value ? t("agents.geneNetwork.progress") : reportStatusLabel.value
);
const reportLabels = computed(() => ({
  loading: t("agents.geneNetwork.progress"),
  degraded: t("agents.geneNetwork.degraded"),
  complete: t("agents.geneNetwork.complete"),
  failed: t("common.failed"),
}));
const tabLabels = computed(() => ({
  content: t("agents.geneNetwork.report"),
  evidence: t("agents.geneNetwork.evidence"),
  activity: t("agents.geneNetwork.activity"),
  downloads: t("agents.geneNetwork.downloads"),
}));
const artifactTabs = computed(
  () =>
    artifactChrome({
      tool: "GeneNetworkAgent",
      referenceCount: 0,
      hasAttachments: artifactHasDownloadableFiles({
        conversationArtifacts: displayedState.value.artifactLinks,
        botArtifacts: displayedState.value.artifacts,
        resultArchiveV1: isResultArchiveV1.value,
        delivery: displayedState.value.delivery ?? null,
      }),
      runComplete: !isRunActive.value,
      surface: "standalone",
    }).tabs
);

function normalizedTraitId(value: unknown): string | null {
  const normalized =
    typeof value === "string" ? value.trim().toUpperCase() : "";
  return SAFE_TRAIT_ID.test(normalized) && TRAIT_IDS.has(normalized)
    ? normalized
    : null;
}

function normalizedSpeciesCode(value: unknown): string | null {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "") return "osa";
  return SPECIES_CODES.has(normalized) ? normalized : null;
}

async function submitNetwork(): Promise<void> {
  if (!capabilityAllowed.value || isSubmitting.value) return;

  validationMessages.value = [];
  formError.value = "";
  const normalizedQuestion = question.value.trim();
  const normalizedToId = normalizedTraitId(toId.value);
  const normalizedSpecies = normalizedSpeciesCode(speciesCode.value);

  if (!normalizedQuestion) {
    formError.value = t("agents.geneNetwork.questionRequired");
  } else if (Array.from(normalizedQuestion).length > MAX_QUERY_LENGTH) {
    formError.value = t("agents.geneNetwork.questionTooLong");
  }
  if (!normalizedToId) {
    validationMessages.value.push(t("agents.geneNetwork.traitValidation"));
  }
  if (formError.value || validationMessages.value.length) return;
  if (!normalizedToId || !normalizedSpecies) return;

  isSubmitting.value = true;
  try {
    await run.submit({
      query: normalizedQuestion,
      resolver: {
        toId: normalizedToId,
        speciesCode: normalizedSpecies,
      },
    });
  } catch {
    formError.value = t("agents.geneNetwork.submitFailed");
  } finally {
    isSubmitting.value = false;
  }
}

function cancelNetwork(): void {
  run.cancel();
}

function resetNetwork(): void {
  remoteLifecycle.reset();
  run.reset();
  question.value = "";
  toId.value = "";
  speciesCode.value = "osa";
  validationMessages.value = [];
  formError.value = "";
  downloadError.value = "";
}

function onArtifactMenu(command: string): void {
  if (command === "reset") resetNetwork();
}

function goBack(): void {
  remoteLifecycle.dispose();
  router.back();
}

function applyPendingArchiveDelivery(delivery: AgentResultDelivery): void {
  if (props.state !== undefined) return;
  const current = run.state.value;
  if (!current.projection || !current.messageId) return;
  run.hydrate(
    { ...current.projection, delivery: { ...delivery } },
    {
      dialogueId: current.dialogueId ?? dialogueId,
      messageId: current.messageId,
      artifactLinks: [],
    }
  );
}

async function retryResultArchive(): Promise<void> {
  const current = displayedState.value;
  if (!current.messageId) return;
  await archiveDelivery.retryResultArchive({
    dialogueId: current.dialogueId ?? dialogueId,
    messageId: current.messageId,
    onPending: applyPendingArchiveDelivery,
  });
}

async function downloadResultArchive(
  artifact: ConversationArtifactLink
): Promise<void> {
  const current = displayedState.value;
  if (!current.messageId) return;
  await archiveDelivery.downloadResultArchive({
    dialogueId: current.dialogueId ?? dialogueId,
    messageId: current.messageId,
    artifact,
  });
}

function isSafeDownloadUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

async function downloadArtifact(outputDir: string): Promise<void> {
  downloadError.value = "";
  if (!isSafeBotObsPath(outputDir)) {
    downloadError.value = t("agents.geneNetwork.downloadFailed");
    return;
  }
  try {
    const response = await getChatdownloadURL({ obs_path: outputDir });
    const data = response as { code?: unknown; data?: unknown };
    if (data.code !== 200 || !isSafeDownloadUrl(data.data)) {
      downloadError.value = t("agents.geneNetwork.downloadFailed");
      return;
    }
    window.open(data.data, "_blank", "noopener,noreferrer");
  } catch {
    downloadError.value = t("agents.geneNetwork.downloadFailed");
  }
}

onMounted(() => {
  Promise.resolve(capabilities.load()).catch(() => undefined);
});

onBeforeUnmount(() => {
  remoteLifecycle.dispose();
  run.abortTransport();
});
</script>

<style scoped>
.gene-network-page {
  box-sizing: border-box;
  display: grid;
  gap: var(--phy-space-24);
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: var(--phy-space-32) var(--phy-space-40) var(--phy-space-48);
  overflow-y: auto;
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.gene-network-header,
.gene-network-form,
.gene-network-state,
.gene-network-artifact {
  width: min(100%, 1080px);
  margin: 0 auto;
}

.gene-network-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--phy-space-24);
}

.gene-network-eyebrow {
  margin: 0 0 var(--phy-space-8);
  color: var(--phy-color-accent-text);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.gene-network-header h1,
.gene-network-state h1 {
  margin: 0;
  font-size: clamp(1.5rem, 2.2vw, 2rem);
  line-height: 1.2;
}

.gene-network-subtitle,
.gene-network-state p,
.gene-network-empty {
  margin: var(--phy-space-8) 0 0;
  color: var(--phy-color-text-secondary);
  line-height: 1.6;
}

.gene-network-back,
.gene-network-submit,
.gene-network-reset,
.gene-network-cancel {
  min-height: var(--phy-control-height-default);
  padding: 0 var(--phy-space-16);
  border-radius: var(--phy-radius-sm);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.gene-network-back,
.gene-network-reset,
.gene-network-cancel {
  border: 1px solid var(--phy-color-border-control);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-action-text);
}

.gene-network-form {
  display: grid;
  gap: var(--phy-space-20);
  padding: var(--phy-space-24);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-lg);
  background: var(--phy-color-bg-elevated);
}

.gene-network-field {
  display: grid;
  gap: var(--phy-space-8);
}

.gene-network-field label {
  font-weight: 650;
}

.gene-network-field textarea,
.gene-network-field select {
  box-sizing: border-box;
  width: 100%;
  padding: var(--phy-space-12);
  border: 1px solid var(--phy-color-border-control);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  font: inherit;
  line-height: 1.5;
}

.gene-network-field textarea {
  resize: vertical;
}

.gene-network-error-list {
  display: grid;
  gap: var(--phy-space-8);
  margin: 0;
  padding: 0;
  list-style: none;
}

.gene-network-error {
  margin: 0;
  color: var(--phy-color-danger-text, var(--phy-color-text-muted));
  line-height: 1.5;
}

.gene-network-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--phy-space-12);
}

.gene-network-submit {
  border: 1px solid var(--phy-color-action);
  background: var(--phy-color-action);
  color: var(--phy-color-action-contrast);
}

.gene-network-submit:disabled {
  cursor: wait;
  opacity: 0.65;
}

.gene-network-degraded {
  width: min(100%, 1080px);
  margin: 0 auto;
  padding: var(--phy-space-12) var(--phy-space-16);
  border: 1px solid
    var(--phy-color-warning-border, var(--phy-color-border-subtle));
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-warning-bg, var(--phy-color-bg-elevated));
  color: var(--phy-color-warning-text, var(--phy-color-text-secondary));
  line-height: 1.5;
}

.gene-network-artifact {
  display: flex;
  min-height: 420px;
  overflow: hidden;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-lg);
}

.gene-network-activity {
  display: grid;
  gap: var(--phy-space-8);
}

.gene-network-activity p {
  margin: 0;
  color: var(--phy-color-text-secondary);
  line-height: 1.5;
}

.gene-network-back:focus-visible,
.gene-network-submit:focus-visible,
.gene-network-reset:focus-visible,
.gene-network-cancel:focus-visible,
.gene-network-field select:focus-visible,
.gene-network-field textarea:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

@media (max-width: 700px) {
  .gene-network-page {
    padding: var(--phy-space-24) var(--phy-space-16) var(--phy-space-32);
  }

  .gene-network-header {
    flex-direction: column-reverse;
  }
}
</style>
