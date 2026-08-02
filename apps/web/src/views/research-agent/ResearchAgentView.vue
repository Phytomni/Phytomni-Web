<template>
  <main
    class="research-agent-page"
    data-scroll-root="research-agent"
    aria-labelledby="research-agent-title"
  >
    <section
      v-if="!capabilityLoaded"
      class="research-agent-state"
      data-test="research-capability-loading"
      role="status"
      aria-live="polite"
    >
      <h1 id="research-agent-title">
        <AgentDisplayName :label="t('agents.research.title')" />
      </h1>
      <p>{{ t("agents.research.capabilityLoading") }}</p>
      <button
        type="button"
        class="research-agent-back"
        data-test="research-back"
        @click="goBack"
      >
        {{ t("common.back") }}
      </button>
    </section>

    <section
      v-else-if="!capabilityAllowed"
      class="research-agent-state"
      data-test="research-unavailable"
      role="status"
      aria-live="polite"
    >
      <h1 id="research-agent-title">
        {{ t("agents.research.unavailableTitle") }}
      </h1>
      <p>{{ t("agents.research.unavailableMessage") }}</p>
      <button
        type="button"
        class="research-agent-back"
        data-test="research-back"
        @click="goBack"
      >
        {{ t("common.back") }}
      </button>
    </section>

    <template v-else>
      <header class="research-agent-header">
        <div>
          <p class="research-agent-eyebrow">
            {{ t("agents.research.agentLabel") }}
          </p>
          <h1 id="research-agent-title">
            <AgentDisplayName :label="t('agents.research.title')" />
          </h1>
          <p class="research-agent-subtitle">
            {{ t("agents.research.subtitle") }}
          </p>
        </div>
        <button
          type="button"
          class="research-agent-back"
          data-test="research-back"
          @click="goBack"
        >
          {{ t("common.back") }}
        </button>
      </header>

      <form
        class="research-agent-form"
        novalidate
        @submit.prevent="submitResearch"
      >
        <div class="research-agent-field">
          <label for="research-question">{{
            t("agents.research.questionLabel")
          }}</label>
          <textarea
            id="research-question"
            v-model="question"
            data-test="research-question"
            :placeholder="t('agents.research.questionPlaceholder')"
            rows="5"
            aria-required="true"
          />
        </div>

        <div class="research-agent-field">
          <label for="research-files">{{
            t("agents.research.contextFilesLabel")
          }}</label>
          <input
            id="research-files"
            data-test="research-files"
            type="file"
            multiple
            :disabled="!canPickAttachments || isSubmitting || isRunActive"
            @change="handleFiles"
          />
          <p class="research-agent-hint">
            {{ t("agents.research.contextFilesHint") }}
          </p>
          <ul
            v-if="uploadItems.length"
            class="research-agent-file-list"
            data-test="research-file-list"
          >
            <li v-for="item in uploadItems" :key="item.localId">
              <ChatUploadCard
                :item="item"
                @pause="pauseUpload"
                @resume="resumeUpload"
                @retry="retryUpload"
                @reselect="reselectUpload"
                @cancel="cancelUpload"
                @remove="removeUpload"
              />
            </li>
          </ul>
        </div>

        <div class="research-agent-field">
          <label for="research-dataset">{{
            t("agents.research.datasetDescriptionLabel")
          }}</label>
          <textarea
            id="research-dataset"
            v-model="datasetDescription"
            data-test="research-dataset"
            :placeholder="t('agents.research.datasetDescriptionPlaceholder')"
            rows="3"
          />
        </div>

        <p
          v-if="fileError"
          class="research-agent-error"
          data-test="research-file-error"
          role="alert"
        >
          {{ fileError }}
        </p>
        <p
          v-if="formError"
          class="research-agent-error"
          data-test="research-form-error"
          role="alert"
        >
          {{ formError }}
        </p>

        <div class="research-agent-actions">
          <button
            type="submit"
            class="research-agent-submit"
            data-test="research-submit"
            :disabled="isSubmitting || hasBlockingUploads"
            @click="submitResearch"
          >
            {{
              isSubmitting
                ? t("agents.research.submitting")
                : t("agents.research.submit")
            }}
          </button>
          <button
            v-if="isRunActive"
            type="button"
            class="research-agent-cancel"
            data-test="research-cancel"
            @click="cancelResearch"
          >
            {{ t("common.cancel") }}
          </button>
        </div>
      </form>

      <p
        v-if="displayedState.degraded"
        class="research-agent-degraded"
        data-test="research-degraded"
        role="status"
        aria-live="polite"
      >
        {{ t("agents.research.degraded") }}
      </p>

      <section
        v-if="hasRun"
        class="research-agent-artifact"
        data-test="research-artifact"
      >
        <ResearchArtifactShell
          :title="t('agents.research.reportTitle')"
          :metadata="t('agents.research.agentLabel')"
          :status="reportStatusLabel"
          :report-status="reportStatus"
          :tab-labels="tabLabels"
          artifact-id="research-agent-artifact"
          :back-label="t('common.back')"
          :close-label="t('common.close')"
          :action-label="t('agents.research.reset')"
          :tablist-label="t('agents.research.sectionsLabel')"
          @back="goBack"
          @close="resetResearch"
          @action="resetResearch"
        >
          <template #content>
            <BotReportState
              :state="displayedState"
              :progress="reportProgress"
              :updated-at="reportUpdatedAt"
              ns="research-agent"
              :labels="reportLabels"
              :failure-label="reportFailureLabel"
              :empty-report-label="t('agents.research.emptyReport')"
            />
          </template>

          <template #evidence>
            <p
              class="research-agent-empty"
              data-test="research-evidence-empty"
              role="status"
            >
              {{ t("agents.research.noEvidence") }}
            </p>
          </template>

          <template #activity>
            <div
              class="research-agent-activity"
              data-test="research-progress"
              role="status"
              aria-live="polite"
            >
              <p>{{ progressLabel }}</p>
              <p v-if="displayedState.failures.length">
                {{ t("agents.research.degraded") }}
              </p>
            </div>
          </template>

          <template #downloads>
            <BotArtifactList
              :artifacts="displayedState.artifacts"
              :download="downloadArtifact"
              :title-label="t('agents.research.downloads')"
              :download-text="t('agents.research.download')"
              :empty-label="t('agents.research.noDownloads')"
            />
            <p
              v-if="downloadError"
              class="research-agent-error"
              data-test="research-download-error"
              role="alert"
            >
              {{ downloadError }}
            </p>
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
import AgentDisplayName from "@/components/AgentDisplayName.vue";
import BotArtifactList from "@/components/research/BotArtifactList.vue";
import BotReportState from "@/components/research/BotReportState.vue";
import ResearchArtifactShell from "@/components/research/ResearchArtifactShell.vue";
import ChatUploadCard from "@/views/chat/components/ChatUploadCard.vue";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import { userStore } from "@/stores";
import { useBotCapabilities } from "@/views/chat/composables/useBotCapabilities";
import {
  useBotRemoteAgentRun,
  type BotRemoteAgentRunState,
} from "@/views/chat/composables/useBotRemoteAgentRun";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { useResumableUploads } from "@/views/chat/composables/useResumableUploads";
import { useRemoteAgentLifecycle } from "@/views/chat/composables/useRemoteAgentLifecycle";
import type { ChatAttachmentValidationError } from "@/views/chat/composables/useFileUpload";
import { isSafeBotObsPath, type BotProgress } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";

const MAX_QUERY_LENGTH = 4000;
const MAX_DATASET_DESCRIPTION_LENGTH = 4000;
const SAFE_DIALOGUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const DATASET_DESCRIPTION_MARKER = "\n\n[dataset-description]\n";

const props = defineProps<{ state?: BotLifecycleState }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { getChatState } = useChatStates();
const capabilities = useBotCapabilities("research-agent-view");

const routeDialogueId =
  typeof route.query.dialogue_id === "string" ? route.query.dialogue_id : "";
const dialogueId = SAFE_DIALOGUE_ID.test(routeDialogueId)
  ? routeDialogueId
  : "research-agent";
const uploadDialogueId = ref(dialogueId);
const currentUser = userStore();
const uploadUsername = computed(() => currentUser.name ?? "");
const run = useBotRemoteAgentRun({
  tool: "InSilicoResearchAgent",
  dialogueId,
  getChatState,
  capabilities,
});
const remoteLifecycle = useRemoteAgentLifecycle({
  tool: "InSilicoResearchAgent",
  run,
  dialogueId,
});

const question = ref("");
const datasetDescription = ref("");
const fileError = ref("");
const formError = ref("");
const downloadError = ref("");
const isSubmitting = ref(false);

const capabilityLoaded = computed(() => capabilities.loaded.value === true);
const researchCapability = computed(
  () => capabilities.byTool.value.InSilicoResearchAgent
);
const researchProduct = REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent;
const capabilityAllowed = computed(() => {
  const capability = researchCapability.value;
  return (
    capabilityLoaded.value &&
    researchProduct.live === true &&
    capability?.enabled === true &&
    capability.execution === "agent_run" &&
    capability.artifacts === true
  );
});
const canPickAttachments = computed(
  () =>
    researchCapability.value?.attachments === true &&
    capabilities.upload.value.enabled === true
);
const uploadQueue = useResumableUploads({
  currentChatId: uploadDialogueId,
  getChatState,
  uploadCapability: capabilities.upload,
  username: uploadUsername,
  onValidationError: (error) => {
    fileError.value = attachmentErrorMessage(error);
  },
});
const uploadItems = computed(() => getChatState(dialogueId).fileList ?? []);
const hasBlockingUploads = uploadQueue.hasBlockingUploads;

function attachmentErrorMessage(error: ChatAttachmentValidationError): string {
  return t(`chat.attachmentErrors.${error.code}`, {
    file: error.fileName ?? "",
    maxFiles: capabilities.upload.value.max_attachments,
    maxFileMb: Math.ceil(
      capabilities.upload.value.max_file_bytes / 1024 / 1024
    ),
    maxTotalMb: Math.ceil(
      capabilities.upload.value.max_file_bytes / 1024 / 1024
    ),
  });
}

const displayedState = computed(
  () => (props.state ?? run.state.value) as BotRemoteAgentRunState
);
const reportProjection = computed(() => displayedState.value.projection);
const reportProgress = computed<BotProgress | null>(
  () => reportProjection.value?.progress ?? null
);
const reportUpdatedAt = computed(
  () => reportProjection.value?.reportUpdatedAt ?? null
);
const isRunActive = computed(() =>
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
      return t("agents.research.complete");
    case "degraded":
      return t("agents.research.degraded");
    case "failed":
      return t("common.failed");
    default:
      return t("agents.research.progress");
  }
});
const progressLabel = computed(() => {
  if (isRunActive.value) return t("agents.research.progress");
  return reportStatusLabel.value;
});
const reportLabels = computed(() => ({
  loading: t("agents.research.progress"),
  degraded: t("agents.research.degraded"),
  complete: t("agents.research.complete"),
  failed: t("common.failed"),
}));
const reportFailureLabel = computed(() =>
  displayedState.value.failures.includes("unsupported_asset_format")
    ? t("agents.research.unsupportedAssetFormat")
    : t("common.failed")
);
const tabLabels = computed(() => ({
  content: t("agents.research.report"),
  evidence: t("agents.research.evidence"),
  activity: t("agents.research.activity"),
  downloads: t("agents.research.downloads"),
}));

function handleFiles(event: Event): void {
  const input = event.target as HTMLInputElement;
  const incoming = Array.from(input.files ?? []);
  fileError.value = "";
  if (canPickAttachments.value) {
    void uploadQueue.queueFiles(incoming).catch(() => undefined);
  }
  input.value = "";
}

function handleUploadAction(action: Promise<void>): void {
  void action.catch(() => undefined);
}

const pauseUpload = (localId: string): void => {
  handleUploadAction(uploadQueue.pauseUpload(localId));
};
const resumeUpload = (localId: string): void => {
  handleUploadAction(uploadQueue.resumeUpload(localId));
};
const retryUpload = (localId: string): void => {
  handleUploadAction(uploadQueue.retryUpload(localId));
};
const reselectUpload = (localId: string, file: File): void => {
  uploadQueue.reselectUpload(localId, file);
};
const cancelUpload = (localId: string): void => {
  handleUploadAction(uploadQueue.cancelUpload(localId));
};
const removeUpload = (localId: string): void => {
  handleUploadAction(uploadQueue.removeUploadById(localId));
};

async function clearUploads(): Promise<void> {
  await Promise.all(
    [...uploadItems.value].map((item) => uploadQueue.removeUpload(item))
  );
}

async function submitResearch(): Promise<void> {
  if (
    !capabilityAllowed.value ||
    isSubmitting.value ||
    hasBlockingUploads.value
  )
    return;

  const normalizedQuestion = question.value.trim();
  if (!normalizedQuestion) {
    formError.value = t("agents.research.questionRequired");
    return;
  }
  if (Array.from(normalizedQuestion).length > MAX_QUERY_LENGTH) {
    formError.value = t("agents.research.questionTooLong");
    return;
  }
  if (
    Array.from(datasetDescription.value).length > MAX_DATASET_DESCRIPTION_LENGTH
  ) {
    formError.value = t("agents.research.datasetTooLong");
    return;
  }

  formError.value = "";
  isSubmitting.value = true;
  try {
    const normalizedDataset = datasetDescription.value.trim();
    const query = normalizedDataset
      ? `${normalizedQuestion}${DATASET_DESCRIPTION_MARKER}${normalizedDataset}`
      : normalizedQuestion;
    await run.submit({
      query,
      attachments: uploadQueue.completedAssetIds.value,
    });
  } catch {
    formError.value = t("agents.research.submitFailed");
  } finally {
    isSubmitting.value = false;
  }
}

function cancelResearch(): void {
  remoteLifecycle.reset();
  run.cancel();
}

function resetResearch(): void {
  remoteLifecycle.reset();
  run.reset();
  question.value = "";
  datasetDescription.value = "";
  void clearUploads().catch(() => undefined);
  fileError.value = "";
  formError.value = "";
  downloadError.value = "";
}

function goBack(): void {
  remoteLifecycle.dispose();
  router.back();
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
    downloadError.value = t("agents.research.downloadFailed");
    return;
  }
  try {
    const response = await getChatdownloadURL({ obs_path: outputDir });
    const data = response as { code?: unknown; data?: unknown };
    if (data.code !== 200 || !isSafeDownloadUrl(data.data)) {
      downloadError.value = t("agents.research.downloadFailed");
      return;
    }
    window.open(data.data, "_blank", "noopener,noreferrer");
  } catch {
    downloadError.value = t("agents.research.downloadFailed");
  }
}

onMounted(() => {
  Promise.resolve(capabilities.load()).catch(() => undefined);
});

onBeforeUnmount(() => {
  remoteLifecycle.dispose();
  run.cancel();
});
</script>

<style scoped>
.research-agent-page {
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

.research-agent-header,
.research-agent-form,
.research-agent-state,
.research-agent-artifact {
  width: min(100%, 1080px);
  margin: 0 auto;
}

.research-agent-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--phy-space-24);
}

.research-agent-eyebrow {
  margin: 0 0 var(--phy-space-8);
  color: var(--phy-color-accent-text);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.research-agent-header h1,
.research-agent-state h1 {
  margin: 0;
  font-size: clamp(1.5rem, 2.2vw, 2rem);
  line-height: 1.2;
}

.research-agent-subtitle,
.research-agent-state p,
.research-agent-hint,
.research-agent-empty {
  margin: var(--phy-space-8) 0 0;
  color: var(--phy-color-text-secondary);
  line-height: 1.6;
}

.research-agent-back,
.research-agent-submit,
.research-agent-cancel,
.research-agent-file-remove {
  min-height: var(--phy-control-height-default);
  padding: 0 var(--phy-space-16);
  border-radius: var(--phy-radius-sm);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.research-agent-back,
.research-agent-cancel,
.research-agent-file-remove {
  border: 1px solid var(--phy-color-border-control);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-action-text);
}

.research-agent-form {
  display: grid;
  gap: var(--phy-space-20);
  padding: var(--phy-space-24);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-lg);
  background: var(--phy-color-bg-elevated);
}

.research-agent-field {
  display: grid;
  gap: var(--phy-space-8);
}

.research-agent-field label {
  font-weight: 650;
}

.research-agent-field textarea {
  box-sizing: border-box;
  width: 100%;
  resize: vertical;
  padding: var(--phy-space-12);
  border: 1px solid var(--phy-color-border-control);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  font: inherit;
  line-height: 1.5;
}

.research-agent-field input[type="file"] {
  max-width: 100%;
  padding: var(--phy-space-8) 0;
  color: var(--phy-color-text-secondary);
  font: inherit;
}

.research-agent-file-list {
  display: grid;
  gap: var(--phy-space-8);
  margin: 0;
  padding: 0;
  list-style: none;
}

.research-agent-file-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--phy-space-12);
  min-width: 0;
  padding: var(--phy-space-8) var(--phy-space-12);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
}

.research-agent-file-list li span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.research-agent-file-remove {
  flex: 0 0 auto;
  min-height: 2rem;
  padding-inline: var(--phy-space-8);
  font-size: 0.8125rem;
}

.research-agent-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--phy-space-12);
}

.research-agent-submit {
  border: 1px solid var(--phy-color-action);
  background: var(--phy-color-action);
  color: var(--phy-color-action-contrast);
}

.research-agent-submit:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.research-agent-state,
.research-agent-degraded,
.research-agent-error,
.research-agent-empty {
  padding: var(--phy-space-16);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-elevated);
}

.research-agent-state {
  margin-block: auto;
  text-align: center;
}

.research-agent-degraded,
.research-agent-error {
  margin: 0 auto;
  color: var(--phy-color-danger-text, var(--phy-color-text-secondary));
}

.research-agent-artifact {
  min-height: 520px;
}

.research-agent-activity {
  display: grid;
  gap: var(--phy-space-8);
}

.research-agent-activity p {
  margin: 0;
  color: var(--phy-color-text-secondary);
}

@media (max-width: 720px) {
  .research-agent-page {
    padding: var(--phy-space-24) var(--phy-space-16) var(--phy-space-32);
  }

  .research-agent-header {
    flex-direction: column;
  }
}
</style>
