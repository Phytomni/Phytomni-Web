<template>
  <PhyWorkspaceShell class="feedback-workspace">
    <template #header>
      <PhyPageHeader :title="$t('menu.feedback')" />
    </template>

    <section class="feedback-form-section">
      <el-form
        ref="feedbackFormRef"
        :model="feedbackForm"
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
            <el-button
              class="feedback-submit"
              type="primary"
              size="large"
              :loading="submitting"
              @click="submitFeedback"
            >
              {{ $t("feedback.submit") }}
            </el-button>
            <el-button class="feedback-reset" size="large" @click="resetForm">
              {{ $t("common.reset") }}
            </el-button>
          </div>
        </el-form-item>
      </el-form>
    </section>
  </PhyWorkspaceShell>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { feedback } from "@/api/feedback";
import { PhyPageHeader, PhyWorkspaceShell } from "@/components/shell";

const router = useRouter();
const { t } = useI18n();

const feedbackForm = ref({
  feedback_type: "user_feedback",
  feedback_content: "",
});
const feedbackFormRef = ref();
const submitting = ref(false);
let submitInFlight = false;

const feedbackRules = computed(() => ({
  feedback_content: [
    {
      required: true,
      message: t("feedback.validation.required"),
      trigger: "blur",
    },
    { min: 10, message: t("feedback.validation.min"), trigger: "blur" },
    { max: 1000, message: t("feedback.validation.max"), trigger: "blur" },
  ],
}));

const resetForm = () => {
  feedbackForm.value.feedback_content = "";
  if (feedbackFormRef.value) {
    feedbackFormRef.value.resetFields();
  }
};

const submitFeedback = async () => {
  if (!feedbackFormRef.value || submitInFlight) return;

  submitInFlight = true;
  try {
    const valid = await feedbackFormRef.value.validate();
    if (valid) {
      submitting.value = true;

      const formData = new FormData();
      formData.append("feedback_type", feedbackForm.value.feedback_type);
      formData.append("feedback_content", feedbackForm.value.feedback_content);

      const response = await feedback(formData);

      if (response.code === 200) {
        ElMessage.success(t("feedback.submitSuccess"));
        resetForm();
        setTimeout(() => {
          router.go(-1);
        }, 1500);
      } else {
        ElMessage.error(response.message || t("feedback.submitFailed"));
      }
    }
  } catch {
    ElMessage.error(t("feedback.submitFailed"));
  } finally {
    submitting.value = false;
    submitInFlight = false;
  }
};
</script>

<style lang="scss" scoped>
.feedback-form-section {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
}

.feedback-form {
  width: 100%;
}

.form-actions {
  display: flex;
  gap: var(--phy-space-12);
}

@media (max-width: 599px) {
  .form-actions {
    flex-direction: column;

    .el-button {
      width: 100%;
    }
  }
}
</style>
