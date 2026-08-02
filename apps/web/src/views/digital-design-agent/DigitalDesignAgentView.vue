<template>
  <main
    class="digital-design-page"
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
          <ul
            v-if="uploadItems.length"
            class="digital-design-file-list"
            data-test="design-file-list"
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
            :disabled="isSubmitting || hasBlockingUploads"
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
import ChatUploadCard from "@/views/chat/components/ChatUploadCard.vue";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import { userStore } from "@/stores";
import { useBotCapabilities } from "@/views/chat/composables/useBotCapabilities";
import {
  useBotRemoteAgentRun,
  type BotRemoteAgentRunState,
} from "@/views/chat/composables/useBotRemoteAgentRun";
import { useRemoteAgentLifecycle } from "@/views/chat/composables/useRemoteAgentLifecycle";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { useResumableUploads } from "@/views/chat/composables/useResumableUploads";
import type { ChatAttachmentValidationError } from "@/views/chat/composables/useFileUpload";
import { isSafeBotObsPath, type BotProgress } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";

const MAX_QUERY_LENGTH = 4000;
const MAX_GENE_ID_LENGTH = 128;
const MAX_SPECIES_CODE_LENGTH = 32;
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
    hasBlockingUploads.value
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
.digital-design-cancel,
.digital-design-file-remove {
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

.digital-design-file-list,
.digital-design-error-list {
  display: grid;
  gap: var(--phy-space-8);
  margin: 0;
  padding: 0;
  list-style: none;
}

.digital-design-file-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--phy-space-12);
  min-width: 0;
  padding: var(--phy-space-8) var(--phy-space-12);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
}

.digital-design-file-list li span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.digital-design-file-remove {
  flex: 0 0 auto;
  min-height: 2rem;
  padding-inline: var(--phy-space-8);
  font-size: 0.8125rem;
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
.digital-design-file-remove:focus-visible,
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
