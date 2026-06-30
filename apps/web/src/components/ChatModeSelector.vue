<template>
  <div class="chat-mode-selector">
    <el-radio-group
      :model-value="modelValue"
      @update:model-value="(v) => $emit('update:modelValue', v as 'instant' | 'expert')"
    >
      <el-radio-button label="instant">{{ $t("chat.mode.instant") }}</el-radio-button>
      <el-tooltip
        v-if="!expertEnabled"
        :content="$t('chat.mode.comingSoon')"
        placement="top"
      >
        <el-radio-button label="expert" disabled>{{ $t("chat.mode.expert") }}</el-radio-button>
      </el-tooltip>
      <el-radio-button v-else label="expert">{{ $t("chat.mode.expert") }}</el-radio-button>
    </el-radio-group>
  </div>
</template>

<script setup lang="ts">
defineProps<{ modelValue: "instant" | "expert"; expertEnabled: boolean }>();
defineEmits<{ (e: "update:modelValue", value: "instant" | "expert"): void }>();
</script>
