<template>
  <div class="stream-message">
    <template v-for="item in presentationItems" :key="item.key">
      <ChatActivity
        v-if="item.kind === 'activity'"
        :blocks="item.blocks"
        :state-key="activityStateKeyFor(item.startIndex)"
        :expanded="isActivityExpanded(item.startIndex)"
        :streaming="streaming"
        :ns="citationNs"
        @update:expanded="(v) => onActivityExpanded(item.startIndex, v)"
      />
      <component
        :is="renderer(item.block.type)"
        v-else-if="renderer(item.block.type)"
        :block="item.block"
        :ns="citationNs"
        @action="onA2uiAction(item.block, $event)"
        @retry="onA2uiRetry(item.block)"
      />
    </template>
    <!--
      Live-session only: phyto.references → message.doc_list is wired for the
      current stream so [N] can target #m<index>-ref-N rows. The Go accumulator
      does not persist a dedicated streaming-reference field, so after history
      reload these safe links are unavailable unless a separate L2 server/API
      design lands — do not invent persisted rows here.
    -->
    <CitationReferenceList
      v-if="references && references.length > 0"
      :references="references"
      :ns="citationNs"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import CitationReferenceList from "@/components/CitationReferenceList.vue";
import ChatActivity from "./ChatActivity.vue";
import type { ContentBlock } from "../types";
import type { A2uiActionIntent } from "../streaming/a2uiContract";
import type { A2uiSurfaceActionEvent } from "../composables/useA2uiInteraction";
import { resolveBlockRenderer } from "../streaming/blockRegistry";
import {
  activityDisclosureStateKey,
  buildPresentationItems,
  resolveMessagePresentationKey,
} from "../streaming/presentation";

const props = withDefaults(
  defineProps<{
    blocks: ContentBlock[];
    /** Page-unique citation namespace (m<index>); empty/absent → literal [N]. */
    ns?: string;
    /** Live phyto.references rows (message.doc_list); render only when nonempty. */
    references?: unknown[];
    /** Server message id when present (preferred Activity identity). */
    messageId?: string;
    /** Runtime-only request-key stamp on the streaming placeholder. */
    streamPresentationKey?: string;
    /** Per-dialogue Activity open map from chatStates. */
    activityExpandedByMessage?: Record<string, boolean>;
    /** True while the AG-UI stream is still in flight. */
    streaming?: boolean;
  }>(),
  {
    activityExpandedByMessage: () => ({}),
    streaming: false,
  }
);

const emit = defineEmits<{
  "update:activity-expanded": [stateKey: string, expanded: boolean];
  "a2ui-action": [event: A2uiSurfaceActionEvent];
  "a2ui-retry": [surfaceId: string];
}>();

// Defense in depth: never pass a non-empty ns to markdown/reasoning (or the
// reference list) unless real reference rows exist — avoids dead #mN-ref-K
// anchors when a caller supplies ns without references.
const citationNs = computed(() =>
  props.references && props.references.length ? props.ns ?? "" : ""
);

const messageKey = computed(() =>
  resolveMessagePresentationKey({
    id: props.messageId,
    streamPresentationKey: props.streamPresentationKey,
  })
);

const presentationItems = computed(() => buildPresentationItems(props.blocks));

const renderer = (type: string) => resolveBlockRenderer(type);

function onA2uiAction(block: ContentBlock, intent: A2uiActionIntent) {
  const surfaceId = block.a2ui?.surface.surface_id;
  if (!surfaceId) return;
  emit("a2ui-action", { surfaceId, intent });
}

function onA2uiRetry(block: ContentBlock) {
  const surfaceId = block.a2ui?.surface.surface_id;
  if (!surfaceId) return;
  emit("a2ui-retry", surfaceId);
}

function activityStateKeyFor(startIndex: number): string | null {
  if (!messageKey.value) return null;
  return activityDisclosureStateKey(messageKey.value, startIndex);
}

function isActivityExpanded(startIndex: number): boolean {
  const key = activityStateKeyFor(startIndex);
  if (!key) return true;
  return props.activityExpandedByMessage?.[key] === true;
}

function onActivityExpanded(startIndex: number, expanded: boolean) {
  const key = activityStateKeyFor(startIndex);
  if (!key) return;
  emit("update:activity-expanded", key, expanded);
}
</script>
