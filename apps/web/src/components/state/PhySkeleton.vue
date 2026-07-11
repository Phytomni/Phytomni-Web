<template>
  <div
    class="phy-skeleton"
    :class="{ 'phy-skeleton--reduced-motion': reducedMotion }"
    :data-shape="shape"
    :data-reduced-motion="reducedMotion ? 'true' : undefined"
    role="presentation"
    aria-hidden="true"
  >
    <template v-if="shape === 'line'">
      <span
        v-for="index in itemCount"
        :key="`line-${index}`"
        class="phy-skeleton__line phy-skeleton__surface"
      />
    </template>

    <template v-else-if="shape === 'card'">
      <span
        v-for="index in itemCount"
        :key="`card-${index}`"
        class="phy-skeleton__card phy-skeleton__surface"
      />
    </template>

    <template v-else>
      <div
        v-for="index in itemCount"
        :key="`table-row-${index}`"
        class="phy-skeleton__table-row"
      >
        <span
          v-for="cell in tableCells"
          :key="`table-row-${index}-cell-${cell}`"
          class="phy-skeleton__table-cell phy-skeleton__surface"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

type SkeletonShape = "line" | "card" | "table-row";

const props = withDefaults(
  defineProps<{
    shape?: SkeletonShape;
    count?: number;
    reducedMotion?: boolean;
  }>(),
  {
    shape: "line",
    count: 1,
    reducedMotion: false,
  }
);

const itemCount = computed(() => Math.max(1, Math.floor(props.count)));
const tableCells = [1, 2, 3, 4] as const;
</script>

<style scoped>
.phy-skeleton {
  display: grid;
  min-width: 0;
  gap: var(--phy-space-12, 12px);
}

.phy-skeleton__surface {
  display: block;
  min-width: 0;
  border-radius: var(--phy-radius-sm, 8px);
  background-color: var(--phy-color-fill-subtle);
  background-image: linear-gradient(
    90deg,
    var(--phy-color-fill-subtle) 0%,
    var(--phy-color-bg-elevated) 50%,
    var(--phy-color-fill-subtle) 100%
  );
  background-size: 220% 100%;
  animation: phy-skeleton-shimmer 1.4s linear infinite;
}

.phy-skeleton__line {
  width: min(100%, 34rem);
  height: 12px;
}

.phy-skeleton__line:nth-child(2n) {
  width: min(82%, 29rem);
}

.phy-skeleton__line:nth-child(3n) {
  width: min(64%, 23rem);
}

.phy-skeleton__card {
  width: 100%;
  min-height: 120px;
}

.phy-skeleton__table-row {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) repeat(3, minmax(0, 1fr));
  gap: var(--phy-space-12, 12px);
  min-width: 0;
}

.phy-skeleton__table-cell {
  height: 16px;
}

.phy-skeleton--reduced-motion .phy-skeleton__surface {
  animation: none;
  background-image: none;
}

@media (prefers-reduced-motion: reduce) {
  .phy-skeleton__surface {
    animation: none;
    background-image: none;
  }
}

@keyframes phy-skeleton-shimmer {
  from {
    background-position: 100% 0;
  }

  to {
    background-position: -100% 0;
  }
}

@media (max-width: 599px) {
  .phy-skeleton__table-row {
    gap: var(--phy-space-8, 8px);
  }
}
</style>
