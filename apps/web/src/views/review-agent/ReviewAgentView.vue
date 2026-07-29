<template>
  <AgentDemoShell
    :title="$t('agents.review.title')"
    :subtitle="$t('agents.review.subtitle')"
    @back="goBack"
  >
    <template #question>{{ REVIEW_CASE.question }}</template>
    <template #result>
      <CitedAnswer
        :content="REVIEW_CASE.content"
        :references="REVIEW_CASE.references"
        ns="review"
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
import { REVIEW_CASE } from "./review-case";

const router = useRouter();
const goBack = () => {
  router.back();
};
</script>
