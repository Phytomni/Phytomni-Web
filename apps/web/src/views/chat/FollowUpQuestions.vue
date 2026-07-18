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
  max-width: 100%;
  margin-top: var(--phy-space-12);

  h4 {
    margin: 0 0 var(--phy-space-4);
    color: var(--phy-color-text-muted);
    font-size: 12px;
    font-weight: 500;
  }
}

.follow-up-list {
  display: flex;
  flex-wrap: wrap;
  max-width: 100%;
  gap: var(--phy-space-4);
}

.question-item {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: var(--phy-control-height-compact);
  margin: 0;
  padding: var(--phy-space-4) var(--phy-space-8);
  border: 0;
  border-radius: var(--phy-radius-sm);
  background: transparent;
  color: var(--phy-color-text-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  user-select: none;
  transition: background-color var(--phy-motion-fast) ease,
    color var(--phy-motion-fast) ease;

  &:hover {
    color: var(--phy-color-action-text);
    background: var(--phy-color-primary-soft);
  }

  &:focus-visible {
    outline: 2px solid var(--phy-color-focus);
    outline-offset: 2px;
  }
}

@media (hover: none), (pointer: coarse) {
  .question-item {
    min-height: calc(var(--phy-control-height-default) + var(--phy-space-4));
    padding: var(--phy-space-8);
  }
}
</style>
