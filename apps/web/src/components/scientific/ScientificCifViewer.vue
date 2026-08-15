<template>
  <div
    v-if="displayUrl"
    ref="container"
    class="scientific-cif-viewer"
    aria-label="Scientific structure viewer"
  ></div>
  <span v-else class="scientific-resource scientific-resource--unavailable"
    >Resource unavailable</span
  >
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { load3DMol, type ThreeDMolViewer } from "@/utils/3dmol";
import { safeHrefValue } from "@/utils/sanitize-markup";
import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";

const props = defineProps<{
  resource: AuthorizedScientificResource & { kind: "cif" };
}>();

const container = ref<HTMLElement | null>(null);
const displayUrl = computed(() =>
  props.resource.displayUrl ? safeHrefValue(props.resource.displayUrl) : null
);
let controller: AbortController | undefined;
let viewer: ThreeDMolViewer | undefined;
let resizeObserver: ResizeObserver | undefined;
let disposed = false;

function releaseResources(): void {
  controller?.abort();
  controller = undefined;
  container.value?.removeAttribute("data-scientific-cif-ready");
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  viewer?.stopAnimate?.();
  viewer?.clear?.();
  viewer = undefined;
}

function cleanup(): void {
  disposed = true;
  releaseResources();
}

async function renderStructure(): Promise<void> {
  const target = container.value;
  const url = displayUrl.value;
  if (!target || !url) return;
  target.dataset.scientificCifReady = "pending";

  try {
    const module = await load3DMol();
    if (disposed || !container.value) return;
    viewer = module.createViewer(container.value, {
      backgroundColor: "#f5f5f5",
    });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        viewer?.resize();
        viewer?.render();
      });
      resizeObserver.observe(container.value);
    }
    controller = new AbortController();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("CIF request failed");
    const content = await response.text();
    if (disposed || controller.signal.aborted || !viewer) return;
    viewer.addModel(content, "cif");
    viewer.setStyle(
      {},
      {
        cartoon: { color: "spectrum" },
        stick: { colorscheme: "Jmol" },
      }
    );
    viewer.zoomTo();
    viewer.render();
    viewer.animate();
    target.dataset.scientificCifReady = "true";
  } catch {
    const aborted = controller?.signal.aborted ?? false;
    releaseResources();
    if (!disposed && !aborted && target) {
      target.textContent = "Structure unavailable";
    }
  }
}

onMounted(renderStructure);
onBeforeUnmount(cleanup);
</script>
