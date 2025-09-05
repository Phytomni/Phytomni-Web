<template>
  <div class="register-container">
    <div class="register-left">
      <div class="logo-container">
        <div class="logo" style="width: 40px; height: 40px"></div>
      </div>
      <div class="slogan">
        <!-- 可以添加注册页面的标语 -->
      </div>
    </div>
    <div class="register-right">
      <div class="lang-switch">
        <LangSwitch />
      </div>
      <div class="register-form">
        <h2 class="register-title">{{ $t('register.title') }}</h2>
        <h5 class="register-subtitle">{{ $t('register.subtitle') }}</h5>
        <el-form ref="formRef" :model="formData" :rules="formRules" status-icon>
          <div class="form-item-label">{{ $t('register.email') }}</div>
          <el-form-item prop="email">
            <el-input
              v-model="formData.email"
              :placeholder="$t('register.emailPlaceholder')"
              clearable
              size="large" />
          </el-form-item>

          <div class="form-item-label">{{ $t('register.password') }}</div>
          <el-form-item prop="password">
            <el-input
              v-model="formData.password"
              type="password"
              :placeholder="$t('register.passwordPlaceholder')"
              show-password
              clearable
              size="large" />
          </el-form-item>

          <div class="form-item-label">{{ $t('register.confirmPassword') }}</div>
          <el-form-item prop="confirmPassword">
            <el-input
              v-model="formData.confirmPassword"
              type="password"
              :placeholder="$t('register.confirmPasswordPlaceholder')"
              show-password
              clearable
              size="large" />
          </el-form-item>

          <div class="register-agreement">
            {{ $t('register.agreement.prefix') }}
            <a href="#">{{ $t('register.agreement.terms') }}</a>
            {{ $t('register.agreement.and') }}
            <a href="#">{{ $t('register.agreement.privacy') }}</a>
          </div>

          <el-button
            type="primary"
            class="register-button"
            @click="handleSubmit"
            :loading="loading">
            {{ $t('register.registerButton') }}
          </el-button>

          <div class="login-container">
            <span>{{ $t('register.haveAccount') }}</span>
            <a
              href="javascript:;"
              class="login-link"
              @click="goToLogin">
              {{ $t('register.login') }}
            </a>
          </div>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ElForm } from 'element-plus';
import { ElMessage } from 'element-plus';
import { register } from '@/api/auth';
import LangSwitch from '@/components/LangSwitch.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const router = useRouter();
const loading = ref(false);
const formRef = ref<InstanceType<typeof ElForm>>();

const formData = reactive({
  email: '',
  password: '',
  confirmPassword: '',
});

// 自定义验证规则：确认密码
const validateConfirmPassword = (rule: any, value: string, callback: any) => {
  if (value === '') {
    callback(new Error(t('register.validation.confirmPasswordRequired')));
  } else if (value !== formData.password) {
    callback(new Error(t('register.validation.confirmPasswordMismatch')));
  } else {
    callback();
  }
};

const formRules = reactive({
  email: [
    { required: true, message: t('register.validation.emailRequired'), trigger: 'blur' as const },
    {
      type: 'email' as const,
      message: t('register.validation.emailFormat'),
      trigger: 'blur' as const,
    },
  ],
  password: [
    {
      required: true,
      message: t('register.validation.passwordRequired'),
      trigger: 'blur' as const,
    },
    {
      min: 8,
      max: 16,
      message: t('register.validation.passwordLength'),
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

const handleSubmit = () => {
  if (!formRef.value) return;
  formRef.value.validate((valid: boolean) => {
    if (valid) {
      loading.value = true;
      handleRegister();
    }
  });
};

const handleRegister = () => {
  console.log('开始注册...');
  const data = new FormData();
  data.append('email', formData.email);
  data.append('password', formData.password);
  // TODO: 调用注册接口
  register(data)
    .then((res: any) => {
      console.log('注册响应:', res);
      if (res.code === 200) {
        console.log('注册成功');
        ElMessage.success('Registration successful');
        router.replace('/login');
      } else {
        console.log('注册失败，状态码:', res.code);
        ElMessage.error('Registration failed: ' + (res.msg || 'Unknown error'));
      }
    })
    .catch((err: any) => {
      console.log('注册异常:', err);
      ElMessage.error(err.message || 'Registration failed');
    })
    .finally(() => {
      loading.value = false;
    });

  // 临时模拟注册成功
  // setTimeout(() => {
  //   ElMessage.success('Registration successful');
  //   loading.value = false;
  //   router.replace('/login');
  // }, 2000);
};

const goToLogin = () => {
  router.push('/login');
};
</script>

<style lang="scss" scoped>
.register-container {
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

.register-left {
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

.register-right {
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

.register-form {
  width: 75%;
  max-width: 450px;
}

.register-title {
  font-size: 42px;
  font-weight: 600;
  margin-bottom: 15px;
  text-align: center;
  color: #333;
}

.register-subtitle {
  font-size: 16px;
  margin-bottom: 40px;
  text-align: center;
  color: #333;
}

.register-agreement {
  font-size: 10px;
  margin-bottom: 20px;
  text-align: left;
  color: #333;
  a {
    color: #1e2022;
    font-weight: 500;
    text-decoration: underline;
  }
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

.register-button {
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

.login-container {
  text-align: center;
  margin-top: 20px;

  span {
    color: #606266;
  }

  .login-link {
    color: #409eff;
    text-decoration: none;
    margin-left: 5px;

    &:hover {
      text-decoration: underline;
    }
  }
}

@media (max-width: 768px) {
  .register-container {
    flex-direction: column;
  }

  .register-left,
  .register-right {
    width: 100%;
  }

  .register-left {
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

  .register-right {
    height: 60vh;
    padding: 40px 0;
  }

  .register-form {
    width: 85%;
  }
}
</style> 