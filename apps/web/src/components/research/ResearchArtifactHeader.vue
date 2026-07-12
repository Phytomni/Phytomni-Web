<template>
  <header class="research-artifact-header">
    <button
      type="button"
      class="research-artifact-header__control research-artifact-header__back research-artifact-header__back--mobile-only"
      :aria-label="backLabel"
      data-test="artifact-back"
      @click="emit('back')"
    >
      <span aria-hidden="true">←</span>
      <span class="research-artifact-header__back-label">{{ backLabel }}</span>
    </button>

    <div class="research-artifact-header__identity">
      <h1
        class="research-artifact-header__title"
        :title="title"
        data-truncate="title"
      >
        {{ title }}
      </h1>
      <div
        v-if="metadataItems.length || status"
        class="research-artifact-header__details"
      >
        <span
          v-for="item in metadataItems"
          :key="item"
          class="research-artifact-header__metadata-item"
        >
          {{ item }}
        </span>
        <span v-if="status" class="research-artifact-header__status">
          {{ status }}
        </span>
      </div>
    </div>

    <div
      class="research-artifact-header__actions"
      data-horizontal-scroll="actions"
    >
      <slot name="actions" />
      <button
        type="button"
        class="research-artifact-header__control research-artifact-header__action"
        :aria-label="actionLabel"
        data-test="artifact-action"
        @click="emit('action')"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <button
        type="button"
        class="research-artifact-header__control research-artifact-header__close research-artifact-header__close--desktop-only"
        :aria-label="closeLabel"
        data-test="artifact-close"
        @click="emit('close')"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  title: string;
  metadata?: string | string[];
  status?: string;
  backLabel: string;
  closeLabel: string;
  actionLabel: string;
}>();

const emit = defineEmits<{
  (event: "back"): void;
  (event: "close"): void;
  (event: "action"): void;
}>();

const metadataItems = computed(() => {
  if (!props.metadata) return [];
  return Array.isArray(props.metadata) ? props.metadata : [props.metadata];
});
</script>

<style scoped>
.research-artifact-header {
  display: flex;
  align-items: center;
  gap: var(--phy-space-12);
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: var(--phy-space-16) var(--phy-space-20);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.research-artifact-header__identity {
  flex: 1 1 auto;
  min-width: 0;
}

.research-artifact-header__title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.research-artifact-header__details {
  display: flex;
  align-items: center;
  gap: var(--phy-space-8);
  min-width: 0;
  margin-top: var(--phy-space-4);
  overflow: hidden;
  color: var(--phy-color-text-muted);
  font-size: 0.8125rem;
  line-height: 1.4;
  white-space: nowrap;
}

.research-artifact-header__metadata-item,
.research-artifact-header__status {
  overflow: hidden;
  text-overflow: ellipsis;
}

.research-artifact-header__metadata-item
  + .research-artifact-header__metadata-item::before,
.research-artifact-header__status::before {
  margin-inline-end: var(--phy-space-8);
  content: "·";
}

.research-artifact-header__status {
  flex-shrink: 0;
  color: var(--phy-color-accent-text);
  font-weight: 600;
}

.research-artifact-header__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--phy-space-8);
  max-width: 45%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.research-artifact-header__control {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-width: var(--phy-control-height-default);
  min-height: var(--phy-control-height-default);
  box-sizing: border-box;
  padding: 0 var(--phy-space-12);
  border: 1px solid var(--phy-color-border-control);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-action-text);
  font: inherit;
  cursor: pointer;
}

.research-artifact-header__control:hover {
  background: var(--phy-color-fill-subtle);
  color: var(--phy-color-action-text-hover);
}

.research-artifact-header__control:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.research-artifact-header__back {
  display: none;
  gap: var(--phy-space-8);
}

@media (max-width: 899px) {
  .research-artifact-header {
    gap: var(--phy-space-8);
    padding: var(--phy-space-12) var(--phy-space-16);
  }

  .research-artifact-header__back--mobile-only {
    display: inline-flex;
    min-width: calc(var(--phy-control-height-default) + var(--phy-space-4));
    min-height: calc(var(--phy-control-height-default) + var(--phy-space-4));
  }

  .research-artifact-header__back-label {
    max-width: 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .research-artifact-header__close--desktop-only {
    display: none;
  }

  .research-artifact-header__actions {
    max-width: 35%;
  }

  .research-artifact-header__control {
    min-width: calc(var(--phy-control-height-default) + var(--phy-space-4));
    min-height: calc(var(--phy-control-height-default) + var(--phy-space-4));
    padding-inline: var(--phy-space-8);
  }
}

@media (max-width: 599px) {
  .research-artifact-header__back-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .research-artifact-header__details {
    gap: var(--phy-space-4);
  }
}
</style>
