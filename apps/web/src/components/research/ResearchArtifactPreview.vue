<template>
  <article class="research-artifact-preview research-artifact-preview--neutral">
    <div class="research-artifact-preview__body">
      <p class="research-artifact-preview__kind">
        <AgentDisplayName v-if="formatScientificAgentName" :label="kind" />
        <template v-else>{{ kind }}</template>
      </p>
      <h3
        class="research-artifact-preview__title"
        :title="title"
        data-truncate="title"
      >
        {{ title }}
      </h3>
      <p class="research-artifact-preview__summary">{{ summary }}</p>
    </div>
    <button
      type="button"
      class="research-artifact-preview__open"
      :aria-label="openLabel"
      data-test="artifact-open"
      @click="emit('open')"
    >
      {{ openLabel }}
      <span aria-hidden="true">→</span>
    </button>
  </article>
</template>

<script setup lang="ts">
import AgentDisplayName from "@/components/AgentDisplayName.vue";

withDefaults(
  defineProps<{
    title: string;
    kind: string;
    summary: string;
    openLabel: string;
    formatScientificAgentName?: boolean;
  }>(),
  {
    formatScientificAgentName: false,
  }
);

const emit = defineEmits<{
  (event: "open"): void;
}>();
</script>

<style scoped>
.research-artifact-preview {
  display: flex;
  align-items: center;
  gap: var(--phy-space-16);
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: var(--phy-space-16);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.research-artifact-preview__body {
  flex: 1 1 auto;
  min-width: 0;
}

.research-artifact-preview__kind {
  margin: 0 0 var(--phy-space-4);
  color: var(--phy-color-accent-text);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1.4;
  text-transform: uppercase;
}

.research-artifact-preview__title {
  margin: 0;
  overflow: hidden;
  color: var(--phy-color-text);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.research-artifact-preview__summary {
  display: -webkit-box;
  margin: var(--phy-space-4) 0 0;
  overflow: hidden;
  color: var(--phy-color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.research-artifact-preview__open {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: var(--phy-space-8);
  min-height: var(--phy-control-height-default);
  padding: 0 var(--phy-space-16);
  border: 1px solid var(--phy-color-border-control);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-action-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.research-artifact-preview__open:hover {
  background: var(--phy-color-fill-subtle);
  color: var(--phy-color-action-text-hover);
}

.research-artifact-preview__open:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

@media (max-width: 599px) {
  .research-artifact-preview {
    align-items: stretch;
    flex-direction: column;
    gap: var(--phy-space-12);
    padding: var(--phy-space-12);
  }

  .research-artifact-preview__open {
    align-self: flex-start;
    min-height: calc(var(--phy-control-height-default) + var(--phy-space-4));
  }
}
</style>
