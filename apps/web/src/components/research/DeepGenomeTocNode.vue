<template>
  <el-menu-item
    v-if="!item.children.length"
    :index="item.id"
    :class="`menu-level-${item.level}`"
  >
    <span>{{ item.text }}</span>
  </el-menu-item>
  <el-sub-menu v-else :index="item.id" :class="`menu-level-${item.level}`">
    <template #title>
      <span>{{ item.text }}</span>
    </template>
    <DeepGenomeTocNode
      v-for="child in item.children"
      :key="child.id"
      :item="child"
    />
  </el-sub-menu>
</template>

<script setup lang="ts">
import { ElMenuItem, ElSubMenu } from "element-plus";
import type { NestedScientificHeading } from "@/utils/scientific-markdown/toc";

defineOptions({ name: "DeepGenomeTocNode" });

defineProps<{
  item: NestedScientificHeading;
}>();
</script>
