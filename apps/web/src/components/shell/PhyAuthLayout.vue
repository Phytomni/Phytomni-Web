<template>
  <div class="phy-auth-layout">
    <div class="phy-auth-lang" v-if="$slots.lang">
      <slot name="lang" />
    </div>
    <div class="phy-auth-card">
      <div class="phy-auth-brand" v-if="$slots.brand">
        <slot name="brand" />
      </div>
      <slot />
    </div>
    <Footer class="phy-auth-footer" />
  </div>
</template>

<script setup lang="ts">
// Presentational only — no auth logic.
import Footer from "@/components/Footer.vue";
</script>

<style scoped>
.phy-auth-layout {
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  overflow-y: auto;
  padding: clamp(24px, 7vh, 84px) 16px 20px;
  box-sizing: border-box;
  background: var(--phy-auth-horizon);
  position: relative;
  font-family: var(--phy-font-shell);
  color: var(--phy-color-text);
}
.phy-auth-lang {
  position: absolute;
  top: 16px;
  right: 16px;
}
.phy-auth-card {
  width: min(560px, calc(100vw - 24px));
  margin-block: auto;
  background: var(--phy-color-bg-elevated);
  border: 1px solid var(--phy-color-border);
  border-radius: var(--phy-radius-md);
  box-shadow: var(--phy-shadow-soft);
  padding: 28px 24px 24px;
}
.phy-auth-brand {
  margin-bottom: 16px;
}

.phy-auth-footer {
  width: min(100%, 760px);
  flex: 0 0 auto;
}

@media (min-width: 1440px) {
  .phy-auth-card {
    width: clamp(640px, 36vw, 760px);
    padding: 36px 40px 32px;
  }
}

@media (max-width: 599px) {
  .phy-auth-layout {
    justify-content: flex-start;
    gap: 12px;
    padding: 16px 12px 12px;
  }

  .phy-auth-card {
    width: 100%;
    padding: 20px 16px 18px;
  }
}
</style>
