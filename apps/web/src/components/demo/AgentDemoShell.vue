<template>
  <div class="agent-demo-shell" data-scroll-root="agent-demo">
    <header class="agent-demo-shell__header">
      <div class="agent-demo-shell__header-inner">
        <el-button
          class="agent-demo-shell__back"
          text
          :icon="ArrowLeft"
          data-test="agent-demo-back"
          @click="emit('back')"
        >
          {{ t("common.back") }}
        </el-button>

        <div class="agent-demo-shell__heading">
          <h1>{{ title }}</h1>
          <p>{{ subtitle }}</p>
        </div>

        <div class="agent-demo-shell__header-spacer" aria-hidden="true" />
      </div>
    </header>

    <main class="agent-demo-shell__body">
      <div
        :id="staticNoticeId"
        class="agent-demo-shell__status"
        data-test="agent-demo-static-badge"
        role="status"
      >
        <span class="agent-demo-shell__status-dot" aria-hidden="true" />
        {{ t("agents.demo.staticExample") }}
      </div>

      <section
        v-if="$slots.question"
        class="agent-demo-shell__question"
        data-test="agent-demo-question"
      >
        <div class="agent-demo-shell__question-label">
          {{ t("agents.demo.questionLabel") }}
        </div>
        <div class="agent-demo-shell__question-content">
          <slot name="question" />
        </div>
      </section>

      <section
        class="agent-demo-shell__result"
        data-test="agent-demo-result"
        :aria-describedby="staticNoticeId"
      >
        <slot name="result">
          <slot />
        </slot>
      </section>

      <div v-if="$slots.footer" class="agent-demo-shell__note">
        <slot name="footer" />
      </div>
    </main>

    <Footer class="agent-demo-shell__footer" />
  </div>
</template>

<script setup lang="ts">
import { getCurrentInstance } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowLeft } from "@element-plus/icons-vue";
import Footer from "@/components/Footer.vue";

defineProps<{
  title: string;
  subtitle: string;
}>();

const emit = defineEmits<{
  back: [];
}>();

const { t } = useI18n();
const staticNoticeId = `agent-demo-static-example-${
  getCurrentInstance()?.uid ?? "default"
}`;
</script>

<style scoped>
.agent-demo-shell {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.agent-demo-shell__header {
  position: sticky;
  top: 0;
  z-index: var(--phy-z-sticky);
  flex: 0 0 auto;
  border-bottom: 1px solid var(--phy-color-border-subtle);
  background: color-mix(in srgb, var(--phy-color-bg-elevated) 96%, transparent);
}

.agent-demo-shell__header-inner {
  display: grid;
  grid-template-columns: minmax(96px, 1fr) minmax(0, 760px) minmax(96px, 1fr);
  align-items: center;
  gap: var(--phy-space-16);
  width: min(100%, clamp(1160px, 78vw, 2000px));
  min-height: 76px;
  margin: 0 auto;
  padding: var(--phy-space-12) var(--phy-space-20);
  box-sizing: border-box;
}

.agent-demo-shell__back {
  justify-self: start;
  min-height: var(--phy-control-height-default);
  color: var(--phy-color-action-text);
}

.agent-demo-shell__heading {
  min-width: 0;
  text-align: center;
}

.agent-demo-shell__heading h1 {
  margin: 0;
  color: var(--phy-color-text);
  font-size: clamp(1.1rem, 1.35vw, 1.45rem);
  font-weight: 650;
  line-height: 1.25;
}

.agent-demo-shell__heading p {
  margin: var(--phy-space-4) 0 0;
  color: var(--phy-color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.45;
}

.agent-demo-shell__body {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  gap: var(--phy-space-16);
  width: min(100%, clamp(1160px, 78vw, 2000px));
  min-width: 0;
  margin: 0 auto;
  padding: var(--phy-space-24) var(--phy-space-20) var(--phy-space-40);
  box-sizing: border-box;
}

.agent-demo-shell__status {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--phy-space-8);
  min-height: 28px;
  padding: 0 var(--phy-space-12);
  border: 1px solid var(--phy-color-accent-soft);
  border-radius: var(--phy-radius-pill);
  background: var(--phy-color-accent-soft);
  color: var(--phy-color-accent-text);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.agent-demo-shell__status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.agent-demo-shell__question {
  width: min(100%, clamp(920px, 66vw, 1600px));
  margin-left: auto;
  padding: var(--phy-space-16) var(--phy-space-20);
  border: 1px solid var(--phy-color-bubble-user-border);
  border-radius: var(--phy-radius-lg) var(--phy-radius-lg) var(--phy-radius-sm)
    var(--phy-radius-lg);
  background: var(--phy-color-bubble-user);
  box-sizing: border-box;
}

.agent-demo-shell__question-label {
  margin-bottom: var(--phy-space-8);
  color: var(--phy-color-accent-text);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.agent-demo-shell__question-content {
  color: var(--phy-color-text);
  font-size: 0.98rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.agent-demo-shell__result {
  width: min(100%, clamp(1040px, 74vw, 1800px));
  min-width: 0;
  margin-right: auto;
  padding: var(--phy-space-24) var(--phy-space-24) var(--phy-space-20);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-lg);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
  box-sizing: border-box;
}

.agent-demo-shell__result :deep(.phy-markdown--artifact) {
  max-width: none;
}

@media (min-width: 1440px) {
  .agent-demo-shell__result :deep(.phy-markdown--artifact .markdown-content),
  .agent-demo-shell__result :deep(.phy-markdown--artifact .markdown-body) {
    max-width: clamp(740px, 42vw, 1120px);
  }

  .agent-demo-shell__result :deep(.cited-answer > .doc-list) {
    width: min(100%, clamp(740px, 42vw, 1120px));
    margin-inline: auto;
  }
}

.agent-demo-shell__note {
  width: min(100%, clamp(1040px, 74vw, 1800px));
  margin-right: auto;
  color: var(--phy-color-text-muted);
  font-size: 0.75rem;
  text-align: right;
}

.agent-demo-shell__footer {
  width: min(100%, 760px);
  flex: 0 0 auto;
  margin: 0 auto;
}

/* The app shell mounts a fixed footer for legacy nolayout pages. Static demos
 * own their footer inside the scroll root so long artifacts remain readable. */
:global(.app-container:has(.agent-demo-shell) > .app-footer) {
  display: none;
}

@media (max-width: 700px) {
  .agent-demo-shell__header-inner {
    grid-template-columns: auto minmax(0, 1fr);
    min-height: 68px;
    padding-inline: var(--phy-space-16);
  }

  .agent-demo-shell__header-spacer {
    display: none;
  }

  .agent-demo-shell__heading {
    text-align: right;
  }

  .agent-demo-shell__heading p {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .agent-demo-shell__body {
    padding: var(--phy-space-20) var(--phy-space-12) var(--phy-space-32);
  }

  .agent-demo-shell__question,
  .agent-demo-shell__result {
    width: 100%;
  }

  .agent-demo-shell__question,
  .agent-demo-shell__result {
    padding-inline: var(--phy-space-16);
  }
}

@media (max-width: 389px) {
  .agent-demo-shell__header-inner {
    align-items: start;
    gap: var(--phy-space-8);
    grid-template-columns: minmax(68px, auto) minmax(0, 1fr);
    padding-block: var(--phy-space-10);
  }

  .agent-demo-shell__back {
    width: max-content;
    min-width: 68px;
    padding-inline: var(--phy-space-4);
  }

  .agent-demo-shell__heading h1 {
    font-size: 1rem;
  }

  .agent-demo-shell__heading p {
    font-size: 0.75rem;
  }
}
</style>
