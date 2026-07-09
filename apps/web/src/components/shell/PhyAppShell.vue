<template>
  <div class="phy-app-shell">
    <div v-if="$slots.left" class="phy-app-shell__left">
      <slot name="left" />
    </div>
    <div class="phy-app-shell__main">
      <slot />
    </div>
    <div v-if="$slots.right" class="phy-app-shell__right">
      <slot name="right" />
    </div>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.phy-app-shell {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  background: var(--phy-color-bg-page);
  font-family: var(--phy-font-shell);
  color: var(--phy-color-text);
}
.phy-app-shell__left {
  flex-shrink: 0;
  height: 100%;
}
.phy-app-shell__main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--phy-color-bg-page);
}
.phy-app-shell__right {
  flex-shrink: 0;
  height: 100%;
}
</style>
