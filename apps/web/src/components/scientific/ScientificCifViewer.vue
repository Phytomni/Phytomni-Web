<template>
  <div
    v-if="authorizedResource"
    ref="container"
    class="scientific-cif-viewer"
    aria-label="Scientific structure viewer"
  ></div>
  <span v-else class="scientific-resource scientific-resource--unavailable"
    >Resource unavailable</span
  >
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { load3DMol, type ThreeDMolViewer } from "@/utils/3dmol";
import {
  indexScientificResources,
  MAX_SCIENTIFIC_TEXT_BYTES,
} from "@/utils/scientific-markdown/resources";
import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";

const props = defineProps<{
  resource: AuthorizedScientificResource & { kind: "cif" };
}>();

const container = ref<HTMLElement | null>(null);
const authorizedResource = computed(() => {
  const resource = indexScientificResources([props.resource]).get(
    props.resource.markdownHref.trim()
  );
  return resource?.kind === "cif" &&
    (resource.renderSource || resource.displayUrl)
    ? resource
    : null;
});
let controller: AbortController | undefined;
let viewer: ThreeDMolViewer | undefined;
let resizeObserver: ResizeObserver | undefined;
let disposed = false;
let revision = 0;
let aspectScale = 1;

function fitContainerAspect(): void {
  const target = container.value;
  if (!target || !viewer || !target.offsetWidth || !target.offsetHeight) return;
  // 3Dmol's zoomTo fits the vertical FOV; portrait containers also need
  // horizontal space. Relative zoom preserves the user's zoom, pan and rotation.
  const nextScale = Math.min(1, target.offsetWidth / target.offsetHeight);
  if (nextScale !== aspectScale) viewer.zoom(nextScale / aspectScale);
  aspectScale = nextScale;
}

function releaseResources(): void {
  controller?.abort();
  controller = undefined;
  container.value?.removeAttribute("data-scientific-cif-ready");
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  viewer?.stopAnimate?.();
  viewer?.clear?.();
  viewer = undefined;
  aspectScale = 1;
}

function cleanup(): void {
  disposed = true;
  revision += 1;
  releaseResources();
}

async function renderStructure(): Promise<void> {
  const currentRevision = ++revision;
  releaseResources();
  const target = container.value;
  const resource = authorizedResource.value;
  if (!target || !resource || disposed) return;
  target.replaceChildren();
  target.dataset.scientificCifReady = "pending";
  const currentController = new AbortController();
  controller = currentController;
  const isCurrent = () =>
    !disposed &&
    revision === currentRevision &&
    !currentController.signal.aborted;

  try {
    const module = await load3DMol();
    if (!isCurrent() || !container.value) return;
    viewer = module.createViewer(container.value, {
      backgroundColor: "#f5f5f5",
    });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (!isCurrent() || !target.offsetWidth || !target.offsetHeight) return;
        viewer?.resize();
        if (target.dataset.scientificCifReady === "true") fitContainerAspect();
        viewer?.render();
      });
      resizeObserver.observe(container.value);
    }
    let content: string;
    if (resource.renderSource) {
      content = await resource.renderSource.read(currentController.signal);
      if (
        typeof content !== "string" ||
        !content.trim() ||
        new TextEncoder().encode(content).length > MAX_SCIENTIFIC_TEXT_BYTES ||
        /^\s*(?:<!doctype\s+html|<html\b)/i.test(content)
      )
        throw new Error("CIF resource unavailable");
    } else {
      if (!resource.displayUrl) throw new Error("CIF resource unavailable");
      const response = await fetch(resource.displayUrl, {
        signal: currentController.signal,
      });
      if (!response.ok) throw new Error("CIF request failed");
      content = await response.text();
    }
    if (!isCurrent() || !viewer) return;
    viewer.addModel(content, "cif");
    viewer.setStyle(
      {},
      {
        cartoon: { color: "spectrum" },
        stick: { colorscheme: "Jmol" },
      }
    );
    viewer.zoomTo();
    fitContainerAspect();
    viewer.render();
    viewer.animate();
    target.dataset.scientificCifReady = "true";
  } catch {
    if (!isCurrent()) return;
    releaseResources();
    target.textContent = "Structure unavailable";
  }
}

onMounted(renderStructure);
watch(authorizedResource, renderStructure, { flush: "post" });
onBeforeUnmount(cleanup);
</script>
