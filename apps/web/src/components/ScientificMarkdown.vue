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
      :custom-attrs="customAttrs"
    >
      <template #block-code="{ content, language }">
        <slot name="block-code" :content="content" :language="language">
          <pre><code :class="language ? `language-${language}` : undefined">{{ content }}</code></pre>
        </slot>
      </template>
    </XMarkdown>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onErrorCaptured, ref, watch } from "vue";
import { XMarkdown } from "vue-element-plus-x";
import type {
  CustomAttrs,
  SanitizeOptions,
} from "vue-element-plus-x/types/XMarkdownCore/core";
import type { PluggableList } from "unified";
import {
  parseCitationBody,
  scientificCitationRemarkPlugin,
} from "@/utils/scientific-markdown/citations";
import type {
  MarkdownSurface,
  ScientificCitationActivation,
} from "@/utils/scientific-markdown/types";

const props = withDefaults(
  defineProps<{
    source: string;
    surface?: MarkdownSurface;
    citationNamespace?: string;
    referenceCount?: number;
    streaming?: boolean;
  }>(),
  {
    surface: "reading",
    citationNamespace: "",
    referenceCount: 0,
    streaming: false,
  }
);

const emit = defineEmits<{
  "citation-activate": [activation: ScientificCitationActivation];
  "render-error": [category: "render"];
}>();

const renderedSource = ref(props.source);
const showFallback = ref(false);
let pendingFrame: number | undefined;

const safeNamespace = computed(() =>
  props.citationNamespace.replace(/[^A-Za-z0-9-]/g, "")
);

const remarkPlugins = computed<PluggableList>(() => [
  [
    scientificCitationRemarkPlugin,
    {
      namespace: safeNamespace.value,
      referenceCount: props.referenceCount,
    },
  ],
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
      sup: ["className"],
      span: ["className", "ariaHidden", "style"],
      math: ["xmlns", "display"],
      annotation: ["encoding"],
    },
    protocols: { href: ["http", "https", "mailto"] },
  },
};

function readCitationIndices(node: {
  properties?: Record<string, unknown>;
}): number[] | null {
  const label = node.properties?.ariaLabel;
  if (typeof label !== "string" || !label.startsWith("Citation ")) return null;
  return parseCitationBody(label.slice("Citation ".length))?.indices ?? null;
}

const customAttrs: CustomAttrs = {
  a: (node, attrs) => {
    const indices = readCitationIndices(node);
    if (indices && safeNamespace.value) {
      return {
        ...attrs,
        class: "scientific-citation__link",
        onClick: (event: MouseEvent) => {
          event.preventDefault();
          emit("citation-activate", {
            namespace: safeNamespace.value,
            indices,
          });
        },
      };
    }
    return { ...attrs, target: "_blank", rel: "noopener noreferrer" };
  },
};

function cancelPendingFrame(): void {
  if (pendingFrame === undefined) return;
  cancelAnimationFrame(pendingFrame);
  pendingFrame = undefined;
}

function updateRenderedSource(source: string): void {
  showFallback.value = false;
  cancelPendingFrame();
  if (!props.streaming) {
    renderedSource.value = source;
    return;
  }
  pendingFrame = requestAnimationFrame(() => {
    renderedSource.value = source;
    pendingFrame = undefined;
  });
}

watch(() => props.source, updateRenderedSource, { immediate: true });
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
