<template>
  <AgentDemoShell
    :title="$t('agents.briefGene.title')"
    :subtitle="$t('agents.briefGene.subtitle')"
    @back="goBack"
  >
    <template #question>{{ BRIEF_GENE_CASE.question }}</template>
    <template #result>
      <CitedAnswer
        :content="BRIEF_GENE_CASE.content"
        :references="BRIEF_GENE_CASE.references"
        ns="bg"
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
import { BRIEF_GENE_CASE } from "./brief-gene-case";

const router = useRouter();
const goBack = () => {
  router.back();
};
</script>
