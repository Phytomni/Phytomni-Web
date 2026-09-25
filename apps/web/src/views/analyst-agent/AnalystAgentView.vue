<template>
  <RemoteAnalysisAgentWorkspace
    tool="AnalystAgent"
    locale-prefix="agents.analyst"
    :state="state"
  />
</template>

<script setup lang="ts">
import RemoteAnalysisAgentWorkspace from "@/views/analysis-agent/RemoteAnalysisAgentWorkspace.vue";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";

defineProps<{ state?: BotLifecycleState }>();
</script>
