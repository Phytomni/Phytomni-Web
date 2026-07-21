<template>
  <PhyAuthLayout horizon>
    <template #lang>
      <LangSwitch />
    </template>
    <template #brand>
      <PhyAuthBrand :title="$t('chat.appTitle')" />
    </template>

    <template #title>
      <h1 class="login-title">
        {{ $t("login.title") }}
      </h1>
    </template>
    <template #description>
      <p class="login-subtitle">
        {{ $t("login.subtitle") }}
      </p>
    </template>
    <el-form
      ref="formRef"
      class="login-form"
      :model="formData"
      :rules="formRules"
      status-icon
    >
      <div class="form-item-label">{{ $t("login.email") }}</div>
      <el-form-item prop="email">
        <el-input
          v-model="formData.email"
          :placeholder="$t('login.emailPlaceholder')"
          clearable
          size="large"
        />
      </el-form-item>

      <div class="form-item-label">{{ $t("login.password") }}</div>
      <el-form-item prop="password">
        <el-input
          v-model="formData.password"
          type="password"
          :placeholder="$t('login.passwordPlaceholder')"
          show-password
          clearable
          size="large"
        />
      </el-form-item>
      <div class="login-agreement">
        {{ $t("login.agreement.prefix") }}
        <a href="/terms" target="_blank" rel="noopener noreferrer">{{
          $t("login.agreement.terms")
        }}</a>
        {{ $t("login.agreement.and") }}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">{{
          $t("login.agreement.privacy")
        }}</a>
      </div>
      <div class="forgot-password">
        <a href="/forgot-password" @click.prevent="goToForgotPassword">{{
          $t("login.forgotPassword")
        }}</a>
      </div>

      <el-button
        type="primary"
        class="login-button"
        @click="handleSubmit"
        :loading="loading"
      >
        {{ $t("login.loginButton") }}
      </el-button>

      <div class="register-container">
        <span>{{ $t("login.noAccount") }}</span>
        <a href="/register" class="register-link" @click.prevent="goToRegister">
          {{ $t("login.register") }}
        </a>
      </div>
    </el-form>
  </PhyAuthLayout>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useRoute } from "vue-router";
import { onMounted } from "vue";
import { redirectIfAuthed, safeRedirect } from "@/utils/auth-redirect";
import type { ElForm } from "element-plus";
import { ElMessage, ElNotification } from "element-plus";
import { login } from "@/api/login";
import { register } from "@/api/auth";
import type { ApiEnvelope } from "@/api/types";
import { isRecord, optionalString } from "@/api/contracts";
import { setToken } from "@/utils/auth";
import LangSwitch from "@/components/LangSwitch.vue";
import { PhyAuthBrand, PhyAuthLayout } from "@/components/shell";
import { useI18n } from "vue-i18n";
import { userStore } from "@/stores";

const useUserStore = userStore();
const { t } = useI18n();
const router = useRouter();
const route = useRoute();
onMounted(() => {
  redirectIfAuthed(route, router);
});
const isLogin = ref(true);
const loading = ref(false);
const formRef = ref<InstanceType<typeof ElForm>>();

const formData = reactive({
  email: "",
  password: "",
});

const formRules = reactive({
  email: [
    {
      required: true,
      message: t("login.validation.emailRequired"),
      trigger: "blur" as const,
    },
    {
      type: "email" as const,
      message: t("login.validation.emailFormat"),
      trigger: "blur" as const,
    },
  ],
  password: [
    {
      required: true,
      message: t("login.validation.passwordRequired"),
      trigger: "blur" as const,
    },
    {
      min: 6,
      max: 16,
      message: t("login.validation.passwordLength"),
      trigger: "blur" as const,
    },
  ],
});

const handleSubmit = () => {
  if (!formRef.value) return;
  formRef.value
    .validate((valid: boolean) => {
      if (valid) {
        loading.value = true;
        if (isLogin.value) {
          handleLogin();
        } else {
          handleRegister();
        }
      }
    })
    .catch(() => undefined);
};

const handleLogin = () => {
  // Create a FormData object
  const loginFormData = new FormData();
  loginFormData.append("email", formData.email);
  loginFormData.append("password", formData.password);

  login(loginFormData)
    .then((res) => {
      if (res.code === 200) {
        const loginData = res.data;
        ElMessage.success(t("login.loginSuccess"));
        setToken(loginData.token);
        // Save the user name
        useUserStore.SET_USER_NAME(loginData.user_name);
        // Save the login status
        useUserStore.SET_LOGIN_STATUS(loginData.login_status);

        // Check whether this is the first login and the password must be changed
        if (loginData.login_status === "0") {
          // The tutorial trigger is not set here — after a successful password change,
          // change-password.vue writes sessionStorage.tutorial_pending, and
          // chat/index.vue checkTutorialStatus consumes it once and then flips
          // SET_SEEN_TUTORIAL('0') (TW-D15).
          ElNotification({
            title: t("login.firstLoginTitle"),
            message: t("login.firstLoginMessage"),
            type: "warning",
            duration: 0,
            position: "top-right",
          });
          return router.replace("/change-password");
        }

        // Check the password warning message
        if (loginData.password_warning) {
          ElNotification({
            title: t("login.passwordWarningTitle"),
            message: loginData.password_warning,
            type: "warning",
            duration: 0, // Do not auto-close; requires the user to close it manually
            position: "top-right",
          });
        }

        return router.replace(safeRedirect(route.query.redirect, "/chat"));
      } else {
        const errorMessage = res.message || t("login.loginFailed");

        // The backend reports the locked state via the res.data.locked flag (replacing the old substring sniffing)
        if (res.data?.locked === true) {
          ElNotification({
            title: t("login.accountLockedTitle"),
            message: errorMessage,
            type: "error",
            duration: 0,
            position: "top-right",
          });
        } else {
          ElMessage.error(errorMessage);
        }
      }
    })
    .catch((err: unknown) => {
      const responseData =
        isRecord(err) && isRecord(err.response) ? err.response.data : undefined;
      const response = isRecord(responseData) ? responseData : undefined;
      const errorMessage =
        (response && optionalString(response, "message")) ||
        (isRecord(err) && optionalString(err, "message")) ||
        (err instanceof Error ? err.message : undefined) ||
        t("login.loginFailed");

      // The backend reports the locked state via the response.locked flag (replacing the old substring sniffing)
      if (response?.locked === true) {
        ElNotification({
          title: t("login.accountLockedTitle"),
          message: errorMessage,
          type: "error",
          duration: 0,
          position: "top-right",
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
  registerFormData.append("email", formData.email);
  registerFormData.append("password", formData.password);
  register(registerFormData)
    .then((res: ApiEnvelope<string>) => {
      if (res.code === 200) {
        ElMessage.success(t("common.registrationSuccess"));
        isLogin.value = true;
      }
    })
    .catch((err: unknown) => {
      ElMessage.error(
        (err instanceof Error ? err.message : undefined) ||
          t("login.registerFailed")
      );
    })
    .finally(() => {
      loading.value = false;
    });
};

const goToForgotPassword = () => {
  router.push("/forgot-password").catch(() => undefined);
};

const goToRegister = () => {
  router.push("/register").catch(() => undefined);
};
</script>

<style lang="scss" scoped>
.login-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
}

.login-subtitle {
  margin: var(--phy-space-8) 0 0;
  font-weight: 400;
  color: var(--phy-color-text-secondary);
}

.form-item-label {
  margin-bottom: 6px;
  color: var(--phy-color-text-secondary);
  font-size: 13px;
}

.login-agreement,
.forgot-password {
  font-size: 13px;
  color: var(--phy-color-text-secondary);
  a {
    color: var(--phy-color-primary);
    text-decoration: none;
  }
}

.forgot-password {
  text-align: right;
  margin-bottom: 12px;
}

.login-button {
  width: 100%;
  margin-top: 8px;
}

.register-container {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--phy-color-text-secondary);
  a {
    color: var(--phy-color-primary);
    text-decoration: none;
  }
}
</style>

<!-- Global styles: adjust the ElNotification close-button position + mobile responsive width -->
<style lang="scss">
.el-notification {
  .el-notification__closeBtn {
    top: 10px;
    right: 10px;
  }
}

/* On a mobile viewport the default 330px notification would overlap the right:16px anchor and overflow;
   for 320-360px devices, shrink it to calc(100vw - 24px) + 12px margins on both sides */
@media (max-width: 768px) {
  .el-notification {
    width: calc(100vw - 24px);
    max-width: 360px;
    min-width: 0;
    left: 12px !important;
    right: 12px !important;
  }
}
</style>
