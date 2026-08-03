<template>
  <main
    class="analysis-agent-page"
    :data-scroll-root="`${agentKey}-agent`"
    :aria-labelledby="`${agentKey}-agent-title`"
  >
    <section
      v-if="!capabilityLoaded"
      class="analysis-agent-state"
      :data-test="`${agentKey}-capability-loading`"
      role="status"
      aria-live="polite"
    >
      <h1 :id="`${agentKey}-agent-title`">
        <AgentDisplayName :label="t(`${localePrefix}.title`)" />
      </h1>
      <p>{{ t(`${localePrefix}.capabilityLoading`) }}</p>
      <button
        type="button"
        class="analysis-agent-back"
        :data-test="`${agentKey}-back`"
        @click="goBack"
      >
        {{ t("common.back") }}
      </button>
    </section>

    <section
      v-else-if="!capabilityAllowed"
      class="analysis-agent-state"
      :data-test="`${agentKey}-unavailable`"
      role="status"
      aria-live="polite"
    >
      <h1 :id="`${agentKey}-agent-title`">
        {{ t(`${localePrefix}.unavailableTitle`) }}
      </h1>
      <p>{{ t(`${localePrefix}.unavailableMessage`) }}</p>
      <button
        type="button"
        class="analysis-agent-back"
        :data-test="`${agentKey}-back`"
        @click="goBack"
      >
        {{ t("common.back") }}
      </button>
    </section>

    <template v-else>
      <header class="analysis-agent-header">
        <div>
          <p class="analysis-agent-eyebrow">
            {{ t(`${localePrefix}.agentLabel`) }}
          </p>
          <h1 :id="`${agentKey}-agent-title`">
            <AgentDisplayName :label="t(`${localePrefix}.title`)" />
          </h1>
          <p class="analysis-agent-subtitle">
            {{ t(`${localePrefix}.subtitle`) }}
          </p>
        </div>
        <button
          type="button"
          class="analysis-agent-back"
          :data-test="`${agentKey}-back`"
          @click="goBack"
        >
          {{ t("common.back") }}
        </button>
      </header>

      <form
        class="analysis-agent-form"
        :class="`${agentKey}-agent-form`"
        novalidate
        @submit.prevent="submit"
      >
        <div class="analysis-agent-field">
          <label :for="`${agentKey}-question`">
            {{ t(`${localePrefix}.questionLabel`) }}
          </label>
          <textarea
            :id="`${agentKey}-question`"
            v-model="question"
            :data-test="`${agentKey}-question`"
            :data-testid="`${agentKey}-query`"
            :placeholder="t(`${localePrefix}.questionPlaceholder`)"
            rows="5"
            aria-required="true"
          />
        </div>

        <div class="analysis-agent-field">
          <label :for="`${agentKey}-files`">
            {{ t(`${localePrefix}.contextFilesLabel`) }}
          </label>
          <AttachmentPurposeSelector
            v-if="allowedPurposes.length > 1"
            v-model="uploadPurpose"
            :allowed-purposes="allowedPurposes"
            :disabled="!canPickAttachments || isSubmitting || isRunActive"
            :data-test="`${agentKey}-attachment-purpose`"
          />
          <input
            :id="`${agentKey}-files`"
            :data-test="`${agentKey}-files`"
            type="file"
            multiple
            :disabled="!canPickAttachments || isSubmitting || isRunActive"
            @change="handleFiles"
          />
          <p class="analysis-agent-hint">
            {{ t(`${localePrefix}.contextFilesHint`) }}
          </p>
          <ul
            v-if="uploadItems.length"
            class="analysis-agent-file-list"
            :data-test="`${agentKey}-file-list`"
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

        <div v-if="hasDatasetUpload" class="analysis-agent-field">
          <label :for="`${agentKey}-dataset`">
            {{ t(`${localePrefix}.datasetDescriptionLabel`) }}
          </label>
          <textarea
            :id="`${agentKey}-dataset`"
            v-model="datasetDescription"
            :data-test="`${agentKey}-dataset`"
            :placeholder="t(`${localePrefix}.datasetDescriptionPlaceholder`)"
            rows="3"
          />
        </div>

        <p
          v-if="fileError"
          class="analysis-agent-error"
          :data-test="`${agentKey}-file-error`"
          role="alert"
        >
          {{ fileError }}
        </p>
        <p
          v-if="formError"
          class="analysis-agent-error"
          :data-test="`${agentKey}-form-error`"
          role="alert"
        >
          {{ formError }}
        </p>

        <div class="analysis-agent-actions">
          <button
            type="submit"
            class="analysis-agent-submit"
            :data-test="`${agentKey}-submit`"
            :data-testid="`${agentKey}-submit`"
            :disabled="isSubmitting || hasBlockingUploads"
            @click="submit"
          >
            {{
              isSubmitting
                ? t(`${localePrefix}.submitting`)
                : t(`${localePrefix}.submit`)
            }}
          </button>
          <button
            v-if="isRunActive"
            type="button"
            class="analysis-agent-cancel"
            :data-test="`${agentKey}-cancel`"
            @click="cancelRun"
          >
            {{ t("common.cancel") }}
          </button>
        </div>
      </form>

      <p
        v-if="displayedState.degraded"
        class="analysis-agent-degraded"
        :data-test="`${agentKey}-degraded`"
        role="status"
        aria-live="polite"
      >
        {{ t(`${localePrefix}.degraded`) }}
      </p>

      <section
        v-if="hasRun"
        class="analysis-agent-artifact"
        :data-test="`${agentKey}-artifact`"
      >
        <ResearchArtifactShell
          :title="t(`${localePrefix}.reportTitle`)"
          :metadata="t(`${localePrefix}.agentLabel`)"
          :status="reportStatusLabel"
          :report-status="reportStatus"
          :tab-labels="tabLabels"
          :artifact-id="`${agentKey}-agent-artifact`"
          :back-label="t('common.back')"
          :close-label="t('common.close')"
          :action-label="t(`${localePrefix}.reset`)"
          :tablist-label="t(`${localePrefix}.sectionsLabel`)"
          @back="goBack"
          @close="resetRun"
          @action="resetRun"
        >
          <template #content>
            <BotReportState
              :state="displayedState"
              :progress="reportProgress"
              :updated-at="reportUpdatedAt"
              :ns="`${agentKey}-agent`"
              :labels="reportLabels"
              :failure-label="reportFailureLabel"
              :empty-report-label="t(`${localePrefix}.emptyReport`)"
            />
          </template>

          <template #evidence>
            <p
              class="analysis-agent-empty"
              :data-test="`${agentKey}-evidence-empty`"
              role="status"
            >
              {{ t(`${localePrefix}.noEvidence`) }}
            </p>
          </template>

          <template #activity>
            <div
              class="analysis-agent-activity"
              :data-test="`${agentKey}-progress`"
              role="status"
              aria-live="polite"
            >
              <p>{{ progressLabel }}</p>
              <p v-if="displayedState.failures.length">
                {{ t(`${localePrefix}.degraded`) }}
              </p>
            </div>
          </template>

          <template #downloads>
            <BotArtifactList
              :artifacts="displayedState.artifacts"
              :download="downloadArtifact"
              :title-label="t(`${localePrefix}.downloads`)"
              :download-text="t(`${localePrefix}.download`)"
              :empty-label="t(`${localePrefix}.noDownloads`)"
            />
            <p
              v-if="downloadError"
              class="analysis-agent-error"
              :data-test="`${agentKey}-download-error`"
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { getChatdownloadURL } from "@/api/chat";
import AgentDisplayName from "@/components/AgentDisplayName.vue";
import BotArtifactList from "@/components/research/BotArtifactList.vue";
import BotReportState from "@/components/research/BotReportState.vue";
import ResearchArtifactShell from "@/components/research/ResearchArtifactShell.vue";
import {
  REMOTE_AGENT_PRODUCT_REGISTRY,
  type RemoteAgentTool,
} from "@/constants/agents";
import { userStore } from "@/stores";
import AttachmentPurposeSelector from "@/views/chat/components/AttachmentPurposeSelector.vue";
import ChatUploadCard from "@/views/chat/components/ChatUploadCard.vue";
import { useBotCapabilities } from "@/views/chat/composables/useBotCapabilities";
import type { ChatAttachmentValidationError } from "@/views/chat/composables/useFileUpload";
import {
  useBotRemoteAgentRun,
  type BotRemoteAgentRunState,
} from "@/views/chat/composables/useBotRemoteAgentRun";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { useRemoteAgentLifecycle } from "@/views/chat/composables/useRemoteAgentLifecycle";
import { useResumableUploads } from "@/views/chat/composables/useResumableUploads";
import { isSafeBotObsPath, type BotProgress } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import type { UploadPurpose } from "@/views/chat/upload/types";
import {
  DatasetDescriptionError,
  normalizeDatasetDescription,
} from "@/views/chat/utils/dataset-description";

export type AnalysisRemoteAgentTool = Extract<
  RemoteAgentTool,
  "AnalystAgent" | "InSilicoResearchAgent"
>;

type LocalePrefix = "agents.analyst" | "agents.research";

type Props = {
  tool: AnalysisRemoteAgentTool;
  localePrefix: LocalePrefix;
  state?: BotLifecycleState;
};

const MAX_QUERY_LENGTH = 4000;
const SAFE_DIALOGUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

const props = defineProps<Props>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { getChatState } = useChatStates();
const agentKey = computed(() =>
  props.tool === "AnalystAgent" ? "analyst" : "research"
);
const capabilities = useBotCapabilities(`${agentKey.value}-agent-view`);
const routeDialogueId =
  typeof route.query.dialogue_id === "string" ? route.query.dialogue_id : "";
const dialogueId = SAFE_DIALOGUE_ID.test(routeDialogueId)
  ? routeDialogueId
  : `${agentKey.value}-agent`;
const uploadDialogueId = ref(dialogueId);
const currentUser = userStore();
const uploadUsername = computed(() => currentUser.name ?? "");
const run = useBotRemoteAgentRun({
  tool: props.tool,
  dialogueId,
  getChatState,
  capabilities,
});
const remoteLifecycle = useRemoteAgentLifecycle({
  tool: props.tool,
  run,
  dialogueId,
});

const question = ref("");
const datasetDescription = ref("");
const uploadPurpose = ref<UploadPurpose>(
  props.tool === "InSilicoResearchAgent" ? "dataset" : "document"
);
const fileError = ref("");
const formError = ref("");
const downloadError = ref("");
const isSubmitting = ref(false);

const capabilityLoaded = computed(() => capabilities.loaded.value === true);
const product = computed(() => REMOTE_AGENT_PRODUCT_REGISTRY[props.tool]);
const agentCapability = computed(() => capabilities.byTool.value[props.tool]);
const allowedPurposes = computed<UploadPurpose[]>(
  () => agentCapability.value?.attachmentPurposes ?? []
);
const capabilityAllowed = computed(() => {
  const capability = agentCapability.value;
  return (
    capabilityLoaded.value &&
    product.value.live === true &&
    capability?.enabled === true &&
    capability.execution === "agent_run" &&
    capability.artifacts === true
  );
});
const canPickAttachments = computed(
  () =>
    agentCapability.value?.attachments === true &&
    allowedPurposes.value.length > 0 &&
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
const hasDatasetUpload = computed(() =>
  uploadItems.value.some(
    (item) => item.purpose === "dataset" && item.status !== "aborted"
  )
);
const hasBlockingUploads = uploadQueue.hasBlockingUploads;

watch(
  allowedPurposes,
  (purposes) => {
    if (purposes.length > 0 && !purposes.includes(uploadPurpose.value)) {
      uploadPurpose.value = purposes[0];
    }
  },
  { immediate: true }
);

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
      return t(`${props.localePrefix}.complete`);
    case "degraded":
      return t(`${props.localePrefix}.degraded`);
    case "failed":
      return t("common.failed");
    default:
      return t(`${props.localePrefix}.progress`);
  }
});
const progressLabel = computed(() =>
  isRunActive.value
    ? t(`${props.localePrefix}.progress`)
    : reportStatusLabel.value
);
const reportLabels = computed(() => ({
  loading: t(`${props.localePrefix}.progress`),
  degraded: t(`${props.localePrefix}.degraded`),
  complete: t(`${props.localePrefix}.complete`),
  failed: t("common.failed"),
}));
const reportFailureLabel = computed(() =>
  displayedState.value.failures.includes("unsupported_asset_format")
    ? t(`${props.localePrefix}.unsupportedAssetFormat`)
    : t("common.failed")
);
const tabLabels = computed(() => ({
  content: t(`${props.localePrefix}.report`),
  evidence: t(`${props.localePrefix}.evidence`),
  activity: t(`${props.localePrefix}.activity`),
  downloads: t(`${props.localePrefix}.downloads`),
}));

function handleFiles(event: Event): void {
  const input = event.target as HTMLInputElement;
  const incoming = Array.from(input.files ?? []);
  fileError.value = "";
  if (canPickAttachments.value) {
    void uploadQueue
      .queueFiles(incoming, uploadPurpose.value)
      .catch(() => undefined);
  }
  input.value = "";
}

function handleUploadAction(action: Promise<void>): void {
  void action.catch(() => undefined);
}

const pauseUpload = (localId: string): void =>
  handleUploadAction(uploadQueue.pauseUpload(localId));
const resumeUpload = (localId: string): void =>
  handleUploadAction(uploadQueue.resumeUpload(localId));
const retryUpload = (localId: string): void =>
  handleUploadAction(uploadQueue.retryUpload(localId));
const reselectUpload = (localId: string, file: File): void =>
  uploadQueue.reselectUpload(localId, file);
const cancelUpload = (localId: string): void =>
  handleUploadAction(uploadQueue.cancelUpload(localId));
const removeUpload = (localId: string): void =>
  handleUploadAction(uploadQueue.removeUploadById(localId));

async function clearUploads(): Promise<void> {
  await Promise.all(
    [...uploadItems.value].map((item) => uploadQueue.removeUpload(item))
  );
}

async function submit(): Promise<void> {
  if (
    !capabilityAllowed.value ||
    isSubmitting.value ||
    hasBlockingUploads.value
  )
    return;

  const query = question.value.trim();
  if (query === "") {
    formError.value = t(`${props.localePrefix}.questionRequired`);
    return;
  }
  if (Array.from(query).length > MAX_QUERY_LENGTH) {
    formError.value = t(`${props.localePrefix}.questionTooLong`);
    return;
  }

  const capturedUploads = [...uploadItems.value];
  const capturedDescriptionInput = datasetDescription.value;
  let capturedDescription: string | undefined;
  try {
    if (
      capturedUploads.some(
        (item) => item.status === "completed" && item.purpose === "dataset"
      )
    ) {
      capturedDescription = normalizeDatasetDescription(
        capturedDescriptionInput
      );
    }
  } catch (error) {
    if (error instanceof DatasetDescriptionError) {
      formError.value = t(`${props.localePrefix}.datasetTooLong`);
      return;
    }
    throw error;
  }

  formError.value = "";
  isSubmitting.value = true;
  try {
    await run.submit({
      query,
      attachments: [...uploadQueue.completedAssetIds.value],
      ...(capturedDescription === undefined
        ? {}
        : { datasetDescription: capturedDescription }),
    });
    if (
      capturedDescription !== undefined &&
      datasetDescription.value === capturedDescriptionInput
    ) {
      datasetDescription.value = "";
    }
  } catch {
    formError.value = t(`${props.localePrefix}.submitFailed`);
  } finally {
    isSubmitting.value = false;
  }
}

function cancelRun(): void {
  remoteLifecycle.reset();
  run.cancel();
}

function resetRun(): void {
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
    downloadError.value = t(`${props.localePrefix}.downloadFailed`);
    return;
  }
  try {
    const response = await getChatdownloadURL({ obs_path: outputDir });
    const data = response as { code?: unknown; data?: unknown };
    if (data.code !== 200 || !isSafeDownloadUrl(data.data)) {
      downloadError.value = t(`${props.localePrefix}.downloadFailed`);
      return;
    }
    window.open(data.data, "_blank", "noopener,noreferrer");
  } catch {
    downloadError.value = t(`${props.localePrefix}.downloadFailed`);
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
.analysis-agent-page {
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

.analysis-agent-header,
.analysis-agent-form,
.analysis-agent-state,
.analysis-agent-artifact {
  width: min(100%, 1080px);
  margin: 0 auto;
}

.analysis-agent-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--phy-space-24);
}

.analysis-agent-eyebrow {
  margin: 0 0 var(--phy-space-8);
  color: var(--phy-color-accent-text);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.analysis-agent-header h1,
.analysis-agent-state h1 {
  margin: 0;
  font-size: clamp(1.5rem, 2.2vw, 2rem);
  line-height: 1.2;
}

.analysis-agent-subtitle,
.analysis-agent-state p,
.analysis-agent-hint,
.analysis-agent-empty {
  margin: var(--phy-space-8) 0 0;
  color: var(--phy-color-text-secondary);
  line-height: 1.6;
}

.analysis-agent-back,
.analysis-agent-submit,
.analysis-agent-cancel {
  min-height: var(--phy-control-height-default);
  padding: 0 var(--phy-space-16);
  border-radius: var(--phy-radius-sm);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.analysis-agent-back,
.analysis-agent-cancel {
  border: 1px solid var(--phy-color-border-control);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-action-text);
}

.analysis-agent-form {
  display: grid;
  gap: var(--phy-space-20);
  padding: var(--phy-space-24);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-lg);
  background: var(--phy-color-bg-elevated);
}

.analysis-agent-field {
  display: grid;
  gap: var(--phy-space-8);
}

.analysis-agent-field label {
  font-weight: 650;
}

.analysis-agent-field textarea {
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

.analysis-agent-field input[type="file"] {
  max-width: 100%;
  padding: var(--phy-space-8) 0;
  color: var(--phy-color-text-secondary);
  font: inherit;
}

.analysis-agent-file-list {
  display: grid;
  gap: var(--phy-space-8);
  margin: 0;
  padding: 0;
  list-style: none;
}

.analysis-agent-file-list li {
  min-width: 0;
  padding: var(--phy-space-8) var(--phy-space-12);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
}

.analysis-agent-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--phy-space-12);
}

.analysis-agent-submit {
  border: 1px solid var(--phy-color-action);
  background: var(--phy-color-action);
  color: var(--phy-color-action-contrast);
}

.analysis-agent-submit:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.analysis-agent-state,
.analysis-agent-degraded,
.analysis-agent-error,
.analysis-agent-empty {
  padding: var(--phy-space-16);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-elevated);
}

.analysis-agent-state {
  margin-block: auto;
  text-align: center;
}

.analysis-agent-degraded,
.analysis-agent-error {
  margin: 0 auto;
  color: var(--phy-color-danger-text, var(--phy-color-text-secondary));
}

.analysis-agent-artifact {
  min-height: 520px;
}

.analysis-agent-activity {
  display: grid;
  gap: var(--phy-space-8);
}

.analysis-agent-activity p {
  margin: 0;
  color: var(--phy-color-text-secondary);
}

@media (max-width: 720px) {
  .analysis-agent-page {
    padding: var(--phy-space-24) var(--phy-space-16) var(--phy-space-32);
  }

  .analysis-agent-header {
    flex-direction: column;
  }
}
</style>
