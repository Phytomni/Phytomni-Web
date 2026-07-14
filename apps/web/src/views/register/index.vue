<template>
  <PhyAuthLayout>
    <template #lang>
      <LangSwitch />
    </template>
    <template #brand>
      <div class="register-brand">
        <PhyBrandMark :size="40" />
        <span class="register-brand-title">{{ $t("chat.appTitle") }}</span>
      </div>
    </template>

    <template #title>
      <h1 class="register-title">{{ $t("register.title") }}</h1>
    </template>
    <template #description>
      <p class="register-subtitle">{{ $t("register.subtitle") }}</p>
    </template>
    <el-form
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
import LangSwitch from "@/components/LangSwitch.vue";
import { PhyAuthLayout } from "@/components/shell";
import { PhyBrandMark } from "@/components/brand";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
onMounted(() => {
  redirectIfAuthed(route, router);
});
const loading = ref(false);
const formRef = ref<InstanceType<typeof ElForm>>();

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
    formRef.value?.validateField("confirmPassword");
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
  formRef.value.validate((valid: boolean) => {
    if (valid) {
      loading.value = true;
      handleRegister();
    } else {
      ElMessage.warning(t("register.validation.formValidationFailed"));
    }
  });
};

const handleRegister = () => {
  const data = new FormData();
  data.append("email", formData.email);
  data.append("password", formData.password);
  register(data)
    .then((res: { code: number; message?: string }) => {
      if (res.code === 200) {
        ElMessage.success(t("common.registrationSuccess"));
        router.replace("/login");
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
  router.push("/login");
};
</script>

<style lang="scss" scoped>
.register-brand {
  display: flex;
  align-items: center;
  gap: var(--phy-space-8);
  min-width: 0;
}

.register-brand-title {
  min-width: 0;
  overflow: hidden;
  color: var(--phy-color-text);
  font-size: 1.05rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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
