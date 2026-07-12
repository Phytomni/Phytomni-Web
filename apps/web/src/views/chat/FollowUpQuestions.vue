<template>
  <div class="follow-up-questions">
    <h4>{{ $t("chat.followUpQuestions") }}</h4>
    <div class="follow-up-list">
      <button
        v-for="(question, qIndex) in questions"
        :key="qIndex"
        type="button"
        class="question-item"
        data-testid="follow-up-suggestion"
        @click="handleQuestionClick(question)"
      >
        {{ qIndex + 1 }}. {{ question }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  questions: string[];
}

interface Emits {
  (e: "question-click", question: string): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const handleQuestionClick = (question: string) => {
  emit("question-click", question);
};
</script>

<style lang="scss" scoped>
.follow-up-questions {
  margin-top: var(--phy-space-12, 12px);

  h4 {
    margin: 0 0 var(--phy-space-8, 8px) 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--phy-color-text);
  }
}

.follow-up-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--phy-space-8, 8px);
}

.question-item {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin: 0;
  padding: var(--phy-space-8, 8px) var(--phy-space-12, 12px);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm, 6px);
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: var(--phy-color-text-secondary);
  text-align: left;
  cursor: pointer;
  user-select: none;

  &:hover {
    color: var(--phy-color-action-text);
    border-color: var(--phy-color-action-text);
    background: var(--phy-color-primary-soft);
  }

  &:focus-visible {
    outline: 2px solid var(--phy-color-focus);
    outline-offset: 2px;
  }
}
</style>
