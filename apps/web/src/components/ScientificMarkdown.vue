<template>
  <div :class="['phy-markdown', `phy-markdown--${surface}`]">
    <pre v-if="showFallback" class="scientific-markdown__fallback">{{
      renderedSource
    }}</pre>
    <XMarkdown
      v-else
      :markdown="renderedSource"
      :allow-html="false"
      :enable-latex="true"
      :enable-breaks="true"
      :sanitize="true"
      :sanitize-options="sanitizeOptions"
      :need-view-code-btn="false"
      :secure-view-code="true"
      :remark-plugins="remarkPlugins"
      :rehype-plugins="rehypePlugins"
    >
      <template #a="slotProps">
        <ScientificRenderBoundary
          :reset-key="renderRevision"
          @error="handleNodeRenderError"
        >
          <ScientificImage
            v-if="imageResourceFor(slotHref(slotProps))"
            :resource="imageResourceFor(slotHref(slotProps))!"
            :alt="resourceAlt(slotProps)"
          />
          <ScientificCifViewer
            v-else-if="cifResourceFor(slotHref(slotProps))"
            :resource="cifResourceFor(slotHref(slotProps))!"
          />
          <ScientificResourceLink
            v-else-if="activatableResourceFor(slotHref(slotProps))"
            :resource="activatableResourceFor(slotHref(slotProps))!"
            @activate="emit('resource-activate', $event)"
          />
          <a
            v-else-if="citationFor(slotProps)"
            class="scientific-citation__link"
            :href="safeAnchorHref(slotHref(slotProps)) ?? '#'"
            :aria-label="citationLabel(slotProps)"
            @click="handleCitationClick($event, citationFor(slotProps)!)"
          >
            <component :is="slotProps.children" />
          </a>
          <a
            v-else-if="safeAnchorHref(slotHref(slotProps))"
            :href="safeAnchorHref(slotHref(slotProps))!"
            :target="opensInNewTab(slotHref(slotProps)) ? '_blank' : undefined"
            :rel="
              opensInNewTab(slotHref(slotProps))
                ? 'noopener noreferrer'
                : undefined
            "
          >
            <component :is="slotProps.children" />
          </a>
          <span
            v-else
            class="scientific-resource scientific-resource--unavailable"
          >
            {{ unavailableResourceLabel(resourceAlt(slotProps)) }}
          </span>
          <template #fallback>
            <span class="scientific-markdown__node-fallback">
              <component :is="slotProps.children" />
            </span>
          </template>
        </ScientificRenderBoundary>
      </template>
      <template #img="slotProps">
        <ScientificRenderBoundary
          :reset-key="renderRevision"
          @error="handleNodeRenderError"
        >
          <ScientificCifViewer
            v-if="cifResourceFor(slotHref(slotProps))"
            :resource="cifResourceFor(slotHref(slotProps))!"
          />
          <ScientificImage
            v-else-if="imageResourceFor(slotHref(slotProps))"
            :resource="imageResourceFor(slotHref(slotProps))!"
            :alt="resourceAlt(slotProps)"
          />
          <span
            v-else
            class="scientific-resource scientific-resource--unavailable"
          >
            {{ unavailableResourceLabel(resourceAlt(slotProps)) }}
          </span>
          <template #fallback>
            <span
              class="scientific-markdown__node-fallback scientific-resource scientific-resource--unavailable"
            >
              {{ unavailableResourceLabel(resourceAlt(slotProps)) }}
            </span>
          </template>
        </ScientificRenderBoundary>
      </template>
      <template #block-code="{ content, language }">
        <ScientificRenderBoundary
          :reset-key="renderRevision"
          @error="handleNodeRenderError"
        >
          <slot name="block-code" :content="content" :language="language">
            <pre><code :class="language ? `language-${language}` : undefined">{{ content }}</code></pre>
          </slot>
          <template #fallback>
            <pre class="scientific-markdown__node-fallback"><code
                :class="language ? `language-${language}` : undefined"
              >{{ content }}</code></pre>
          </template>
        </ScientificRenderBoundary>
      </template>
    </XMarkdown>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onErrorCaptured, ref, watch } from "vue";
import { XMarkdown } from "vue-element-plus-x";
import type { SanitizeOptions } from "vue-element-plus-x/types/XMarkdownCore/core";
import type { PluggableList } from "unified";
import ScientificCifViewer from "@/components/scientific/ScientificCifViewer.vue";
import ScientificImage from "@/components/scientific/ScientificImage.vue";
import ScientificRenderBoundary from "@/components/scientific/ScientificRenderBoundary.vue";
import ScientificResourceLink from "@/components/scientific/ScientificResourceLink.vue";
import { safeHrefValue } from "@/utils/sanitize-markup";
import {
  createScientificCitationRemarkPlugin,
  parseCitationBody,
  requireCitationNamespace,
} from "@/utils/scientific-markdown/citations";
import { rehypeScientificHeadings } from "@/utils/scientific-markdown/headings";
import {
  indexScientificResources,
  resourceFor,
  unavailableResourceLabel,
} from "@/utils/scientific-markdown/resources";
import type {
  AuthorizedScientificResource,
  MarkdownSurface,
  ScientificCitationActivation,
  ScientificHeading,
  ScientificResourceActivation,
} from "@/utils/scientific-markdown/types";

const props = withDefaults(
  defineProps<{
    source: string;
    surface?: MarkdownSurface;
    citationNamespace?: string;
    referenceCount?: number;
    streaming?: boolean;
    resources?: readonly AuthorizedScientificResource[];
  }>(),
  {
    surface: "reading",
    citationNamespace: "",
    referenceCount: 0,
    streaming: false,
    resources: () => [],
  }
);

const emit = defineEmits<{
  "citation-activate": [activation: ScientificCitationActivation];
  headings: [headings: ScientificHeading[]];
  "resource-activate": [activation: ScientificResourceActivation];
  "render-error": [category: "render"];
}>();

const renderedSource = ref(props.source);
const showFallback = ref(false);
const renderRevision = ref(0);
let pendingFrame: number | undefined;
let pendingSource = props.source;

const safeNamespace = computed(() =>
  props.citationNamespace
    ? requireCitationNamespace(props.citationNamespace)
    : ""
);
const resourceIndex = computed(() => indexScientificResources(props.resources));
let headingSignature = "";

const remarkPlugins = computed<PluggableList>(() => [
  [
    createScientificCitationRemarkPlugin(renderedSource.value),
    {
      namespace: safeNamespace.value,
      referenceCount: props.referenceCount,
    },
  ],
]);

const rehypePlugins = computed<PluggableList>(() => [
  [rehypeScientificHeadings, { onHeadings: publishHeadings }],
]);

const sanitizeOptions: SanitizeOptions = {
  sanitizeOptions: {
    tagNames: [
      "math",
      "semantics",
      "annotation",
      "mrow",
      "mi",
      "mo",
      "mn",
      "mtext",
      "mspace",
      "mover",
      "munder",
      "munderover",
      "msup",
      "msub",
      "msubsup",
      "mfrac",
      "msqrt",
      "mroot",
      "mtable",
      "mtr",
      "mtd",
    ],
    attributes: {
      a: ["href", "className", "ariaLabel"],
      h1: ["id"],
      h2: ["id"],
      h3: ["id"],
      h4: ["id"],
      h5: ["id"],
      h6: ["id"],
      sup: ["className"],
      span: ["className", "ariaHidden", "style"],
      math: ["xmlns", "display"],
      annotation: ["encoding"],
    },
    protocols: { href: ["http", "https", "mailto"] },
  },
};

function citationFor(
  slotProps: Record<string, unknown>
): ScientificCitationActivation | null {
  const label = citationLabel(slotProps);
  if (typeof label !== "string" || !label.startsWith("Citation ")) return null;
  const indices = parseCitationBody(label.slice("Citation ".length))?.indices;
  return indices && safeNamespace.value
    ? { namespace: safeNamespace.value, indices }
    : null;
}

function citationLabel(slotProps: Record<string, unknown>): string | undefined {
  const label = slotProps.ariaLabel ?? slotProps["aria-label"];
  return typeof label === "string" ? label : undefined;
}

function handleCitationClick(
  event: MouseEvent,
  activation: ScientificCitationActivation
): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  emit("citation-activate", activation);
}

function slotHref(slotProps: Record<string, unknown>): string {
  return typeof slotProps.href === "string"
    ? slotProps.href
    : typeof slotProps.src === "string"
      ? slotProps.src
      : "";
}

function resourceAlt(slotProps: Record<string, unknown>): string {
  return typeof slotProps.alt === "string" ? slotProps.alt : "";
}

function safeAnchorHref(href: string): string | null {
  return safeHrefValue(href);
}

function opensInNewTab(href: string): boolean {
  try {
    const target = new URL(href, window.location.href);
    return (
      (target.protocol === "http:" || target.protocol === "https:") &&
      target.origin !== window.location.origin
    );
  } catch {
    return false;
  }
}

function imageResourceFor(href: string) {
  return resourceFor(resourceIndex.value, href, "image");
}

function cifResourceFor(href: string) {
  return resourceFor(resourceIndex.value, href, "cif");
}

function activatableResourceFor(href: string) {
  const attachment = resourceFor(resourceIndex.value, href, "attachment");
  return attachment ?? resourceFor(resourceIndex.value, href, "markdown");
}

function publishHeadings(headings: ScientificHeading[]): void {
  const signature = headings
    .map((heading) => `${heading.id}|${heading.level}|${heading.text}`)
    .join("\n");
  if (signature === headingSignature) return;
  headingSignature = signature;
  emit("headings", headings);
}

function handleNodeRenderError(): void {
  emit("render-error", "render");
}

function cancelPendingFrame(): void {
  if (pendingFrame === undefined) return;
  cancelAnimationFrame(pendingFrame);
  pendingFrame = undefined;
}

function updateRenderedSource(source: string): void {
  showFallback.value = false;
  if (!props.streaming) {
    cancelPendingFrame();
    renderedSource.value = source;
    return;
  }
  pendingSource = source;
  if (pendingFrame !== undefined) return;
  pendingFrame = requestAnimationFrame(() => {
    renderedSource.value = pendingSource;
    pendingFrame = undefined;
  });
}

watch(() => props.source, updateRenderedSource, { immediate: true });
watch(renderedSource, () => {
  renderRevision.value += 1;
});
watch(
  () => props.resources,
  () => {
    renderRevision.value += 1;
  },
  { deep: true }
);
watch(
  () => props.streaming,
  (streaming) => {
    if (!streaming) updateRenderedSource(props.source);
  }
);

onErrorCaptured(() => {
  cancelPendingFrame();
  showFallback.value = true;
  emit("render-error", "render");
  return false;
});

onBeforeUnmount(cancelPendingFrame);
</script>
