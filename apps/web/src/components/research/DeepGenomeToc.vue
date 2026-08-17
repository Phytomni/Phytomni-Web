<template>
  <aside
    class="deep-genome-toc"
    data-testid="deep-genome-toc"
    :aria-label="title"
  >
    <details
      class="deep-genome-toc__disclosure"
      :open="disclosureOpen"
      @toggle="handleToggle"
    >
      <summary
        class="deep-genome-toc__summary"
        data-testid="deep-genome-toc-disclosure"
      >
        {{ title }}
      </summary>
      <el-menu
        :default-active="activeHeadingId"
        :unique-opened="true"
        class="deep-genome-toc-menu"
        @select="handleSelect"
      >
        <DeepGenomeTocNode
          v-for="item in nestedHeadings"
          :key="item.id"
          :item="item"
        />
      </el-menu>
    </details>
  </aside>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { ElMenu } from "element-plus";
import DeepGenomeTocNode from "./DeepGenomeTocNode.vue";
import type { NestedScientificHeading } from "@/utils/scientific-markdown/toc";

defineProps<{
  nestedHeadings: NestedScientificHeading[];
  activeHeadingId: string;
  title: string;
}>();

const emit = defineEmits<{
  (event: "select", id: string): void;
}>();

const disclosureOpen = ref(false);
let desktopMedia: MediaQueryList | null = null;

const syncDisclosure = () => {
  disclosureOpen.value = desktopMedia?.matches ?? false;
};

const handleToggle = (event: Event) => {
  disclosureOpen.value = (event.currentTarget as HTMLDetailsElement).open;
};

const handleSelect = (id: string) => {
  emit("select", id);
};

onMounted(() => {
  desktopMedia = window.matchMedia("(min-width: 900px)");
  syncDisclosure();
  desktopMedia.addEventListener("change", syncDisclosure);
});

onBeforeUnmount(() => {
  desktopMedia?.removeEventListener("change", syncDisclosure);
});
</script>

<style scoped>
.deep-genome-toc {
  box-sizing: border-box;
  position: sticky;
  top: var(--phy-space-16);
  width: 232px;
  min-width: 232px;
  max-height: 640px;
  flex: 0 0 232px;
  padding: var(--phy-space-16) var(--phy-space-8);
  overflow-y: auto;
  border-right: 1px solid var(--phy-color-border-subtle);
  color: var(--phy-color-text);
  background: var(--phy-color-bg-sidebar);
}

.deep-genome-toc__disclosure {
  min-width: 0;
}

.deep-genome-toc__summary {
  margin: 0 0 var(--phy-space-12);
  color: var(--phy-color-text);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  list-style: none;
}

.deep-genome-toc__summary::-webkit-details-marker {
  display: none;
}

.deep-genome-toc-menu {
  max-width: 100%;
  overflow: hidden;
  border: none !important;
  border-radius: var(--phy-radius-sm);
  background: transparent !important;
}

.deep-genome-toc :deep(.el-menu-item),
.deep-genome-toc :deep(.el-sub-menu__title) {
  height: auto;
  min-height: 38px;
  margin: var(--phy-space-4) 0;
  border-radius: var(--phy-radius-sm);
  color: var(--phy-color-text-secondary);
  line-height: 1.4;
}

.deep-genome-toc :deep(.el-menu-item span),
.deep-genome-toc :deep(.el-sub-menu__title span) {
  overflow: hidden;
  color: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deep-genome-toc :deep(.menu-level-2),
.deep-genome-toc :deep(.menu-level-2 > .el-sub-menu__title) {
  font-size: 14px;
  font-weight: 600;
}

.deep-genome-toc :deep(.menu-level-3),
.deep-genome-toc :deep(.menu-level-3 > .el-sub-menu__title),
.deep-genome-toc :deep(.menu-level-4) {
  font-size: 13px;
  font-weight: 400;
}

.deep-genome-toc :deep(.el-menu-item:hover),
.deep-genome-toc :deep(.el-sub-menu__title:hover) {
  color: var(--phy-color-text);
  background: var(--phy-color-fill-subtle);
}

.deep-genome-toc :deep(.el-menu-item.is-active) {
  color: var(--phy-color-action-text);
  background: var(--phy-color-brand-blue-soft);
}

.deep-genome-toc :deep(.el-sub-menu.is-active > .el-sub-menu__title),
.deep-genome-toc :deep(.el-sub-menu__icon-arrow) {
  color: var(--phy-color-action-text);
}

@media (max-width: 899px) {
  .deep-genome-toc {
    position: static;
    width: 100%;
    min-width: 0;
    max-height: none;
    flex: 0 0 auto;
    padding: var(--phy-space-12);
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--phy-color-border-subtle);
  }

  .deep-genome-toc__summary {
    position: relative;
    margin: 0;
    padding-right: var(--phy-space-24);
    cursor: pointer;
  }

  .deep-genome-toc__summary::after {
    position: absolute;
    top: 50%;
    right: 0;
    content: "+";
    transform: translateY(-50%);
  }

  .deep-genome-toc__disclosure[open] .deep-genome-toc__summary {
    margin-bottom: var(--phy-space-12);
  }

  .deep-genome-toc__disclosure[open] .deep-genome-toc__summary::after {
    content: "−";
  }

  .deep-genome-toc-menu {
    max-height: 320px;
    overflow-y: auto;
  }
}
</style>
