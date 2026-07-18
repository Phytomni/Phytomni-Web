<template>
  <div class="phy-auth-layout" :class="{ 'phy-auth-layout--horizon': horizon }">
    <div v-if="$slots.lang" class="phy-auth-lang">
      <slot name="lang" />
    </div>

    <main class="phy-auth-content">
      <section class="phy-auth-card">
        <div class="phy-auth-brand">
          <slot name="brand">
            <div class="phy-auth-brand-fallback">
              <PhyBrandMark />
              <span>Phytomni</span>
            </div>
          </slot>
        </div>

        <div v-if="$slots.title" class="phy-auth-title">
          <slot name="title" />
        </div>
        <div v-if="$slots.description" class="phy-auth-description">
          <slot name="description" />
        </div>

        <div class="phy-auth-form">
          <slot />
        </div>

        <div v-if="$slots.contextual" class="phy-auth-contextual">
          <slot name="contextual" />
        </div>
        <div v-if="$slots.secondary" class="phy-auth-secondary">
          <slot name="secondary" />
        </div>
        <div v-if="$slots.controls" class="phy-auth-controls">
          <slot name="controls" />
        </div>
      </section>
    </main>

    <Footer class="phy-auth-footer" />
  </div>
</template>

<script setup lang="ts">
// Presentational only — no auth logic, routing, or store dependencies.
import Footer from "@/components/Footer.vue";
import { PhyBrandMark } from "@/components/brand";

withDefaults(
  defineProps<{
    horizon?: boolean;
  }>(),
  {
    horizon: false,
  }
);
</script>

<style scoped>
.phy-auth-layout {
  width: 100%;
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-x: hidden;
  overflow-y: auto;
  box-sizing: border-box;
  position: relative;
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.phy-auth-layout--horizon {
  background: var(--phy-auth-horizon);
}

.phy-auth-lang {
  position: absolute;
  top: var(--phy-space-16);
  right: var(--phy-space-16);
  z-index: var(--phy-z-dropdown);
}

.phy-auth-content {
  display: flex;
  flex: 1 0 auto;
  width: 100%;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: clamp(var(--phy-space-32), 7vh, var(--phy-space-64))
    var(--phy-space-16);
}

.phy-auth-card {
  width: min(432px, calc(100vw - (var(--phy-space-16) * 2)));
  max-width: 432px;
  box-sizing: border-box;
  padding: var(--phy-space-32) var(--phy-space-24) var(--phy-space-24);
  border: 1px solid var(--phy-color-border);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
}

/* Give wide desktop auth surfaces a little more visual weight without
 * changing the compact/mobile contract or the approved 432px baseline. */
@media (min-width: 600px) {
  .phy-auth-card {
    width: min(
      clamp(432px, calc(35vw - 72px), 672px),
      calc(100vw - (var(--phy-space-16) * 2))
    );
    max-width: 672px;
  }
}

.phy-auth-brand {
  margin-bottom: var(--phy-space-20);
}

.phy-auth-brand-fallback {
  display: flex;
  align-items: center;
  gap: var(--phy-space-10, 10px);
  min-width: 0;
  color: var(--phy-color-text);
  font-size: 1.05rem;
  font-weight: 600;
}

.phy-auth-brand-fallback span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.phy-auth-title :deep(:first-child),
.phy-auth-description :deep(:first-child) {
  margin-top: 0;
}

.phy-auth-description {
  color: var(--phy-color-text-secondary);
}

.phy-auth-form,
.phy-auth-contextual,
.phy-auth-secondary,
.phy-auth-controls {
  min-width: 0;
}

.phy-auth-form {
  margin-top: var(--phy-space-20);
}

.phy-auth-contextual,
.phy-auth-secondary,
.phy-auth-controls {
  margin-top: var(--phy-space-16);
}

.phy-auth-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--phy-space-8);
}

.phy-auth-form :deep(.el-input__wrapper),
.phy-auth-form :deep(.el-input),
.phy-auth-form :deep(.el-button),
.phy-auth-form :deep(button),
.phy-auth-form :deep(input),
.phy-auth-form :deep(select),
.phy-auth-form :deep(textarea),
.phy-auth-controls :deep(.el-button),
.phy-auth-controls :deep(button) {
  min-height: var(--phy-control-height-primary, 48px);
}

.phy-auth-footer {
  width: min(100%, 760px);
  flex: 0 0 auto;
}

@media (max-height: 720px) {
  .phy-auth-content {
    align-items: flex-start;
    padding-top: var(--phy-space-24);
  }
}

@media (max-width: 599px) {
  .phy-auth-content {
    align-items: flex-start;
    padding: var(--phy-space-20) var(--phy-space-12) var(--phy-space-24);
  }

  .phy-auth-card {
    width: 100%;
    padding: var(--phy-space-24) var(--phy-space-16) var(--phy-space-20);
  }
}
</style>
