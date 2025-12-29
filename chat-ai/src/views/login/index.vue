<template>
  <div class="login-container">
    <div class="login-left">
      <div class="logo-container">
        <div class="logo" style="width: 40px; height: 40px"></div>
        <!-- <img src="@/assets/logo.svg" class="logo" alt="Logo" /> -->
        <!-- <h1 class="title">Crop Wild Relatives Atlas</h1> -->
      </div>
      <div class="slogan">
        <!-- <h2 class="main-slogan">CAAS Foundation Model</h2>
        <h3 class="sub-slogan">Decoding Life</h3> -->
      </div>
    </div>
    <div class="login-right">
      <div class="lang-switch">
        <LangSwitch />
      </div>
      <div class="login-form">
        <h2 class="login-title">
          <!-- {{ isLogin ? $t('login.title') : $t('login.registerTitle') }} -->
          {{ $t('login.title') }}
        </h2>
        <h5 class="login-subtitle">
          {{ $t('login.subtitle') }}
        </h5>
        <el-form ref="formRef" :model="formData" :rules="formRules" status-icon>
          <div class="form-item-label">{{ $t('login.email') }}</div>
          <el-form-item prop="email">
            <el-input
              v-model="formData.email"
              :placeholder="$t('login.emailPlaceholder')"
              clearable
              size="large" />
          </el-form-item>

          <div class="form-item-label">{{ $t('login.password') }}</div>
          <el-form-item prop="password">
            <el-input
              v-model="formData.password"
              type="password"
              :placeholder="$t('login.passwordPlaceholder')"
              show-password
              clearable
              size="large" />
          </el-form-item>
          <div class="login-agreement">
            {{ $t('login.agreement.prefix') }}
            <a href="#">{{ $t('login.agreement.terms') }}</a>
            {{ $t('login.agreement.and') }}
            <a href="#">{{ $t('login.agreement.privacy') }}</a>
          </div>
          <div class="forgot-password">
            <a href="#" @click="goToForgotPassword">{{ $t('login.forgotPassword') }}</a>
          </div>

          <el-button
            type="primary"
            class="login-button"
            @click="handleSubmit"
            :loading="loading">
            {{ $t('login.loginButton') }}
          </el-button>

          <div class="register-container">
            <span>{{ $t('login.noAccount') }}</span>
            <a
              href="javascript:;"
              class="register-link"
              @click="goToRegister">
              {{ $t('login.register') }}
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
  import { ElMessage, ElNotification } from 'element-plus';
  import { login } from '@/api/login';
  import { register } from '@/api/auth';
  import { setToken } from '@/utils/auth';
  import LangSwitch from '@/components/LangSwitch.vue';
  import { useI18n } from 'vue-i18n';
  import { userStore } from '@/stores';

  const useUserStore = userStore();
  const { t } = useI18n();
  const router = useRouter();
  const isLogin = ref(true);
  const loading = ref(false);
  const formRef = ref<InstanceType<typeof ElForm>>();

  const formData = reactive({
    email: '',
    password: '',
  });

  const formRules = reactive({
    email: [
      { required: true, message: t('login.validation.emailRequired'), trigger: 'blur' as const },
      {
        type: 'email' as const,
        message: t('login.validation.emailFormat'),
        trigger: 'blur' as const,
      },
    ],
    password: [
      {
        required: true,
        message: t('login.validation.passwordRequired'),
        trigger: 'blur' as const,
      },
      {
        min: 6,
        max: 16,
        message: t('login.validation.passwordLength'),
        trigger: 'blur' as const,
      },
    ],
  });

  const toggleLoginRegister = () => {
    isLogin.value = !isLogin.value;
    formRef.value?.resetFields();
  };

  const handleSubmit = () => {
    if (!formRef.value) return;
    formRef.value.validate((valid: boolean) => {
      if (valid) {
        loading.value = true;
        if (isLogin.value) {
          handleLogin();
        } else {
          handleRegister();
        }
      }
    });
  };

  const handleLogin = () => {
    console.log('开始登录...');

    // 创建FormData对象
    const loginFormData = new FormData();
    loginFormData.append('email', formData.email);
    loginFormData.append('password', formData.password);

    login(loginFormData)
      .then((res: {
        code: number;
        data?: {
          token: string;
          user_name: string;
          login_status: string;
          password_warning?: string;
        };
        msg?: string;
        message?: string;
      }) => {
        console.log('登录响应:', res);
        if (res.code === 200) {
          console.log('登录成功，准备跳转...');
          ElMessage.success('Login successful');
          setToken(res.data!.token);
          //保存用户名
          useUserStore.SET_USER_NAME(res.data!.user_name);
          //保存登录状态
          useUserStore.SET_LOGIN_STATUS(res.data!.login_status);
          console.log('用户名已保存到store:', useUserStore.name);
          console.log('登录状态已保存到store:', useUserStore.login_status);
          console.log('Store状态:', useUserStore);

          // 检查是否是首次登录，需要修改密码
          if (res.data!.login_status === '0') {
            console.log('首次登录，跳转到修改密码页面');
            ElNotification({
              title: t('login.firstLoginTitle'),
              message: t('login.firstLoginMessage'),
              type: 'warning',
              duration: 0,
              position: 'top-right',
            });
            router.replace('/change-password');
            return;
          }

          // 检查密码警告信息
          if (res.data!.password_warning) {
            ElNotification({
              title: t('login.passwordWarningTitle'),
              message: res.data!.password_warning,
              type: 'warning',
              duration: 0, // 不自动关闭，需要用户手动关闭
              position: 'top-right',
            });
          }

          console.log('Token已设置，跳转到chat页面');
          router.replace('/chat');
        } else {
          console.log('登录失败，状态码:', res.code);
          const errorMessage = res.message || res.msg || t('login.loginFailed');

          // 检查是否是账户锁定相关的消息
          if (errorMessage.includes('锁定') || errorMessage.includes('locked')) {
            ElNotification({
              title: t('login.accountLockedTitle'),
              message: errorMessage,
              type: 'error',
              duration: 0,
              position: 'top-right',
            });
          } else {
            ElMessage.error(errorMessage);
          }
        }
      })
      .catch((err: any) => {
        console.log('登录异常:', err);
        const response = err.response?.data;
        const errorMessage = response?.message || response?.msg || err.message || t('login.loginFailed');

        // 检查是否是账户锁定相关的消息
        if (errorMessage.includes('锁定') || errorMessage.includes('locked')) {
          ElNotification({
            title: t('login.accountLockedTitle'),
            message: errorMessage,
            type: 'error',
            duration: 0,
            position: 'top-right',
          });
        } else {
          ElMessage.error(errorMessage);
        }
      })
      .finally(() => {
        loading.value = false;
      });
  };

  const handleRegister = () => {
    const registerFormData = new FormData();
    registerFormData.append('email', formData.email);
    registerFormData.append('password', formData.password);
    register(registerFormData)
      .then((res: { code: number }) => {
        if (res.code === 200) {
          ElMessage.success('Registration successful');
          isLogin.value = true;
        }
      })
      .catch((err: { message: string }) => {
        ElMessage.error(err.message || 'Registration failed');
      })
      .finally(() => {
        loading.value = false;
      });
  };

  const goToForgotPassword = () => {
    router.push('/forgot-password');
  };

  const goToRegister = () => {
    router.push('/register');
  };
</script>

<style lang="scss" scoped>
  .login-container {
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

  .login-left {
    width: 100%;
    // background: linear-gradient(135deg, #0078d4 0%, #42d3ff 100%);
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

  .login-right {
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

  .login-form {
    width: 75%;
    max-width: 450px;
  }

  .login-title {
    font-size: 42px;
    font-weight: 600;
    margin-bottom: 15px;
    text-align: center;
    color: #333;
  }
  .login-subtitle {
    font-size: 16px;
    margin-bottom: 40px;
    text-align: center;
    color: #333;
  }
  .login-agreement {
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

  .forgot-password {
    text-align: right;
    margin: 8px 0 20px;

    a {
      color: #409eff;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }

  .login-button {
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

  .register-container {
    text-align: center;
    margin-top: 20px;

    span {
      color: #606266;
    }

    .register-link {
      color: #409eff;
      text-decoration: none;
      margin-left: 5px;

      &:hover {
        text-decoration: underline;
      }
    }
  }

  @media (max-width: 768px) {
    .login-container {
      flex-direction: column;
    }

    .login-left,
    .login-right {
      width: 100%;
    }

    .login-left {
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

    .login-right {
      height: 60vh;
      padding: 40px 0;
    }

    .login-form {
      width: 85%;
    }
  }
</style>

<!-- 全局样式：调整 ElNotification 关闭按钮位置 -->
<style lang="scss">
.el-notification {
  .el-notification__closeBtn {
    top: 10px;
    right: 10px;
  }
}
</style>
