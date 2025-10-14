<template>
  <div class="forgot-password-container">
    <div class="forgot-password-left">
      <div class="logo-container">
        <div class="logo" style="width: 40px; height: 40px"></div>
      </div>
      <div class="slogan">
        <!-- 可以添加忘记密码页面的标语 -->
      </div>
    </div>
    <div class="forgot-password-right">
      <div class="lang-switch">
        <LangSwitch />
      </div>
      <div class="forgot-password-form">
        <h2 class="forgot-password-title">{{ $t('forgotPassword.title') }}</h2>
        <h5 class="forgot-password-subtitle">{{ $t('forgotPassword.subtitle') }}</h5>
        
        <!-- 步骤1：输入邮箱 -->
        <div v-if="currentStep === 1" class="step-container">
          <el-form ref="emailFormRef" :model="emailForm" :rules="emailRules" status-icon>
            <div class="form-item-label">{{ $t('forgotPassword.email') }}</div>
            <el-form-item prop="email">
              <el-input
                v-model="emailForm.email"
                :placeholder="$t('forgotPassword.emailPlaceholder')"
                clearable
                size="large" />
            </el-form-item>

            <el-button
              type="primary"
              class="submit-button"
              @click="handleSendResetEmail"
              :loading="loading">
              {{ $t('forgotPassword.sendResetEmail') }}
            </el-button>
          </el-form>
        </div>

        <!-- 步骤2：输入验证码 -->
        <div v-if="currentStep === 2" class="step-container">
          <el-form ref="codeFormRef" :model="codeForm" :rules="codeRules" status-icon>
            <div class="form-item-label">{{ $t('forgotPassword.verificationCode') }}</div>
            <el-form-item prop="code">
              <el-input
                v-model="codeForm.code"
                :placeholder="$t('forgotPassword.codePlaceholder')"
                clearable
                size="large" />
            </el-form-item>

            <el-button
              type="primary"
              class="submit-button"
              @click="handleVerifyCode"
              :loading="loading">
              {{ $t('forgotPassword.verifyCode') }}
            </el-button>
          </el-form>
        </div>

        <!-- 步骤3：重置密码 -->
        <div v-if="currentStep === 3" class="step-container">
          <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" status-icon>
            <div class="form-item-label">{{ $t('forgotPassword.newPassword') }}</div>
            <el-form-item prop="password">
              <el-input
                v-model="passwordForm.password"
                type="password"
                :placeholder="$t('forgotPassword.newPasswordPlaceholder')"
                show-password
                clearable
                size="large" />
            </el-form-item>

            <div class="form-item-label">{{ $t('forgotPassword.confirmPassword') }}</div>
            <el-form-item prop="confirmPassword">
              <el-input
                v-model="passwordForm.confirmPassword"
                type="password"
                :placeholder="$t('forgotPassword.confirmPasswordPlaceholder')"
                show-password
                clearable
                size="large" />
            </el-form-item>

            <el-button
              type="primary"
              class="submit-button"
              @click="handleResetPassword"
              :loading="loading">
              {{ $t('forgotPassword.resetPassword') }}
            </el-button>
          </el-form>
        </div>

        <!-- 步骤4：成功提示 -->
        <div v-if="currentStep === 4" class="step-container">
          <div class="success-container">
            <el-icon class="success-icon" color="#67c23a" size="64">
              <CircleCheckFilled />
            </el-icon>
            <h3 class="success-title">{{ $t('forgotPassword.successTitle') }}</h3>
            <p class="success-message">{{ $t('forgotPassword.successMessage') }}</p>
            <el-button
              type="primary"
              class="submit-button"
              @click="goToLogin">
              {{ $t('forgotPassword.backToLogin') }}
            </el-button>
          </div>
        </div>

        <div class="back-to-login">
          <a
            href="javascript:;"
            class="login-link"
            @click="goToLogin">
            {{ $t('forgotPassword.backToLogin') }}
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ElForm } from 'element-plus';
import { ElMessage } from 'element-plus';
import { CircleCheckFilled } from '@element-plus/icons-vue';
import LangSwitch from '@/components/LangSwitch.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const router = useRouter();
const loading = ref(false);
const currentStep = ref(1);

// 表单引用
const emailFormRef = ref<InstanceType<typeof ElForm>>();
const codeFormRef = ref<InstanceType<typeof ElForm>>();
const passwordFormRef = ref<InstanceType<typeof ElForm>>();

// 步骤1：邮箱表单
const emailForm = reactive({
  email: '',
});

// 步骤2：验证码表单
const codeForm = reactive({
  code: '',
});

// 步骤3：密码表单
const passwordForm = reactive({
  password: '',
  confirmPassword: '',
});

// 自定义验证规则：确认密码
const validateConfirmPassword = (rule: any, value: string, callback: any) => {
  if (value === '') {
    callback(new Error(t('forgotPassword.validation.confirmPasswordRequired')));
  } else if (value !== passwordForm.password) {
    callback(new Error(t('forgotPassword.validation.confirmPasswordMismatch')));
  } else {
    callback();
  }
};

// 表单验证规则
const emailRules = reactive({
  email: [
    { required: true, message: t('forgotPassword.validation.emailRequired'), trigger: 'blur' as const },
    {
      type: 'email' as const,
      message: t('forgotPassword.validation.emailFormat'),
      trigger: 'blur' as const,
    },
  ],
});

const codeRules = reactive({
  code: [
    { required: true, message: t('forgotPassword.validation.codeRequired'), trigger: 'blur' as const },
    { min: 4, max: 6, message: t('forgotPassword.validation.codeLength'), trigger: 'blur' as const },
  ],
});

const passwordRules = reactive({
  password: [
    {
      required: true,
      message: t('forgotPassword.validation.passwordRequired'),
      trigger: 'blur' as const,
    },
    {
      min: 6,
      max: 16,
      message: t('forgotPassword.validation.passwordLength'),
      trigger: 'blur' as const,
    },
  ],
  confirmPassword: [
    {
      required: true,
      validator: validateConfirmPassword,
      trigger: 'blur' as const,
    },
  ],
});

// 发送重置邮件
const handleSendResetEmail = () => {
  if (!emailFormRef.value) return;
  emailFormRef.value.validate((valid: boolean) => {
    if (valid) {
      loading.value = true;
      // TODO: 调用发送重置邮件接口
      // sendResetEmail({
      //   email: emailForm.email,
      // })
      //   .then((res: { code: number; msg?: string }) => {
      //     if (res.code === 200) {
      //       ElMessage.success('Reset email sent successfully');
      //       currentStep.value = 2;
      //     } else {
      //       ElMessage.error('Failed to send reset email: ' + (res.msg || 'Unknown error'));
      //     }
      //   })
      //   .catch((err: any) => {
      //     ElMessage.error(err.message || 'Failed to send reset email');
      //   })
      //   .finally(() => {
      //     loading.value = false;
      //   });

      // 临时模拟发送成功
      setTimeout(() => {
        ElMessage.success('Reset email sent successfully');
        loading.value = false;
        currentStep.value = 2;
      }, 2000);
    }
  });
};

// 验证验证码
const handleVerifyCode = () => {
  if (!codeFormRef.value) return;
  codeFormRef.value.validate((valid: boolean) => {
    if (valid) {
      loading.value = true;
      // TODO: 调用验证码验证接口
      // verifyResetCode({
      //   email: emailForm.email,
      //   code: codeForm.code,
      // })
      //   .then((res: { code: number; msg?: string }) => {
      //     if (res.code === 200) {
      //       ElMessage.success('Verification code verified successfully');
      //       currentStep.value = 3;
      //     } else {
      //       ElMessage.error('Invalid verification code: ' + (res.msg || 'Unknown error'));
      //     }
      //   })
      //   .catch((err: any) => {
      //     ElMessage.error(err.message || 'Failed to verify code');
      //   })
      //   .finally(() => {
      //     loading.value = false;
      //   });

      // 临时模拟验证成功
      setTimeout(() => {
        ElMessage.success('Verification code verified successfully');
        loading.value = false;
        currentStep.value = 3;
      }, 2000);
    }
  });
};

// 重置密码
const handleResetPassword = () => {
  if (!passwordFormRef.value) return;
  passwordFormRef.value.validate((valid: boolean) => {
    if (valid) {
      loading.value = true;
      // TODO: 调用重置密码接口
      // resetPassword({
      //   email: emailForm.email,
      //   code: codeForm.code,
      //   password: passwordForm.password,
      // })
      //   .then((res: { code: number; msg?: string }) => {
      //     if (res.code === 200) {
      //       ElMessage.success('Password reset successfully');
      //       currentStep.value = 4;
      //     } else {
      //       ElMessage.error('Failed to reset password: ' + (res.msg || 'Unknown error'));
      //     }
      //   })
      //   .catch((err: any) => {
      //     ElMessage.error(err.message || 'Failed to reset password');
      //   })
      //   .finally(() => {
      //     loading.value = false;
      //   });

      // 临时模拟重置成功
      setTimeout(() => {
        ElMessage.success('Password reset successfully');
        loading.value = false;
        currentStep.value = 4;
      }, 2000);
    }
  });
};

const goToLogin = () => {
  router.push('/login');
};
</script>

<style lang="scss" scoped>
.forgot-password-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.forgot-password-left {
  width: 100%;
  background: #223e36;
  display: flex;
  flex-direction: column;
  padding: 120px 60px;
  color: white;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-image: url('@/assets/hex-pattern.png');
    background-size: cover;
    opacity: 0.2;
    pointer-events: none;
  }
}

.logo-container {
  display: flex;
  align-items: center;
  margin-bottom: 80px;

  .logo {
    width: 50px;
    height: 50px;
    margin-right: 15px;
  }

  .title {
    font-size: 32px;
    font-weight: 500;
  }
}

.slogan {
  margin-top: auto;
  margin-bottom: 200px;

  .main-slogan {
    font-size: 48px;
    font-weight: 700;
    margin-bottom: 24px;
    line-height: 60px;
  }

  .sub-slogan {
    font-size: 36px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
  }
}

.forgot-password-right {
  width: 60%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #fff;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);

  .lang-switch {
    position: absolute;
    top: 20px;
    right: 20px;

    :deep(.lang-dropdown-link) {
      color: #223e36;
      font-size: 14px;

      &:hover {
        color: #223e36;
        opacity: 0.8;
      }
    }
  }
}

.forgot-password-form {
  width: 75%;
  max-width: 450px;
}

.forgot-password-title {
  font-size: 42px;
  font-weight: 600;
  margin-bottom: 15px;
  text-align: center;
  color: #333;
}

.forgot-password-subtitle {
  font-size: 16px;
  margin-bottom: 40px;
  text-align: center;
  color: #333;
}

.step-container {
  margin-bottom: 20px;
}

.form-item-label {
  font-size: 16px;
  margin-bottom: 8px;
  color: #303133;
}

:deep(.el-input__wrapper) {
  padding: 0 15px;
  height: 50px;
  box-shadow: 0 0 0 1px #dcdfe6;
  &:hover {
    box-shadow: 0 0 0 1px #c0c4cc;
  }

  &.is-focus {
    box-shadow: 0 0 0 1px #409eff;
  }
}

.submit-button {
  width: 100%;
  padding: 12px 0;
  font-size: 16px;
  margin-bottom: 20px;
  background: #1e2022;
  height: 50px;

  &:hover {
    background: #1e2022;
    opacity: 0.9;
  }
}

.success-container {
  text-align: center;
  padding: 40px 0;

  .success-icon {
    margin-bottom: 20px;
  }

  .success-title {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 16px;
    color: #333;
  }

  .success-message {
    font-size: 16px;
    color: #666;
    margin-bottom: 30px;
    line-height: 1.5;
  }
}

.back-to-login {
  text-align: center;
  margin-top: 20px;

  .login-link {
    color: #409eff;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}

@media (max-width: 768px) {
  .forgot-password-container {
    flex-direction: column;
  }

  .forgot-password-left,
  .forgot-password-right {
    width: 100%;
  }

  .forgot-password-left {
    height: 40vh;
    padding: 40px 30px;
  }

  .logo-container {
    margin-bottom: 30px;
  }

  .slogan {
    margin-bottom: 30px;

    .main-slogan {
      font-size: 32px;
      line-height: 40px;
      margin-bottom: 16px;
    }

    .sub-slogan {
      font-size: 24px;
    }
  }

  .forgot-password-right {
    height: 60vh;
    padding: 40px 0;
  }

  .forgot-password-form {
    width: 85%;
  }
}
</style> 