<template>
  <PhyAuthLayout>
    <template #lang>
      <LangSwitch />
    </template>
    <template #brand>
      <PhyAuthBrand :title="$t('chat.appTitle')" />
    </template>

    <template #title>
      <h1 class="register-title">
        {{
          $t(registrationEnabled ? "register.title" : "register.closedTitle")
        }}
      </h1>
    </template>
    <template #description>
      <p class="register-subtitle">
        {{
          $t(
            registrationEnabled
              ? "register.subtitle"
              : "register.closedSubtitle"
          )
        }}
      </p>
    </template>
    <el-form
      v-if="registrationEnabled"
      ref="formRef"
      class="register-form"
      :model="formData"
      :rules="formRules"
      status-icon
    >
      <div class="form-item-label">{{ $t("register.email") }}</div>
      <el-form-item prop="email">
        <el-input
          v-model="formData.email"
          :placeholder="$t('register.emailPlaceholder')"
          clearable
          size="large"
        />
      </el-form-item>

      <div class="form-item-label">{{ $t("register.password") }}</div>
      <el-form-item prop="password">
        <el-input
          v-model="formData.password"
          type="password"
          :placeholder="$t('register.passwordPlaceholder')"
          show-password
          clearable
          size="large"
        />
      </el-form-item>

      <div class="form-item-label">
        {{ $t("register.confirmPassword") }}
      </div>
      <el-form-item prop="confirmPassword">
        <el-input
          v-model="formData.confirmPassword"
          type="password"
          :placeholder="$t('register.confirmPasswordPlaceholder')"
          show-password
          clearable
          size="large"
        />
      </el-form-item>

      <div class="register-agreement">
        <el-checkbox v-model="formData.agreedToLegal">
          {{ $t("register.agreement.checkboxLabel") }}
        </el-checkbox>
        <div class="register-agreement-links">
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            @click.stop
          >
            {{ $t("register.agreement.terms") }}
          </a>
          {{ $t("register.agreement.and") }}
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            @click.stop
          >
            {{ $t("register.agreement.privacy") }}
          </a>
        </div>
      </div>

      <el-button
        type="primary"
        class="register-button"
        @click="handleSubmit"
        :loading="loading"
        :disabled="!formData.agreedToLegal"
      >
        {{ $t("register.registerButton") }}
      </el-button>

      <div class="login-container">
        <span>{{ $t("register.haveAccount") }}</span>
        <a href="/login" class="login-link" @click.prevent="goToLogin">
          {{ $t("register.login") }}
        </a>
      </div>
    </el-form>
    <div v-else class="registration-closed" data-testid="registration-closed">
      <p>{{ $t("register.closedDescription") }}</p>
      <el-button type="primary" @click="goToLogin">
        {{ $t("register.returnToLogin") }}
      </el-button>
    </div>
  </PhyAuthLayout>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useRoute } from "vue-router";
import { onMounted } from "vue";
import { redirectIfAuthed } from "@/utils/auth-redirect";
import type { ElForm } from "element-plus";
import { ElMessage } from "element-plus";
import { register } from "@/api/auth";
import { useRegistrationAvailability } from "@/composables/useRegistrationAvailability";
import LangSwitch from "@/components/LangSwitch.vue";
import { PhyAuthBrand, PhyAuthLayout } from "@/components/shell";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
onMounted(() => {
  redirectIfAuthed(route, router);
});
const loading = ref(false);
const formRef = ref<InstanceType<typeof ElForm>>();
const { registrationEnabled } = useRegistrationAvailability();

const formData = reactive({
  email: "",
  password: "",
  confirmPassword: "",
  agreedToLegal: false,
});

// Custom validation rule: confirm password
type ValidationCallback = (error?: Error) => void;

const validateConfirmPassword = (
  _rule: unknown,
  value: string,
  callback: ValidationCallback
) => {
  if (value === "") {
    callback(new Error(t("register.validation.confirmPasswordRequired")));
  } else if (value !== formData.password) {
    callback(new Error(t("register.validation.confirmPasswordMismatch")));
  } else {
    callback();
  }
};

// Password strength validation function - checks whether the password meets complexity requirements
const validatePasswordStrength = (
  _rule: unknown,
  value: string,
  callback: ValidationCallback
) => {
  if (!value) {
    callback();
    return;
  }

  // At least 8 characters
  if (value.length < 8) {
    callback(new Error(t("register.validation.passwordMinLength8")));
    return;
  }

  // At most 16 characters
  if (value.length > 16) {
    callback(new Error(t("register.validation.passwordMaxLength16")));
    return;
  }

  // Must contain an uppercase letter
  if (!/[A-Z]/.test(value)) {
    callback(new Error(t("register.validation.passwordNeedUppercase")));
    return;
  }

  // Must contain a lowercase letter
  if (!/[a-z]/.test(value)) {
    callback(new Error(t("register.validation.passwordNeedLowercase")));
    return;
  }

  // Must contain a digit
  if (!/[0-9]/.test(value)) {
    callback(new Error(t("register.validation.passwordNeedNumber")));
    return;
  }

  // Must contain a special character
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(value)) {
    callback(new Error(t("register.validation.passwordNeedSpecial")));
    return;
  }

  // When the password changes, re-validate the confirm-password field if it has already been entered
  if (formData.confirmPassword !== "") {
    formRef.value?.validateField("confirmPassword").catch(() => undefined);
  }

  callback();
};

const formRules = reactive({
  email: [
    {
      required: true,
      message: t("register.validation.emailRequired"),
      trigger: "blur" as const,
    },
    {
      type: "email" as const,
      message: t("register.validation.emailFormat"),
      trigger: "blur" as const,
    },
  ],
  password: [
    {
      required: true,
      message: t("register.validation.passwordRequired"),
      trigger: "blur" as const,
    },
    {
      validator: validatePasswordStrength,
      trigger: "blur" as const,
    },
  ],
  confirmPassword: [
    {
      required: true,
      validator: validateConfirmPassword,
      trigger: "blur" as const,
    },
  ],
});

const handleSubmit = () => {
  if (!formData.agreedToLegal) {
    ElMessage.warning(t("register.agreement.checkboxRequired"));
    return;
  }
  if (!formRef.value) return;
  formRef.value
    .validate((valid: boolean) => {
      if (valid) {
        loading.value = true;
        handleRegister();
      } else {
        ElMessage.warning(t("register.validation.formValidationFailed"));
      }
    })
    .catch(() => undefined);
};

const handleRegister = () => {
  const data = new FormData();
  data.append("email", formData.email);
  data.append("password", formData.password);
  register(data)
    .then((res: { code: number; message?: string }) => {
      if (res.code === 200) {
        ElMessage.success(t("common.registrationSuccess"));
        return router.replace("/login");
      } else {
        ElMessage.error(res.message || t("register.registrationFailed"));
      }
    })
    .catch((err: unknown) => {
      const response =
        typeof err === "object" && err !== null && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response
          : undefined;
      const message =
        response?.data?.message ||
        (err instanceof Error ? err.message : undefined) ||
        t("register.registrationFailed");
      ElMessage.error(message);
    })
    .finally(() => {
      loading.value = false;
    });
};

const goToLogin = () => {
  router.push("/login").catch(() => undefined);
};
</script>

<style lang="scss" scoped>
.register-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
}

.register-subtitle {
  margin: var(--phy-space-8) 0 0;
  font-weight: 400;
  color: var(--phy-color-text-secondary);
}

.registration-closed {
  color: var(--phy-color-text-secondary);
}

.form-item-label {
  margin-bottom: 6px;
  color: var(--phy-color-text-secondary);
  font-size: 13px;
}

.register-agreement,
.login-container {
  font-size: 13px;
  color: var(--phy-color-text-secondary);
  a {
    color: var(--phy-color-primary);
    text-decoration: none;
  }
}

.register-agreement {
  display: flex;
  flex-direction: column;
  gap: var(--phy-space-4);
  line-height: 1.5;
}

.register-agreement :deep(.el-checkbox) {
  display: flex;
  align-items: flex-start;
  width: 100%;
  max-width: 100%;
  margin-right: 0;
}

.register-agreement :deep(.el-checkbox__input) {
  flex: 0 0 auto;
  margin-top: 2px;
}

.register-agreement :deep(.el-checkbox__label) {
  min-width: 0;
  max-width: 100%;
  padding-left: var(--phy-space-8);
  overflow-wrap: anywhere;
  white-space: normal;
}

.register-agreement-links {
  padding-left: var(--phy-space-24);
}

.register-button {
  width: 100%;
  margin-top: 8px;
}

.login-container {
  text-align: center;
  margin-top: 16px;
}
</style>
