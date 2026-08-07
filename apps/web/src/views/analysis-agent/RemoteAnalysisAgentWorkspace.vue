<template>
  <main
    ref="workspaceRoot"
    class="analysis-agent-page"
    :data-focused-upload-id="focusedUploadLocalId || undefined"
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
          <div class="analysis-agent-attachments">
            <AttachmentChipStrip
              :items="uploadItems"
              :announcement="attachmentAnnouncement"
              :announcement-nonce="attachmentAnnouncementNonce"
              @pause="pauseUpload"
              @resume="resumeUpload"
              @retry="retryUpload"
              @reselect="reselectUpload"
              @cancel="cancelUpload"
              @remove="removeUpload"
            />
          </div>
          <p
            v-if="attachmentTargetBlocked"
            class="analysis-agent-hint"
            :data-test="`${agentKey}-attachment-target-status`"
            role="status"
          >
            {{ t("chat.attachmentTargetUnavailable") }}
          </p>
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
            :disabled="
              isSubmitting || hasBlockingUploads || attachmentTargetBlocked
            "
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
            <ResultArchiveDelivery
              v-if="isResultArchiveV1"
              :delivery="displayedState.delivery"
              :artifacts="displayedState.artifactLinks"
              :retrying="archiveRetrying"
              @download="downloadResultArchive"
              @retry="retryResultArchive"
            />
            <template v-else>
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
          </template>
        </ResearchArtifactShell>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { getChatdownloadURL } from "@/api/chat";
import AgentDisplayName from "@/components/AgentDisplayName.vue";
import BotArtifactList from "@/components/research/BotArtifactList.vue";
import BotReportState from "@/components/research/BotReportState.vue";
import ResearchArtifactShell from "@/components/research/ResearchArtifactShell.vue";
import ResultArchiveDelivery from "@/components/research/ResultArchiveDelivery.vue";
import {
  REMOTE_AGENT_PRODUCT_REGISTRY,
  type RemoteAgentTool,
} from "@/constants/agents";
import { userStore } from "@/stores";
import AttachmentChipStrip from "@/views/chat/components/AttachmentChipStrip.vue";
import {
  useBotCapabilities,
  type AttachmentChannel,
} from "@/views/chat/composables/useBotCapabilities";
import type { ChatAttachmentValidationError } from "@/views/chat/composables/useFileUpload";
import {
  useBotRemoteAgentRun,
  type BotRemoteAgentRunState,
} from "@/views/chat/composables/useBotRemoteAgentRun";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { useResultArchiveDelivery } from "@/views/chat/composables/useResultArchiveDelivery";
import { useRemoteAgentLifecycle } from "@/views/chat/composables/useRemoteAgentLifecycle";
import { useResumableUploads } from "@/views/chat/composables/useResumableUploads";
import { isSafeBotObsPath, type BotProgress } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import type {
  AgentResultDelivery,
  ConversationArtifactLink,
} from "@/api/types";

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
const fileError = ref("");
const attachmentAnnouncement = ref("");
const attachmentAnnouncementNonce = ref(0);
const focusedUploadLocalId = ref("");
const workspaceRoot = ref<HTMLElement | null>(null);
const formError = ref("");
const downloadError = ref("");
const isSubmitting = ref(false);

const capabilityLoaded = computed(() => capabilities.loaded.value === true);
const product = computed(() => REMOTE_AGENT_PRODUCT_REGISTRY[props.tool]);
const agentCapability = computed(() => capabilities.byTool.value[props.tool]);
const attachmentChannels = computed<AttachmentChannel[]>(
  () => agentCapability.value?.attachmentChannels ?? []
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
    attachmentChannels.value.length > 0 &&
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
  onDuplicate: (localId, fileName) => {
    onAttachmentDuplicate(localId, fileName).catch(() => undefined);
  },
});
const uploadItems = computed(() => getChatState(dialogueId).fileList ?? []);
const hasBlockingUploads = uploadQueue.hasBlockingUploads;
const attachmentTargetBlocked = computed(
  () => uploadItems.value.length > 0 && !canPickAttachments.value
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

async function onAttachmentDuplicate(
  localId: string,
  fileName: string
): Promise<void> {
  focusedUploadLocalId.value = localId;
  attachmentAnnouncementNonce.value += 1;
  attachmentAnnouncement.value = "";
  await nextTick();
  attachmentAnnouncement.value = t("chat.upload.alreadyAttached", {
    file: fileName,
  });
  await focusAttachmentChip(localId);
}

async function focusAttachmentChip(localId: string): Promise<void> {
  await nextTick();
  const index = uploadItems.value.findIndex((item) => item.localId === localId);
  if (index < 0) return;

  const directChips = workspaceRoot.value?.querySelectorAll<HTMLButtonElement>(
    '[data-testid="attachment-chip"]'
  );
  if (index < 3) {
    directChips?.[index]?.focus();
    return;
  }

  const overflowChip = workspaceRoot.value?.querySelector<HTMLButtonElement>(
    '[data-testid="attachment-chip-overflow"]'
  );
  if (!overflowChip) return;
  overflowChip.focus();
  overflowChip.click();
  await nextTick();
  const hiddenChip = workspaceRoot.value?.querySelectorAll<HTMLButtonElement>(
    '[data-testid="attachment-chip-overflow-item"]'
  )[index - 3];
  hiddenChip?.focus();
}

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
  attachmentAnnouncement.value = "";
  if (canPickAttachments.value) {
    void uploadQueue.queueFiles(incoming).catch(() => undefined);
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
    hasBlockingUploads.value ||
    attachmentTargetBlocked.value
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

  formError.value = "";
  isSubmitting.value = true;
  try {
    await run.submit({
      query,
      attachments: [...uploadQueue.completedAssetIds.value],
    });
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
  void clearUploads().catch(() => undefined);
  fileError.value = "";
  formError.value = "";
  downloadError.value = "";
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
    { ...current.projection, status: "RUNNING", delivery: { ...delivery } },
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

.analysis-agent-attachments {
  min-width: 0;
  margin-top: var(--phy-space-4);
}

.analysis-agent-attachments :deep(.attachment-chip-strip) {
  min-width: 0;
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
