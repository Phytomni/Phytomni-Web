<template>
  <main
    ref="designRoot"
    class="digital-design-page"
    :data-focused-upload-id="focusedUploadLocalId || undefined"
    data-scroll-root="digital-design-agent"
    aria-labelledby="digital-design-title"
  >
    <section
      v-if="!capabilityLoaded"
      class="digital-design-state"
      data-test="design-capability-loading"
      role="status"
      aria-live="polite"
    >
      <h1 id="digital-design-title">{{ t("agents.digitalDesign.title") }}</h1>
      <p>{{ t("agents.digitalDesign.capabilityLoading") }}</p>
      <button
        type="button"
        class="digital-design-back"
        data-test="design-back"
        @click="goBack"
      >
        {{ t("common.back") }}
      </button>
    </section>

    <section
      v-else-if="!capabilityAllowed"
      class="digital-design-state"
      data-test="design-unavailable"
      role="status"
      aria-live="polite"
    >
      <h1 id="digital-design-title">
        {{ t("agents.digitalDesign.unavailableTitle") }}
      </h1>
      <p>{{ t("agents.digitalDesign.unavailableMessage") }}</p>
      <button
        type="button"
        class="digital-design-back"
        data-test="design-back"
        @click="goBack"
      >
        {{ t("common.back") }}
      </button>
    </section>

    <template v-else>
      <header class="digital-design-header">
        <div>
          <p class="digital-design-eyebrow">
            {{ t("agents.digitalDesign.agentLabel") }}
          </p>
          <h1 id="digital-design-title">
            {{ t("agents.digitalDesign.title") }}
          </h1>
          <p class="digital-design-subtitle">
            {{ t("agents.digitalDesign.subtitle") }}
          </p>
        </div>
        <button
          type="button"
          class="digital-design-back"
          data-test="design-back"
          @click="goBack"
        >
          {{ t("common.back") }}
        </button>
      </header>

      <form
        class="digital-design-form"
        novalidate
        @submit.prevent="submitDesign"
      >
        <div class="digital-design-field">
          <label for="design-question">
            {{ t("agents.digitalDesign.questionLabel") }}
          </label>
          <textarea
            id="design-question"
            v-model="question"
            data-test="design-question"
            :placeholder="t('agents.digitalDesign.questionPlaceholder')"
            rows="5"
          />
        </div>

        <div class="digital-design-resolver-grid">
          <div class="digital-design-field">
            <label for="design-gene-id">
              {{ t("agents.digitalDesign.geneIdLabel") }}
            </label>
            <input
              id="design-gene-id"
              v-model="geneId"
              data-test="design-gene-id"
              type="text"
              :placeholder="t('agents.digitalDesign.geneIdPlaceholder')"
              autocomplete="off"
            />
          </div>

          <div class="digital-design-field">
            <label for="design-species-code">
              {{ t("agents.digitalDesign.speciesCodeLabel") }}
            </label>
            <input
              id="design-species-code"
              v-model="speciesCode"
              data-test="design-species-code"
              type="text"
              :placeholder="t('agents.digitalDesign.speciesCodePlaceholder')"
              autocomplete="off"
            />
          </div>
        </div>

        <div class="digital-design-field">
          <label for="design-files">
            {{ t("agents.digitalDesign.contextFilesLabel") }}
          </label>
          <input
            id="design-files"
            data-test="design-files"
            type="file"
            multiple
            :disabled="!canPickAttachments || isSubmitting || isRunActive"
            @change="handleFiles"
          />
          <p class="digital-design-hint">
            {{ t("agents.digitalDesign.contextFilesHint") }}
          </p>
          <div class="digital-design-attachments">
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
            class="digital-design-hint"
            data-test="design-attachment-target-status"
            role="status"
          >
            {{ t("chat.attachmentTargetUnavailable") }}
          </p>
        </div>

        <ul
          v-if="validationMessages.length"
          class="digital-design-error-list"
          data-test="design-validation"
          role="alert"
        >
          <li
            v-for="message in validationMessages"
            :key="message"
            class="digital-design-error"
          >
            {{ message }}
          </li>
        </ul>
        <p
          v-if="fileError"
          class="digital-design-error"
          data-test="design-file-error"
          role="alert"
        >
          {{ fileError }}
        </p>
        <p
          v-if="formError"
          class="digital-design-error"
          data-test="design-form-error"
          role="alert"
        >
          {{ formError }}
        </p>

        <div class="digital-design-actions">
          <button
            type="submit"
            class="digital-design-submit"
            data-test="design-submit"
            :disabled="
              isSubmitting ||
              isRunActive ||
              hasBlockingUploads ||
              attachmentTargetBlocked
            "
            @keydown.enter.prevent="submitDesign"
          >
            {{
              isSubmitting
                ? t("agents.digitalDesign.submitting")
                : t("agents.digitalDesign.submit")
            }}
          </button>
          <button
            v-if="isRunActive"
            type="button"
            class="digital-design-cancel"
            data-test="design-cancel"
            @click="cancelDesign"
          >
            {{ t("common.cancel") }}
          </button>
        </div>
      </form>

      <p
        v-if="trackingDegraded"
        class="digital-design-degraded"
        data-test="design-tracking-degraded"
        role="status"
        aria-live="polite"
      >
        {{ t("agents.digitalDesign.trackingDegraded") }}
      </p>
      <p
        v-if="displayedState.degraded"
        class="digital-design-degraded"
        data-test="design-degraded"
        role="status"
        aria-live="polite"
      >
        {{ t("agents.digitalDesign.degraded") }}
      </p>

      <section
        v-if="hasRun"
        class="digital-design-artifact"
        data-test="design-artifact"
      >
        <ResearchArtifactShell
          :title="t('agents.digitalDesign.reportTitle')"
          :metadata="t('agents.digitalDesign.agentLabel')"
          :status="reportStatusLabel"
          :report-status="reportStatus"
          :tab-labels="tabLabels"
          artifact-id="digital-design-artifact"
          :back-label="t('common.back')"
          :close-label="t('common.close')"
          :action-label="t('agents.digitalDesign.reset')"
          :tablist-label="t('agents.digitalDesign.sectionsLabel')"
          @back="goBack"
          @close="resetDesign"
          @action="resetDesign"
        >
          <template #content>
            <BotReportState
              :state="displayedState"
              :progress="reportProgress"
              :updated-at="reportUpdatedAt"
              ns="digital-design-agent"
              :labels="reportLabels"
              :failure-label="reportFailureLabel"
              :empty-report-label="t('agents.digitalDesign.emptyReport')"
            />
          </template>

          <template #evidence>
            <p
              class="digital-design-empty"
              data-test="design-evidence-empty"
              role="status"
            >
              {{ t("agents.digitalDesign.noEvidence") }}
            </p>
          </template>

          <template #activity>
            <div
              class="digital-design-activity"
              data-test="design-progress"
              role="status"
              aria-live="polite"
            >
              <p>{{ progressLabel }}</p>
              <p v-if="displayedState.failures.length">
                {{ t("agents.digitalDesign.degraded") }}
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
                :title-label="t('agents.digitalDesign.downloads')"
                :download-text="t('agents.digitalDesign.download')"
                :empty-label="t('agents.digitalDesign.noDownloads')"
              />
              <p
                v-if="downloadError"
                class="digital-design-error"
                data-test="design-download-error"
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
import BotArtifactList from "@/components/research/BotArtifactList.vue";
import BotReportState from "@/components/research/BotReportState.vue";
import ResearchArtifactShell from "@/components/research/ResearchArtifactShell.vue";
import ResultArchiveDelivery from "@/components/research/ResultArchiveDelivery.vue";
import AttachmentChipStrip from "@/views/chat/components/AttachmentChipStrip.vue";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import { userStore } from "@/stores";
import { useBotCapabilities } from "@/views/chat/composables/useBotCapabilities";
import {
  useBotRemoteAgentRun,
  type BotRemoteAgentRunState,
} from "@/views/chat/composables/useBotRemoteAgentRun";
import { useRemoteAgentLifecycle } from "@/views/chat/composables/useRemoteAgentLifecycle";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { useResultArchiveDelivery } from "@/views/chat/composables/useResultArchiveDelivery";
import { useResumableUploads } from "@/views/chat/composables/useResumableUploads";
import type { ChatAttachmentValidationError } from "@/views/chat/composables/useFileUpload";
import { isSafeBotObsPath, type BotProgress } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import type {
  AgentResultDelivery,
  ConversationArtifactLink,
} from "@/api/types";

const MAX_QUERY_LENGTH = 4000;
const MAX_GENE_ID_LENGTH = 128;
const MAX_SPECIES_CODE_LENGTH = 32;
const MAX_ATTACHMENT_ANNOUNCEMENT_FILENAME_LENGTH = 96;
const GENE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SPECIES_CODE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/u;
const SAFE_DIALOGUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

const props = defineProps<{ state?: BotLifecycleState }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { getChatState } = useChatStates();
const capabilities = useBotCapabilities("digital-design-agent-view");

const routeDialogueId =
  typeof route.query.dialogue_id === "string" ? route.query.dialogue_id : "";
const dialogueId = SAFE_DIALOGUE_ID.test(routeDialogueId)
  ? routeDialogueId
  : "digital-design-agent";
const uploadDialogueId = ref(dialogueId);
const currentUser = userStore();
const uploadUsername = computed(() => currentUser.name ?? "");
const run = useBotRemoteAgentRun({
  tool: "DigitalDesignAgent",
  dialogueId,
  getChatState,
  capabilities,
});
const remoteLifecycle = useRemoteAgentLifecycle({
  tool: "DigitalDesignAgent",
  run,
  dialogueId,
});

const question = ref("");
const geneId = ref("");
const speciesCode = ref("");
const validationMessages = ref<string[]>([]);
const fileError = ref("");
const attachmentAnnouncement = ref("");
const attachmentAnnouncementNonce = ref(0);
const focusedUploadLocalId = ref("");
const designRoot = ref<HTMLElement | null>(null);
const formError = ref("");
const downloadError = ref("");
const isSubmitting = ref(false);

const capabilityLoaded = computed(() => capabilities.loaded.value === true);
const digitalDesignCapability = computed(
  () => capabilities.byTool.value.DigitalDesignAgent
);
const digitalDesignProduct = REMOTE_AGENT_PRODUCT_REGISTRY.DigitalDesignAgent;
const capabilityAllowed = computed(() => {
  const capability = digitalDesignCapability.value;
  return (
    capabilityLoaded.value &&
    digitalDesignProduct.live === true &&
    capability?.enabled === true &&
    capability.execution === "agent_run" &&
    capability.resolver === true &&
    capability.artifacts === true
  );
});
const canPickAttachments = computed(
  () =>
    digitalDesignCapability.value?.attachments === true &&
    (digitalDesignCapability.value?.attachmentChannels?.length ?? 0) > 0 &&
    capabilities.upload.value.enabled === true
);
const uploadQueue = useResumableUploads({
  currentChatId: uploadDialogueId,
  getChatState,
  uploadCapability: capabilities.upload,
  username: uploadUsername,
  onValidationError: (error) => {
    const message = attachmentErrorMessage(error);
    fileError.value = message;
    announceAttachment(message);
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
    file: boundedAttachmentAnnouncementFileName(error.fileName ?? ""),
    maxFiles: capabilities.upload.value.max_attachments,
    maxFileMb: Math.ceil(
      capabilities.upload.value.max_file_bytes / 1024 / 1024
    ),
    maxTotalMb: Math.ceil(
      capabilities.upload.value.max_file_bytes / 1024 / 1024
    ),
  });
}

function boundedAttachmentAnnouncementFileName(fileName: string): string {
  const normalized = fileName
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return t("chat.upload.fileSuffixFallback");
  const codePoints = Array.from(normalized);
  if (codePoints.length <= MAX_ATTACHMENT_ANNOUNCEMENT_FILENAME_LENGTH) {
    return normalized;
  }
  return `${codePoints
    .slice(0, MAX_ATTACHMENT_ANNOUNCEMENT_FILENAME_LENGTH - 1)
    .join("")}…`;
}

function announceAttachment(message: string): void {
  attachmentAnnouncementNonce.value += 1;
  attachmentAnnouncement.value = "";
  nextTick(() => {
    attachmentAnnouncement.value = message;
  }).catch(() => undefined);
}

async function onAttachmentDuplicate(
  localId: string,
  fileName: string
): Promise<void> {
  focusedUploadLocalId.value = localId;
  announceAttachment(
    t("chat.upload.alreadyAttached", {
      file: boundedAttachmentAnnouncementFileName(fileName),
    })
  );
  await focusAttachmentChip(localId);
}

async function focusAttachmentChip(localId: string): Promise<void> {
  await nextTick();
  const index = uploadItems.value.findIndex((item) => item.localId === localId);
  if (index < 0) return;

  const directChips = designRoot.value?.querySelectorAll<HTMLButtonElement>(
    '[data-testid="attachment-chip"]'
  );
  if (index < 3) {
    directChips?.[index]?.focus();
    return;
  }

  const overflowChip = designRoot.value?.querySelector<HTMLButtonElement>(
    '[data-testid="attachment-chip-overflow"]'
  );
  if (!overflowChip) return;
  overflowChip.focus();
  overflowChip.click();
  await nextTick();
  const hiddenChip = designRoot.value?.querySelectorAll<HTMLButtonElement>(
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
const reportProgress = computed<BotProgress | null>(
  () => displayedState.value.projection?.progress ?? null
);
const reportUpdatedAt = computed(
  () => displayedState.value.projection?.reportUpdatedAt ?? null
);
const trackingDegraded = computed(
  () => displayedState.value.projection?.trackingDegraded === true
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
      return t("agents.digitalDesign.complete");
    case "degraded":
      return t("agents.digitalDesign.degraded");
    case "failed":
      return t("common.failed");
    default:
      return t("agents.digitalDesign.progress");
  }
});
const progressLabel = computed(() =>
  isRunActive.value
    ? t("agents.digitalDesign.progress")
    : reportStatusLabel.value
);
const reportLabels = computed(() => ({
  loading: t("agents.digitalDesign.progress"),
  degraded: t("agents.digitalDesign.degraded"),
  complete: t("agents.digitalDesign.complete"),
  failed: t("common.failed"),
}));
const reportFailureLabel = computed(() =>
  displayedState.value.failures.includes("unsupported_asset_format")
    ? t("agents.digitalDesign.unsupportedAssetFormat")
    : t("common.failed")
);
const tabLabels = computed(() => ({
  content: t("agents.digitalDesign.report"),
  evidence: t("agents.digitalDesign.evidence"),
  activity: t("agents.digitalDesign.activity"),
  downloads: t("agents.digitalDesign.downloads"),
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

function normalizedGeneId(value: string): string | null {
  const normalized = value.trim();
  return normalized &&
    Array.from(normalized).length <= MAX_GENE_ID_LENGTH &&
    GENE_ID_PATTERN.test(normalized)
    ? normalized
    : null;
}

function normalizedSpeciesCode(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized &&
    Array.from(normalized).length <= MAX_SPECIES_CODE_LENGTH &&
    SPECIES_CODE_PATTERN.test(normalized)
    ? normalized
    : null;
}

async function submitDesign(): Promise<void> {
  if (
    !capabilityAllowed.value ||
    isSubmitting.value ||
    isRunActive.value ||
    hasBlockingUploads.value ||
    attachmentTargetBlocked.value
  )
    return;

  validationMessages.value = [];
  formError.value = "";
  const normalizedQuestion = question.value.trim();
  const normalizedGene = normalizedGeneId(geneId.value);
  const normalizedSpecies = normalizedSpeciesCode(speciesCode.value);

  if (!normalizedQuestion) {
    formError.value = t("agents.digitalDesign.questionRequired");
  } else if (Array.from(normalizedQuestion).length > MAX_QUERY_LENGTH) {
    formError.value = t("agents.digitalDesign.questionTooLong");
  }
  if (!normalizedGene) {
    validationMessages.value.push(t("agents.digitalDesign.geneIdValidation"));
  }
  if (!normalizedSpecies) {
    validationMessages.value.push(
      t("agents.digitalDesign.speciesCodeValidation")
    );
  }
  if (formError.value || validationMessages.value.length) return;
  if (!normalizedGene || !normalizedSpecies) return;

  isSubmitting.value = true;
  try {
    await run.submit({
      query: normalizedQuestion,
      attachments: uploadQueue.completedAssetIds.value,
      resolver: {
        geneId: normalizedGene,
        speciesCode: normalizedSpecies,
      },
    });
    await clearUploads().catch(() => {
      const cleanupMessage = t("chat.upload.status.failed");
      fileError.value = cleanupMessage;
      announceAttachment(cleanupMessage);
    });
  } catch {
    formError.value = t("agents.digitalDesign.submitFailed");
  } finally {
    isSubmitting.value = false;
  }
}

function cancelDesign(): void {
  remoteLifecycle.reset();
  run.cancel();
}

function resetDesign(): void {
  remoteLifecycle.reset();
  run.reset();
  question.value = "";
  geneId.value = "";
  speciesCode.value = "";
  void clearUploads().catch(() => undefined);
  validationMessages.value = [];
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
    downloadError.value = t("agents.digitalDesign.downloadFailed");
    return;
  }
  try {
    const response = await getChatdownloadURL({ obs_path: outputDir });
    const data = response as { code?: unknown; data?: unknown };
    if (data.code !== 200 || !isSafeDownloadUrl(data.data)) {
      downloadError.value = t("agents.digitalDesign.downloadFailed");
      return;
    }
    window.open(data.data, "_blank", "noopener,noreferrer");
  } catch {
    downloadError.value = t("agents.digitalDesign.downloadFailed");
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
.digital-design-page {
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

.digital-design-header,
.digital-design-form,
.digital-design-state,
.digital-design-artifact {
  width: min(100%, 1080px);
  margin: 0 auto;
}

.digital-design-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--phy-space-24);
}

.digital-design-eyebrow {
  margin: 0 0 var(--phy-space-8);
  color: var(--phy-color-accent-text);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.digital-design-header h1,
.digital-design-state h1 {
  margin: 0;
  font-size: clamp(1.5rem, 2.2vw, 2rem);
  line-height: 1.2;
}

.digital-design-subtitle,
.digital-design-state p,
.digital-design-hint,
.digital-design-empty {
  margin: var(--phy-space-8) 0 0;
  color: var(--phy-color-text-secondary);
  line-height: 1.6;
}

.digital-design-back,
.digital-design-submit,
.digital-design-cancel {
  min-height: var(--phy-control-height-default);
  padding: 0 var(--phy-space-16);
  border-radius: var(--phy-radius-sm);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.digital-design-back,
.digital-design-cancel,
.digital-design-file-remove {
  border: 1px solid var(--phy-color-border-control);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-action-text);
}

.digital-design-form {
  display: grid;
  gap: var(--phy-space-20);
  padding: var(--phy-space-24);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-lg);
  background: var(--phy-color-bg-elevated);
}

.digital-design-field {
  display: grid;
  gap: var(--phy-space-8);
}

.digital-design-field label {
  font-weight: 650;
}

.digital-design-field textarea,
.digital-design-field input[type="text"] {
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

.digital-design-field textarea {
  resize: vertical;
}

.digital-design-field input[type="file"] {
  max-width: 100%;
  padding: var(--phy-space-8) 0;
  color: var(--phy-color-text-secondary);
  font: inherit;
}

.digital-design-resolver-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--phy-space-16);
}

.digital-design-error-list {
  display: grid;
  gap: var(--phy-space-8);
  margin: 0;
  padding: 0;
  list-style: none;
}

.digital-design-attachments {
  min-width: 0;
}

.digital-design-error {
  margin: 0;
  color: var(--phy-color-danger-text, var(--phy-color-text-muted));
  line-height: 1.5;
}

.digital-design-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--phy-space-12);
}

.digital-design-submit {
  border: 1px solid var(--phy-color-action);
  background: var(--phy-color-action);
  color: var(--phy-color-action-contrast);
}

.digital-design-submit:disabled {
  cursor: wait;
  opacity: 0.65;
}

.digital-design-degraded {
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

.digital-design-artifact {
  display: flex;
  min-height: 420px;
  overflow: hidden;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-lg);
}

.digital-design-activity {
  display: grid;
  gap: var(--phy-space-8);
}

.digital-design-activity p {
  margin: 0;
  color: var(--phy-color-text-secondary);
  line-height: 1.5;
}

.digital-design-back:focus-visible,
.digital-design-submit:focus-visible,
.digital-design-cancel:focus-visible,
.digital-design-field input:focus-visible,
.digital-design-field textarea:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

@media (max-width: 700px) {
  .digital-design-page {
    padding: var(--phy-space-24) var(--phy-space-16) var(--phy-space-32);
  }

  .digital-design-header {
    flex-direction: column-reverse;
  }

  .digital-design-resolver-grid {
    grid-template-columns: 1fr;
  }
}
</style>
