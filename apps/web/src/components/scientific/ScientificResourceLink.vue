<template>
  <button
    class="scientific-resource-link"
    type="button"
    @click="emit('activate', { id: resource.id, kind: resource.kind })"
  >
    {{ resource.name }}
  </button>
</template>

<script setup lang="ts">
import type {
  AuthorizedScientificResource,
  ScientificResourceActivation,
} from "@/utils/scientific-markdown/types";

defineProps<{
  resource: AuthorizedScientificResource & {
    kind: "attachment" | "markdown";
  };
}>();

const emit = defineEmits<{
  activate: [activation: ScientificResourceActivation];
}>();
</script>
