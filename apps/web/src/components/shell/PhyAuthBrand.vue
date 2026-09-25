<template>
  <div class="phy-auth-brand">
    <img
      class="phy-auth-brand__mark"
      src="/logo.png"
      alt=""
      aria-hidden="true"
    />
    <span class="phy-auth-brand__title">{{ title }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<style scoped>
.phy-auth-brand {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--phy-space-10, 10px);
}

.phy-auth-brand__mark {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  object-fit: contain;
  border-radius: var(--phy-radius-sm);
}

.phy-auth-brand__title {
  min-width: 0;
  overflow: hidden;
  color: var(--phy-color-text);
  font-size: 1.05rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
