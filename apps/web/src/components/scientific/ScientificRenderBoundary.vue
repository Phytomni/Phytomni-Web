<template>
  <slot v-if="!failed" />
  <slot v-else name="fallback" />
</template>

<script setup lang="ts">
import { onErrorCaptured, ref, watch } from "vue";

const props = defineProps<{ resetKey: unknown }>();

const emit = defineEmits<{ error: [] }>();
const failed = ref(false);

watch(
  () => props.resetKey,
  () => {
    failed.value = false;
  }
);

onErrorCaptured(() => {
  failed.value = true;
  emit("error");
  return false;
});
</script>
