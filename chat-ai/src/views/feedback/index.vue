<template>
  <div class="feedback-container">

    <!-- 反馈表单 -->
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
                {{ $t('common.reset') }}
              </el-button>
              <el-button 
                type="primary" 
                size="large" 
                @click="submitFeedback"
                :loading="submitting"
              >
                {{ $t('feedback.submit') }}
              </el-button>
            </div>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import { feedback } from '@/api/feedback';

const router = useRouter();

// 反馈表单数据
const feedbackForm = ref({
  feedback_type: '用户反馈',
  feedback_content: '',
});

// 表单引用
const feedbackFormRef = ref();

// 提交状态
const submitting = ref(false);

// 表单验证规则
const feedbackRules = {
  feedback_content: [
    { required: true, message: '请输入反馈内容', trigger: 'blur' },
    { min: 10, message: '反馈内容至少10个字符', trigger: 'blur' },
    { max: 1000, message: '反馈内容不能超过1000个字符', trigger: 'blur' }
  ]
};

// 返回上一页
const goBack = () => {
  router.go(-1);
};

// 重置表单
const resetForm = () => {
  feedbackForm.value.feedback_content = '';
  if (feedbackFormRef.value) {
    feedbackFormRef.value.resetFields();
  }
};

// 提交反馈
const submitFeedback = async () => {
  if (!feedbackFormRef.value) return;
  
  try {
    const valid = await feedbackFormRef.value.validate();
    if (valid) {
      submitting.value = true;
      
      // 调用真实API接口
      const formData = new FormData();
      formData.append('feedback_type', feedbackForm.value.feedback_type);
      formData.append('feedback_content', feedbackForm.value.feedback_content);
      
      const response = await feedback(formData);
      
      if (response.code === 200) {
        // 显示成功提示
        ElMessage.success('反馈提交成功，感谢您的宝贵意见！');
        
        // 重置表单
        resetForm();
        
        // 延迟返回上一页
        setTimeout(() => {
          router.go(-1);
        }, 1500);
      } else {
        ElMessage.error(response.msg || '提交失败，请重试');
      }
    }
  } catch (error) {
    console.error('提交反馈失败:', error);
    ElMessage.error('提交失败，请重试');
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

// 响应式设计
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