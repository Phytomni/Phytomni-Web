<template>
  <el-config-provider :locale="epLocale">
    <div
      v-if="errorMessage"
      data-testid="ui-remediation-visual-error"
      role="alert"
    >
      {{ errorMessage }}
    </div>
    <main
      v-else-if="fixture"
      data-testid="ui-remediation-visual-root"
      :data-fixture-state="fixture.state"
      :data-fixture-ready="fixtureReady ? 'true' : undefined"
      class="ui-remediation-visual-root"
    >
      <p class="ui-remediation-fixture-label">Visual fixture</p>
      <ChangePasswordView v-if="fixture.state === 'change-password'" />
      <MarkdownViewer
        v-else-if="fixture.state === 'markdown'"
        :content="markdownContent"
        :instant-message="false"
        surface="artifact"
      />
      <ReviewAgentView v-else-if="fixture.state === 'review'" />
      <BriefGeneAgentView v-else-if="fixture.state === 'brief-gene'" />
      <ChatCases v-else-if="fixture.state === 'cases'" />
      <AgentCapabilityPopover
        v-else
        :presentation="previewPresentation"
        trigger-class="ui-remediation-preview-trigger"
        data-testid="ui-remediation-preview-trigger"
      >
        {{ $t(previewPresentation.labelKey) }}
      </AgentCapabilityPopover>
    </main>
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import en from "element-plus/es/locale/lang/en";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { useAppStore } from "@/stores";
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import {
  AgentCapabilityPopover,
  CANONICAL_AGENT_PRESENTATIONS,
} from "@/components/agent";
import ChangePasswordView from "@/views/change-password/ChangePasswordView.vue";
import ReviewAgentView from "@/views/review-agent/ReviewAgentView.vue";
import BriefGeneAgentView from "@/views/brief-gene-agent/BriefGeneAgentView.vue";
import ChatCases from "@/views/chat/components/ChatCases.vue";
import type { UiRemediationFixture } from "./fixture-registry";

const props = defineProps<{
  fixture: UiRemediationFixture | null;
  errorMessage: string | null;
}>();
const fixtureReady = ref(false);
const appStore = useAppStore();
const epLocale = computed(() => (appStore.language === "zh-CN" ? zhCn : en));
const markdownContent = "#### 1. 基因定位与靶点设计";
const previewPresentation = computed(() =>
  props.fixture?.state === "review-preview"
    ? CANONICAL_AGENT_PRESENTATIONS.ReviewAgent
    : CANONICAL_AGENT_PRESENTATIONS.BriefGeneAgent
);

onMounted(() => {
  window.addEventListener(
    "ui-remediation-fixture-ready",
    () => {
      fixtureReady.value = true;
    },
    { once: true }
  );
});
</script>

<style scoped>
.ui-remediation-visual-root {
  min-height: 100vh;
}
.ui-remediation-fixture-label {
  margin: 0;
  padding: 8px 16px;
  color: var(--phy-color-text-muted);
  font-size: 12px;
}
</style>
