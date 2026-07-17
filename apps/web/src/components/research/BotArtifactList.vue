<template>
  <section class="bot-artifact-list" aria-labelledby="bot-artifact-list-title">
    <h2 id="bot-artifact-list-title" class="bot-artifact-list__title">
      {{ titleLabel }}
    </h2>

    <ul v-if="downloadableArtifacts.length" class="bot-artifact-list__items">
      <li
        v-for="artifact in downloadableArtifacts"
        :key="artifact.id"
        class="bot-artifact-list__item"
      >
        <span class="bot-artifact-list__name" :title="artifact.path">
          {{ artifact.name }}
        </span>
        <button
          type="button"
          class="bot-artifact-list__download"
          :aria-label="downloadLabel(artifact.name)"
          data-test="bot-artifact-download"
          :data-artifact-id="artifact.id"
          @click="requestDownload(artifact)"
        >
          {{ downloadText }}
        </button>
      </li>
    </ul>

    <p
      v-if="hasWarnings || downloadableArtifacts.length === 0"
      class="bot-artifact-list__warning"
      role="status"
      data-test="bot-artifact-warning"
    >
      {{ emptyLabel }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { BotArtifact } from "@/views/chat/botProjection";

const props = withDefaults(
  defineProps<{
    artifacts?: readonly BotArtifact[];
    download?: (path: string) => void | Promise<void>;
    downloadAction?: (path: string) => void | Promise<void>;
    titleLabel?: string;
    downloadText?: string;
    emptyLabel?: string;
  }>(),
  {
    artifacts: () => [],
    downloadAction: undefined,
  }
);

const emit = defineEmits<{
  (event: "download", path: string): void;
}>();

const { t } = useI18n();
const titleLabel = computed(
  () => props.titleLabel || t("chat.actions.downloadAttachments")
);
const downloadText = computed(
  () => props.downloadText || t("chat.downloadFile")
);
const emptyLabel = computed(() => props.emptyLabel || t("common.warning"));

interface ArtifactRow {
  id: string;
  name: string;
  path: string;
  outputDir: string;
}

function isSafeObsPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    return false;
  }
  if (
    !value.startsWith("/obs/") ||
    value.length <= "/obs/".length ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes(":") ||
    /[\r\n\t ]/u.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return (
    segments.length >= 4 &&
    segments[2] !== "" &&
    segments
      .slice(3)
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function displayName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

const rows = computed(() => {
  const safeRows: ArtifactRow[] = [];
  let warning = props.artifacts.length === 0;

  props.artifacts.forEach((artifact, artifactIndex) => {
    const outputDir =
      artifact && typeof artifact.outputDir === "string"
        ? artifact.outputDir
        : "";
    const paths =
      artifact && Array.isArray(artifact.paths) ? artifact.paths : [];
    const directoryIsSafe = isSafeObsPath(outputDir);

    if (paths.length === 0) {
      warning = true;
      return;
    }

    paths.forEach((path, pathIndex) => {
      const belongsToDirectory =
        directoryIsSafe &&
        typeof path === "string" &&
        (path === outputDir || path.startsWith(`${outputDir}/`));
      if (!isSafeObsPath(path) || !belongsToDirectory) {
        warning = true;
        return;
      }

      safeRows.push({
        id: `${artifactIndex}-${pathIndex}`,
        name: displayName(path),
        path,
        outputDir,
      });
    });
  });

  return { safeRows, warning };
});

const downloadableArtifacts = computed(() => rows.value.safeRows);
const hasWarnings = computed(() => rows.value.warning);

function downloadLabel(name: string): string {
  return `${downloadText.value}: ${name}`;
}

function requestDownload(artifact: ArtifactRow): void {
  if (!isSafeObsPath(artifact.path) || !isSafeObsPath(artifact.outputDir)) {
    return;
  }
  (props.download ?? props.downloadAction)?.(artifact.outputDir);
  emit("download", artifact.outputDir);
}
</script>

<style scoped>
.bot-artifact-list {
  min-width: 0;
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.bot-artifact-list__title {
  margin: 0 0 var(--phy-space-16);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
}

.bot-artifact-list__items {
  display: grid;
  gap: var(--phy-space-8);
  margin: 0;
  padding: 0;
  list-style: none;
}

.bot-artifact-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--phy-space-12);
  min-width: 0;
  padding: var(--phy-space-12) 0;
  border-bottom: 1px solid var(--phy-color-border-subtle);
}

.bot-artifact-list__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bot-artifact-list__download {
  flex: 0 0 auto;
  min-height: var(--phy-control-height-default);
  padding: 0 var(--phy-space-12);
  border: 1px solid var(--phy-color-border-control);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-action-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.bot-artifact-list__download:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.bot-artifact-list__warning {
  margin: var(--phy-space-16) 0 0;
  color: var(--phy-color-text-muted);
}

@media (max-width: 599px) {
  .bot-artifact-list__item {
    align-items: stretch;
    flex-direction: column;
  }

  .bot-artifact-list__download {
    align-self: flex-start;
  }
}
</style>
