<template>
  <AgentDemoShell
    :title="$t('agents.knowledge.title')"
    :subtitle="$t('agents.knowledge.subtitle')"
    @back="goBack"
  >
    <template #question>{{ KNOWLEDGE_CASE.question }}</template>

    <template #result>
      <CitedAnswer
        :content="KNOWLEDGE_CASE.content"
        :references="KNOWLEDGE_CASE.references"
        ns="kb"
        surface="artifact"
      />
    </template>

    <template #footer>{{ $t("common.Tip") }}</template>
  </AgentDemoShell>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import CitedAnswer from "@/components/CitedAnswer.vue";
import AgentDemoShell from "@/components/demo/AgentDemoShell.vue";
import { KNOWLEDGE_CASE } from "./knowledge-case";

const router = useRouter();
const goBack = () => {
  router.back();
};
</script>
