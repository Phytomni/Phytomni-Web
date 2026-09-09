<template>
  <div ref="block" class="scientific-cif-block" :aria-busy="busy">
    <div class="scientific-cif-block__inline">
      <Teleport :to="dialogHost" :disabled="!enlarged || !dialogHost">
        <div class="scientific-cif-block__presentation">
          <div v-if="authorizedResource" class="scientific-cif-block__toolbar">
            <span v-show="!enlarged" class="scientific-cif-block__title">{{
              t("scientificCif.title")
            }}</span>
            <div class="scientific-cif-block__actions">
              <button
                type="button"
                role="switch"
                class="scientific-cif-block__control"
                :aria-checked="surfaceVisible"
                :disabled="state !== 'ready'"
                @click="toggleSurface"
              >
                {{ t("scientificCif.surface") }}
                <span>{{
                  t(surfaceVisible ? "scientificCif.on" : "scientificCif.off")
                }}</span>
              </button>
              <button
                type="button"
                class="scientific-cif-block__control"
                data-cif-action="reset"
                :disabled="state !== 'ready'"
                @click="resetView"
              >
                {{ t("scientificCif.reset") }}
              </button>
              <button
                v-show="!enlarged"
                type="button"
                class="scientific-cif-block__control"
                data-cif-action="enlarge"
                :disabled="state !== 'ready'"
                @click="enlargeStructure"
              >
                {{ t("scientificCif.enlarge") }}
              </button>
            </div>
          </div>
          <span
            :id="instructionsId"
            class="scientific-cif-block__instructions"
            >{{ t("scientificCif.keyboardHelp") }}</span
          >
          <div ref="host" class="scientific-cif-block__host"></div>
          <div v-if="busy" class="scientific-cif-block__state" role="status">
            <PhySkeleton :count="1" />
            {{ t(`scientificCif.${state}`) }}
          </div>
          <PhyErrorState
            v-else-if="state === 'error'"
            class="scientific-cif-block__state"
            :description="
              t(
                authorizedResource
                  ? 'scientificCif.error'
                  : 'scientificCif.unavailable'
              )
            "
            :retry-label="t('common.retry')"
            @retry="renderStructure"
          />
        </div>
      </Teleport>
    </div>
    <ElDialog
      v-model="enlarged"
      class="scientific-cif-dialog"
      :title="t('scientificCif.label')"
      :append-to-body="false"
      :destroy-on-close="false"
      :show-close="false"
      :close-on-press-escape="false"
      :close-on-click-modal="false"
      :lock-scroll="false"
      align-center
      @keydown="handleDialogKeyDown"
      @open-auto-focus="focusDialogClose"
      @opened="resizeStructure()"
      @closed="restoreInlineContext"
    >
      <template #header>
        <div class="scientific-cif-dialog__header">
          <span class="scientific-cif-block__title">{{
            t("scientificCif.title")
          }}</span>
          <button
            ref="closeButton"
            type="button"
            class="scientific-cif-block__control"
            data-cif-action="close"
            @click="enlarged = false"
          >
            {{ t("scientificCif.close") }}
          </button>
        </div>
      </template>
      <div ref="dialogHost" class="scientific-cif-dialog__host"></div>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import { ElDialog } from "element-plus";
import { useI18n } from "vue-i18n";
import {
  fit3DMolStructure,
  load3DMol,
  type ThreeDMolViewer,
} from "@/utils/3dmol";
import PhyErrorState from "@/components/state/PhyErrorState.vue";
import PhySkeleton from "@/components/state/PhySkeleton.vue";
import {
  indexScientificResources,
  MAX_SCIENTIFIC_TEXT_BYTES,
} from "@/utils/scientific-markdown/resources";
import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";

const props = defineProps<{
  resource: AuthorizedScientificResource & { kind: "cif" };
}>();

const { t } = useI18n();
const block = ref<HTMLElement | null>(null);
const host = ref<HTMLElement | null>(null);
const dialogHost = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const enlarged = ref(false);
const instructionsId = `scientific-cif-help-${useId()}`;
const surfaceVisible = ref(true);
const state = ref<"loadingSource" | "buildingSurface" | "ready" | "error">(
  "loadingSource"
);
const busy = computed(
  () => state.value === "loadingSource" || state.value === "buildingSurface"
);
const authorizedResource = computed(() => {
  const resource = indexScientificResources([props.resource]).get(
    props.resource.markdownHref.trim()
  );
  return resource?.kind === "cif" &&
    (resource.renderSource || resource.displayUrl)
    ? resource
    : null;
});
interface StructureOperation {
  controller: AbortController;
  target: HTMLElement;
  viewer?: ThreeDMolViewer;
  observer?: ResizeObserver;
  surfaceId?: number;
  surfacePending: boolean;
  invalidated: boolean;
  released: boolean;
  aspectScale: number;
  initialView?: number[];
  fitted: boolean;
}
let active: StructureOperation | undefined;
let disposed = false;
let inlineContext:
  | {
      opener: HTMLElement;
      scroll: { element: HTMLElement; top: number; left: number }[];
    }
  | undefined;

function enlargeStructure(event: MouseEvent): void {
  if (state.value !== "ready" || !(event.currentTarget instanceof HTMLElement))
    return;
  const scroll: NonNullable<typeof inlineContext>["scroll"] = [];
  for (
    let element = block.value?.parentElement;
    element && element !== document.body;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (
      /(auto|scroll)/.test(
        `${style.overflow} ${style.overflowY} ${style.overflowX}`
      )
    ) {
      scroll.push({
        element,
        top: element.scrollTop,
        left: element.scrollLeft,
      });
    }
  }
  inlineContext = { opener: event.currentTarget, scroll };
  enlarged.value = true;
}

function restoreInlineContext(): void {
  if (disposed || enlarged.value || !inlineContext) return;
  for (const { element, top, left } of inlineContext.scroll) {
    if (!element.isConnected) continue;
    element.scrollTop = top;
    element.scrollLeft = left;
  }
  if (inlineContext.opener.isConnected)
    inlineContext.opener.focus({ preventScroll: true });
}

async function focusDialogClose(): Promise<void> {
  // The public open-auto-focus event precedes Element Plus's deferred focus on
  // its non-tabbable root. Let that default finish before choosing an action.
  await nextTick();
  await nextTick();
  if (!disposed && enlarged.value && closeButton.value?.isConnected)
    closeButton.value.focus({ preventScroll: true });
}

function handleDialogKeyDown(event: KeyboardEvent): void {
  if (!enlarged.value || event.defaultPrevented) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    enlarged.value = false;
  } else if (
    event.key === "Tab" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    active?.target.isConnected &&
    !active.invalidated &&
    closeButton.value?.isConnected
  ) {
    // Native EP still sees the previous pointer reason on the first Tab.
    // Cover only this widget's two edges; let ordinary Tab and the original
    // event reach EP's dialog/document listeners unchanged.
    if (event.shiftKey && document.activeElement === closeButton.value) {
      event.preventDefault();
      active.target.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === active.target) {
      event.preventDefault();
      closeButton.value.focus({ preventScroll: true });
    }
  }
}

function scientificColor(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--phy-scientific-cif-${name}`)
    .trim();
}

function toggleSurface(): void {
  const operation = active;
  if (
    state.value !== "ready" ||
    !operation?.viewer ||
    operation.surfaceId === undefined
  )
    return;
  surfaceVisible.value = !surfaceVisible.value;
  operation.viewer.setSurfaceMaterialStyle(operation.surfaceId, {
    color: scientificColor("surface"),
    opacity: surfaceVisible.value ? 0.45 : 0,
  });
  operation.viewer.render();
}

function resetView(): void {
  const operation = active;
  if (state.value !== "ready" || !operation?.viewer || !operation.initialView)
    return;
  operation.viewer.setView([...operation.initialView]);
  operation.viewer.resize();
  operation.viewer.zoomTo();
  operation.viewer.render();
  fitInitialFraming(operation);
  operation.viewer.render();
}

function handleKeyDown(event: KeyboardEvent): void {
  const operation = active;
  if (
    state.value !== "ready" ||
    !operation?.viewer ||
    event.currentTarget !== operation.target ||
    event.target !== operation.target ||
    document.activeElement !== operation.target ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.isComposing
  )
    return;
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };
  const direction = arrows[event.key];
  if (direction) {
    if (event.shiftKey)
      operation.viewer.translateScene(direction[0] * 20, direction[1] * 20);
    else
      operation.viewer.rotate(
        (direction[0] || direction[1]) * 10,
        direction[0] ? "y" : "x"
      );
  } else if (event.key === "+" || event.key === "=") operation.viewer.zoom(1.2);
  else if (event.key === "-") operation.viewer.zoom(1 / 1.2);
  else return;
  event.preventDefault();
  event.stopPropagation();
  operation.viewer.render();
}

function handlePointerDown(event: PointerEvent): void {
  if (active && !active.invalidated && event.currentTarget === active.target)
    active.target.focus({ preventScroll: true });
}

function fitContainerAspect(operation: StructureOperation): void {
  const { target, viewer } = operation;
  if (!viewer || !target.offsetWidth || !target.offsetHeight) return;
  // Native orthographic projection fixes horizontal FOV; preserve the user's
  // zoom, pan and rotation while compensating relative short-axis availability.
  const nextScale = Math.min(1, target.offsetHeight / target.offsetWidth);
  if (nextScale !== operation.aspectScale)
    viewer.zoom(nextScale / operation.aspectScale);
  operation.aspectScale = nextScale;
}

function fitInitialFraming(operation: StructureOperation): void {
  if (!operation.viewer) return;
  operation.fitted = fit3DMolStructure(operation.viewer, operation.target);
  if (operation.fitted)
    operation.aspectScale = Math.min(
      1,
      operation.target.offsetHeight / operation.target.offsetWidth
    );
}

function release(operation: StructureOperation): void {
  if (operation.released || operation.surfacePending) return;
  operation.released = true;
  // clear owns every surface on this captured viewer, including its known ID.
  // Never removeSurface after clear, or clear while a native worker still writes.
  operation.viewer?.clear?.();
  operation.surfaceId = undefined;
  operation.viewer = undefined;
}

function invalidate(operation: StructureOperation | undefined): void {
  if (!operation || operation.invalidated) return;
  operation.invalidated = true;
  operation.controller.abort();
  operation.target.removeAttribute("data-scientific-cif-ready");
  operation.observer?.disconnect();
  operation.target.removeEventListener("keydown", handleKeyDown);
  operation.target.removeEventListener("pointerdown", handlePointerDown);
  operation.viewer?.stopAnimate?.();
  operation.target.remove();
  release(operation);
}

function failOperation(operation: StructureOperation): void {
  invalidate(operation);
  if (active === operation && !disposed) state.value = "error";
}

function resizeStructure(
  operation: StructureOperation | undefined = active
): void {
  if (
    !operation?.viewer ||
    active !== operation ||
    operation.invalidated ||
    !operation.target.offsetWidth ||
    !operation.target.offsetHeight
  )
    return;
  try {
    operation.viewer.resize();
    operation.viewer.render();
    if (operation.target.dataset.scientificCifReady === "true") {
      if (operation.fitted) fitContainerAspect(operation);
      else fitInitialFraming(operation);
    }
  } catch {
    failOperation(operation);
  }
}

function cleanup(): void {
  disposed = true;
  enlarged.value = false;
  inlineContext = undefined;
  invalidate(active);
  active = undefined;
}

async function renderStructure(): Promise<void> {
  enlarged.value = false;
  invalidate(active);
  active = undefined;
  const resource = authorizedResource.value;
  if (!host.value || disposed) return;
  if (!resource) {
    state.value = "error";
    return;
  }
  state.value = "loadingSource";
  surfaceVisible.value = true;
  const target = document.createElement("div");
  target.className = "scientific-cif-viewer";
  target.setAttribute("aria-label", t("scientificCif.label"));
  target.setAttribute("aria-describedby", instructionsId);
  target.tabIndex = 0;
  target.addEventListener("keydown", handleKeyDown);
  target.addEventListener("pointerdown", handlePointerDown);
  target.dataset.scientificCifReady = "pending";
  host.value.replaceChildren(target);
  const operation: StructureOperation = {
    controller: new AbortController(),
    target,
    surfacePending: false,
    invalidated: false,
    released: false,
    aspectScale: 1,
    fitted: false,
  };
  active = operation;
  const isCurrent = () =>
    !disposed && active === operation && !operation.invalidated;

  try {
    const module = await load3DMol();
    if (!isCurrent()) return;
    const viewer = module.createViewer(target, {
      backgroundColor: scientificColor("background"),
      antialias: true,
      cartoonQuality: 12,
      disableFog: true,
    });
    operation.viewer = viewer;
    if (typeof ResizeObserver !== "undefined") {
      operation.observer = new ResizeObserver(() => {
        resizeStructure(operation);
      });
      operation.observer.observe(target);
    }
    let content: string;
    if (resource.renderSource) {
      content = await resource.renderSource.read(operation.controller.signal);
    } else {
      if (!resource.displayUrl) throw new Error("CIF resource unavailable");
      const response = await fetch(resource.displayUrl, {
        signal: operation.controller.signal,
      });
      if (!response.ok) throw new Error("CIF request failed");
      content = await response.text();
    }
    if (!isCurrent()) return;
    if (
      typeof content !== "string" ||
      !content.trim() ||
      new TextEncoder().encode(content).length > MAX_SCIENTIFIC_TEXT_BYTES ||
      /^\s*(?:<!doctype\s+html|<html\b)/i.test(content)
    )
      throw new Error("CIF resource unavailable");
    viewer.addModel(content, "cif");
    const atoms = viewer.selectedAtoms({});
    if (
      !atoms.length ||
      atoms.some((atom) => ![atom.x, atom.y, atom.z].every(Number.isFinite))
    ) {
      throw new Error("CIF model unavailable");
    }
    viewer.setProjection("orthographic");
    viewer.setViewStyle({
      style: "outline",
      color: scientificColor("outline"),
      width: 0.018,
      maxpixels: 0.6,
    });
    viewer.setStyle(
      {},
      {
        cartoon: {
          color: scientificColor("cartoon"),
          style: "oval",
          thickness: 0.24,
          arrows: true,
        },
      }
    );
    viewer.zoomTo();
    viewer.rotate(20, "y");
    viewer.rotate(-18, "x");
    viewer.render();
    fitInitialFraming(operation);
    operation.initialView = [...viewer.getView()];
    state.value = "buildingSurface";
    const surface = viewer.addSurface(
      "SES",
      { color: scientificColor("surface"), opacity: 0.45 },
      {}
    );
    operation.surfaceId = surface.surfid;
    operation.surfacePending = true;
    try {
      await surface;
    } finally {
      operation.surfacePending = false;
      if (operation.invalidated) release(operation);
    }
    if (!isCurrent()) return;
    if (operation.fitted) fitContainerAspect(operation);
    else fitInitialFraming(operation);
    viewer.render();
    target.dataset.scientificCifReady = "true";
    state.value = "ready";
  } catch {
    if (!isCurrent()) return;
    failOperation(operation);
  }
}

onMounted(renderStructure);
watch(
  [enlarged, dialogHost],
  async () => {
    await nextTick();
    if (disposed) return;
    resizeStructure();
    if (!enlarged.value) restoreInlineContext();
  },
  { flush: "post" }
);
watch(authorizedResource, renderStructure, { flush: "post" });
watch(
  () => t("scientificCif.label"),
  (label) => active?.target.setAttribute("aria-label", label)
);
onBeforeUnmount(cleanup);
</script>

<style scoped>
.scientific-cif-block {
  position: relative;
  min-width: 0;
}

.scientific-cif-block__host {
  min-width: 0;
  container-type: inline-size;
}

.scientific-cif-block__host :deep(.scientific-cif-viewer) {
  position: relative;
  width: 100%;
  height: clamp(min(280px, 60dvh), 62cqi, min(920px, 76dvh));
  margin: var(--phy-space-12) 0;
  overflow: hidden;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-scientific-cif-background);
}

.scientific-cif-block__host :deep(.scientific-cif-viewer > canvas) {
  max-width: 100%;
  max-height: 100%;
}

.scientific-cif-block__state {
  padding: var(--phy-space-16);
  color: var(--phy-color-text-secondary);
  font-family: var(--phy-font-shell);
}

.scientific-cif-block__toolbar,
.scientific-cif-block__actions {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--phy-space-8);
}

.scientific-cif-block__toolbar {
  justify-content: space-between;
  font-family: var(--phy-font-shell);
  color: var(--phy-color-text);
}

.scientific-cif-block__title {
  font-weight: 600;
}

.scientific-cif-block :deep(.scientific-cif-dialog) {
  --el-dialog-border-radius: var(--phy-radius-lg);
  width: min(1440px, calc(100% - 32px));
  max-height: calc(100dvh - 32px);
  margin: auto;
  overflow: auto;
  font-family: var(--phy-font-shell);
}

.scientific-cif-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--phy-space-8);
}

.scientific-cif-block__control {
  display: inline-flex;
  align-items: center;
  gap: var(--phy-space-8);
  min-height: var(--phy-control-height-default);
  padding: var(--phy-space-8) var(--phy-space-12);
  border: 1px solid var(--phy-color-border-control);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-text-secondary);
  cursor: pointer;
  font: inherit;
}

.scientific-cif-block__control:disabled {
  color: var(--phy-color-text-disabled);
  cursor: not-allowed;
}

.scientific-cif-block__control[aria-checked="true"] {
  color: var(--phy-color-accent-text);
  border-color: var(--phy-color-accent-text);
}

.scientific-cif-block__control:focus-visible,
.scientific-cif-block__host :deep(.scientific-cif-viewer:focus-visible) {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.scientific-cif-block__instructions {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (forced-colors: active) {
  .scientific-cif-block__control {
    border-color: ButtonText;
  }

  .scientific-cif-block__control[aria-checked="true"] {
    border-width: 2px;
  }

  .scientific-cif-block__control:disabled {
    color: GrayText;
    border-color: GrayText;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scientific-cif-block :deep(.dialog-fade-enter-active),
  .scientific-cif-block :deep(.dialog-fade-leave-active),
  .scientific-cif-block :deep(.dialog-fade-enter-active .el-dialog),
  .scientific-cif-block :deep(.dialog-fade-leave-active .el-dialog) {
    animation: none;
    transition: none;
  }
}
</style>
