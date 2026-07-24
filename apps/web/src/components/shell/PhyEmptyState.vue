<template>
  <div class="phy-empty-state">
    <div v-if="$slots.mark" class="phy-empty-state__mark" aria-hidden="true">
      <slot name="mark" />
    </div>
    <h2 v-if="title" class="phy-empty-state__title">{{ title }}</h2>
    <p v-if="subtitle" class="phy-empty-state__subtitle">{{ subtitle }}</p>
    <div v-if="$slots.default" class="phy-empty-state__chips">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
  subtitle?: string;
}>();
</script>

<style scoped>
.phy-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
  padding: clamp(24px, 5vh, 48px) 0;
  color: var(--phy-color-text);
  text-align: center;
}

.phy-empty-state__mark {
  display: grid;
  place-items: center;
  margin-bottom: var(--phy-space-16);
}

.phy-empty-state__title {
  margin: 0;
  font-size: clamp(1.5rem, 1.15rem + 0.75vw, 1.75rem);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.02em;
  text-wrap: balance;
}

.phy-empty-state__subtitle {
  width: min(100%, var(--phy-layout-reading-max-width));
  margin: var(--phy-space-8) 0 0;
  color: var(--phy-color-text-secondary);
  font-size: 0.9375rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.phy-empty-state__chips {
  width: min(760px, 100%);
  margin-top: var(--phy-space-24);
}

@media (max-width: 600px) {
  .phy-empty-state {
    padding: var(--phy-space-20) 0 var(--phy-space-12);
  }

  .phy-empty-state__mark {
    margin-bottom: var(--phy-space-12);
  }

  .phy-empty-state__title {
    font-size: 1.375rem;
  }

  .phy-empty-state__subtitle {
    margin-top: var(--phy-space-8);
    font-size: 0.875rem;
    line-height: 1.55;
  }

  .phy-empty-state__chips {
    margin-top: var(--phy-space-20);
  }
}
</style>
