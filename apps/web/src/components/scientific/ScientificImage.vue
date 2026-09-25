<template>
  <span v-if="displayUrl" ref="root" class="scientific-image">
    <img
      class="scientific-image__thumbnail clickable-image"
      :src="displayUrl"
      :alt="alt"
      :data-src="displayUrl"
      :data-alt="alt"
    />
    <el-dialog
      v-model="imageViewerVisible"
      title="Image preview"
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      width="min(800px, calc(100vw - var(--phy-space-32)))"
      center
    >
      <div
        ref="containerRef"
        class="scientific-image__dialog-container"
        @wheel="handleWheel"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseLeave"
      >
        <img
          ref="imageRef"
          class="scientific-image__dialog-image"
          :src="currentImageSrc"
          :alt="currentImageAlt"
          :style="imageStyle"
        />
      </div>
    </el-dialog>
  </span>
  <span v-else class="scientific-resource scientific-resource--unavailable"
    >Resource unavailable</span
  >
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useDeepGenomeImageViewer } from "@/composables/useDeepGenomeImageViewer";
import { safeHrefValue } from "@/utils/sanitize-markup";
import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";

const props = defineProps<{
  resource: AuthorizedScientificResource & { kind: "image" };
  alt: string;
}>();

const root = ref<HTMLElement | null>(null);
const displayUrl = computed(() =>
  props.resource.displayUrl ? safeHrefValue(props.resource.displayUrl) : null
);
const {
  imageViewerVisible,
  currentImageSrc,
  currentImageAlt,
  containerRef,
  imageRef,
  imageStyle,
  handleWheel,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
  handleMouseLeave,
  setupImageClickListeners,
  cleanupImageClickListeners,
} = useDeepGenomeImageViewer();

async function bindImage(): Promise<void> {
  cleanupImageClickListeners();
  await nextTick();
  setupImageClickListeners(root.value);
}

onMounted(bindImage);
watch(() => [props.resource.displayUrl, props.alt], bindImage);
onBeforeUnmount(cleanupImageClickListeners);
</script>
