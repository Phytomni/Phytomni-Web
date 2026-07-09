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
  </div>
</template>

<script setup lang="ts">
// Presentational only — no auth logic.
</script>

<style scoped>
.phy-auth-layout {
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px 48px;
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
  width: min(420px, 100%);
  background: var(--phy-color-bg-elevated);
  border: 1px solid var(--phy-color-border);
  border-radius: var(--phy-radius-md);
  box-shadow: var(--phy-shadow-soft);
  padding: 28px 24px 24px;
}
.phy-auth-brand {
  margin-bottom: 16px;
}
</style>
