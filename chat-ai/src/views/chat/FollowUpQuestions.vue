<template>
  <div class="follow-up-questions">
    <h4>{{ $t('chat.followUpQuestions') }}</h4>
    <div v-for="(question, qIndex) in questions" :key="qIndex" class="question-item" @click="handleQuestionClick(question)">
      {{ qIndex + 1 }}. {{ question }}
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  questions: string[];
}

interface Emits {
  (e: 'question-click', question: string): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const handleQuestionClick = (question: string) => {
  emit('question-click', question);
};
</script>

<style lang="scss" scoped>
.follow-up-questions {
  margin-top: 12px;
  padding: 12px;
  background-color: #f8f9fa;
  border-radius: 8px;
  border-left: 3px solid #1890ff;

  h4 {
    margin: 0 0 8px 0;
    font-size: 14px;
    font-weight: 600;
    color: #333;
  }

  .question-item {
    margin-bottom: 6px;
    padding: 8px 12px;
    background-color: #fff;
    border-radius: 6px;
    font-size: 13px;
    color: #555;
    border: 1px solid #e6e6e6;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    user-select: none;

    &:hover {
      background-color: #e6f7ff;
      border-color: #1890ff;
      color: #1890ff;
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(24, 144, 255, 0.15);
    }

    &:active {
      transform: translateY(0);
      box-shadow: 0 1px 4px rgba(24, 144, 255, 0.2);
    }

    &:last-child {
      margin-bottom: 0;
    }

    // 添加点击提示
    &::after {
      content: '';
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 11px;
      color: #999;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    &:hover::after {
      opacity: 1;
    }
  }
}
</style> 