<template>
  <div class="feedback-container">
    <!-- Feedback form -->
    <div class="feedback-content">
      <div class="feedback-form-container">
        <el-form
          :model="feedbackForm"
          ref="feedbackFormRef"
          :rules="feedbackRules"
          label-width="0"
          class="feedback-form"
        >
          <el-form-item prop="feedback_content">
            <el-input
              v-model="feedbackForm.feedback_content"
              type="textarea"
              :rows="8"
              :placeholder="$t('feedback.placeholder')"
              maxlength="1000"
              show-word-limit
              resize="none"
            />
          </el-form-item>

          <el-form-item>
            <div class="form-actions">
              <el-button @click="resetForm" size="large">
                {{ $t("common.reset") }}
              </el-button>
              <el-button
                type="primary"
                size="large"
                @click="submitFeedback"
                :loading="submitting"
              >
                {{ $t("feedback.submit") }}
              </el-button>
            </div>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { feedback } from "@/api/feedback";

const router = useRouter();

// Feedback form data
const feedbackForm = ref({
  feedback_type: "user_feedback",
  feedback_content: "",
});

// Form ref
const feedbackFormRef = ref();

// Submission state
const submitting = ref(false);

// Form validation rules
const feedbackRules = {
  feedback_content: [
    { required: true, message: "Please enter feedback content", trigger: "blur" },
    { min: 10, message: "Feedback must be at least 10 characters", trigger: "blur" },
    { max: 1000, message: "Feedback cannot exceed 1000 characters", trigger: "blur" },
  ],
};

// Go back to previous page
const goBack = () => {
  router.go(-1);
};

// Reset form
const resetForm = () => {
  feedbackForm.value.feedback_content = "";
  if (feedbackFormRef.value) {
    feedbackFormRef.value.resetFields();
  }
};

// Submit feedback
const submitFeedback = async () => {
  if (!feedbackFormRef.value) return;

  try {
    const valid = await feedbackFormRef.value.validate();
    if (valid) {
      submitting.value = true;

      // Call the real API endpoint
      const formData = new FormData();
      formData.append("feedback_type", feedbackForm.value.feedback_type);
      formData.append("feedback_content", feedbackForm.value.feedback_content);

      const response = await feedback(formData);

      if (response.code === 200) {
        // Show success message
        ElMessage.success("Feedback submitted, thank you for your input!");

        // Reset form
        resetForm();

        // Go back to previous page after a delay
        setTimeout(() => {
          router.go(-1);
        }, 1500);
      } else {
        ElMessage.error(response.message || "Submit failed, please try again");
      }
    }
  } catch (error) {
    console.error("Failed to submit feedback:", error);
    ElMessage.error("Submit failed, please try again");
  } finally {
    submitting.value = false;
  }
};
</script>

<style lang="scss" scoped>
.feedback-container {
  min-height: 100vh;
  background-color: var(--color-background-soft);
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 30px;
  padding: 24px;
  background: var(--page-card-bg);
  border-radius: 12px;
  box-shadow: var(--page-card-shadow);

  .header-content {
    h1 {
      margin: 0 0 8px 0;
      font-size: 28px;
      font-weight: 600;
      color: var(--color-heading);
    }

    p {
      margin: 0;
      color: var(--color-text);
      font-size: 16px;
      line-height: 1.5;
    }
  }
}

.feedback-content {
  .feedback-form-container {
    background: var(--page-card-bg);
    border-radius: 12px;
    box-shadow: var(--page-card-shadow);
    padding: 32px;

    .feedback-form {
      max-width: 800px;
      margin: 0 auto;

      .el-form-item {
        margin-bottom: 24px;

        &:last-child {
          margin-bottom: 0;
        }
      }

      .form-actions {
        display: flex;
        justify-content: center;
        gap: 16px;
        padding-top: 16px;

        .el-button {
          min-width: 120px;
        }
      }
    }
  }
}

// Responsive design
@media (max-width: 768px) {
  .feedback-container {
    padding: 16px;
  }

  .page-header {
    padding: 20px;
    flex-direction: column;
    gap: 16px;

    .header-content h1 {
      font-size: 24px;
    }
  }

  .feedback-content .feedback-form-container {
    padding: 24px 20px;

    .feedback-form .form-actions {
      flex-direction: column;
      align-items: center;

      .el-button {
        width: 100%;
        max-width: 300px;
      }
    }
  }
}
</style>
