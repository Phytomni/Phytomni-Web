<template>
  <PhyAuthLayout>
    <template #lang>
      <LangSwitch />
    </template>
    <template #brand>
      <div class="change-password-brand">
        <PhyBrandMark :size="40" />
        <span class="change-password-brand-title">
          {{ $t("chat.appTitle") }}
        </span>
      </div>
    </template>

    <template #title>
      <div class="change-password-heading">
        <el-button
          v-if="!isFirstLogin"
          class="change-password-back"
          text
          @click="goBack"
        >
          <el-icon aria-hidden="true"><ArrowLeft /></el-icon>
          {{ $t("common.back") }}
        </el-button>
        <h1 class="change-password-title">
          {{ $t("user.changePassword") }}
        </h1>
      </div>
    </template>

    <template #description>
      <p v-if="isFirstLogin" class="change-password-description">
        {{ $t("login.firstLoginEnforceMessage") }}
      </p>
    </template>

    <el-form
      ref="passwordFormRef"
      class="change-password-form"
      :model="passwordForm"
      :rules="formRules"
      status-icon
    >
      <el-form-item
        class="change-password-field"
        :label="$t('user.username')"
        prop="username"
      >
        <el-input
          v-model="passwordForm.username"
          :placeholder="$t('changePassword.usernamePlaceholder')"
          disabled
          readonly
          size="large"
        />
      </el-form-item>

      <el-form-item
        class="change-password-field"
        :label="$t('changePassword.oldPassword')"
        prop="oldPassword"
      >
        <el-input
          v-model="passwordForm.oldPassword"
          type="password"
          show-password
          :placeholder="$t('changePassword.oldPasswordPlaceholder')"
          size="large"
        />
      </el-form-item>

      <el-form-item
        class="change-password-field"
        :label="$t('changePassword.newPassword')"
        prop="newPassword"
      >
        <el-input
          v-model="passwordForm.newPassword"
          type="password"
          show-password
          :placeholder="$t('changePassword.newPasswordPlaceholder')"
          size="large"
        />
      </el-form-item>

      <el-form-item
        class="change-password-field"
        :label="$t('changePassword.confirmPassword')"
        prop="confirmPassword"
      >
        <el-input
          v-model="passwordForm.confirmPassword"
          type="password"
          show-password
          :placeholder="$t('changePassword.confirmPasswordPlaceholder')"
          size="large"
        />
      </el-form-item>

      <el-form-item class="change-password-actions-item">
        <div class="change-password-actions">
          <el-button
            class="change-password-reset"
            :disabled="loading"
            @click="resetForm"
          >
            {{ $t("common.reset") }}
          </el-button>
          <el-button
            class="change-password-submit"
            type="primary"
            :loading="loading"
            @click="submitForm"
          >
            {{ $t("changePassword.confirm") }}
          </el-button>
        </div>
      </el-form-item>
    </el-form>
  </PhyAuthLayout>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { useRouter } from "vue-router";
import { userStore } from "@/stores";
import { useI18n } from "vue-i18n";
import { changePassword } from "@/api/auth";
import LangSwitch from "@/components/LangSwitch.vue";
import { PhyAuthLayout } from "@/components/shell";
import { PhyBrandMark } from "@/components/brand";

const { t } = useI18n();
const router = useRouter();
const UserStore = userStore();
const { isFirstLogin } = storeToRefs(UserStore);

const passwordFormRef = ref();
const loading = ref(false);
const submitting = ref(false);

const passwordForm = reactive({
  id: "",
  code: "",
  username: "",
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
});

const goBack = () => {
  router.back();
};

const validateConfirmPassword = (
  _rule: unknown,
  value: string,
  callback: (error?: Error) => void
) => {
  if (value === "") {
    callback(new Error(t("changePassword.confirmPasswordRequired")));
  } else if (value !== passwordForm.newPassword) {
    callback(new Error(t("changePassword.passwordMismatch")));
  } else {
    callback();
  }
};

const validatePasswordStrength = (
  _rule: unknown,
  value: string,
  callback: (error?: Error) => void
) => {
  if (!value) {
    callback();
    return;
  }

  if (value.length < 8) {
    callback(new Error(t("changePassword.passwordMinLength8")));
    return;
  }

  if (!/[A-Z]/.test(value)) {
    callback(new Error(t("changePassword.passwordNeedUppercase")));
    return;
  }

  if (!/[a-z]/.test(value)) {
    callback(new Error(t("changePassword.passwordNeedLowercase")));
    return;
  }

  if (!/[0-9]/.test(value)) {
    callback(new Error(t("changePassword.passwordNeedNumber")));
    return;
  }

  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(value)) {
    callback(new Error(t("changePassword.passwordNeedSpecial")));
    return;
  }

  callback();
};

const formRules = reactive({
  username: [
    {
      required: true,
      message: t("changePassword.usernameRequired"),
      trigger: "blur",
    },
  ],
  oldPassword: [
    {
      required: true,
      message: t("changePassword.oldPasswordRequired"),
      trigger: "blur",
    },
    {
      min: 6,
      message: t("changePassword.passwordMinLength"),
      trigger: "blur",
    },
  ],
  newPassword: [
    {
      required: true,
      message: t("changePassword.newPasswordRequired"),
      trigger: "blur",
    },
    {
      validator: validatePasswordStrength,
      trigger: "blur",
    },
    {
      validator: (
        _rule: unknown,
        value: string,
        callback: (error?: Error) => void
      ) => {
        if (value === passwordForm.oldPassword) {
          callback(new Error(t("changePassword.passwordSame")));
        } else {
          if (passwordForm.confirmPassword !== "") {
            passwordFormRef.value?.validateField("confirmPassword");
          }
          callback();
        }
      },
      trigger: "blur",
    },
  ],
  confirmPassword: [
    {
      required: true,
      message: t("changePassword.confirmPasswordRequired"),
      trigger: "blur",
    },
    { validator: validateConfirmPassword, trigger: "blur" },
  ],
});

const resetForm = () => {
  passwordForm.oldPassword = "";
  passwordForm.newPassword = "";
  passwordForm.confirmPassword = "";
  passwordFormRef.value?.resetFields();
};

const finishPasswordChange = async () => {
  await Promise.resolve(UserStore.FedLogOut())
    .finally(() => {
      try {
        sessionStorage.setItem("tutorial_pending", "1");
      } catch {
        // Storage is best-effort; the login redirect must still happen.
      }
      router.replace("/login");
    })
    .catch(() => undefined);
};

const submitForm = async () => {
  if (!passwordFormRef.value || loading.value || submitting.value) return;

  submitting.value = true;
  try {
    const valid = await passwordFormRef.value.validate();
    if (!valid) {
      ElMessage.warning(t("changePassword.formValidationFailed"));
      return;
    }

    loading.value = true;
    try {
      const formData = new FormData();
      formData.append("password", passwordForm.oldPassword);
      formData.append("new_password", passwordForm.newPassword);
      const response = await changePassword(formData);

      if (response.code === 200) {
        ElMessage.success(t("changePassword.passwordChangeSuccess"));
        await finishPasswordChange();
      } else {
        ElMessage.error(
          response.message || t("changePassword.passwordChangeFailed")
        );
      }
    } catch (error: unknown) {
      const response =
        typeof error === "object" && error !== null && "response" in error
          ? (error as { response?: { data?: { message?: string } } }).response
          : undefined;
      ElMessage.warning(
        response?.data?.message || t("changePassword.passwordChangeRetry")
      );
    } finally {
      loading.value = false;
    }
  } finally {
    submitting.value = false;
  }
};

onMounted(() => {
  if (UserStore.name) {
    passwordForm.username = UserStore.name;
  }
});
</script>

<style scoped lang="scss">
.change-password-heading {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--phy-space-8);
}

.change-password-brand {
  display: flex;
  align-items: center;
  gap: var(--phy-space-8);
  min-width: 0;
}

.change-password-brand-title {
  min-width: 0;
  overflow: hidden;
  color: var(--phy-color-text);
  font-size: 1.05rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-password-back {
  min-height: var(--phy-control-height-compact);
  padding: 0;
  color: var(--phy-color-text-secondary);
}

.change-password-title {
  margin: 0;
  color: var(--phy-color-text);
  font-size: 1.35rem;
  font-weight: 650;
  line-height: 1.25;
}

.change-password-description {
  margin: var(--phy-space-8) 0 0;
  color: var(--phy-color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.55;
}

.change-password-form {
  display: flex;
  flex-direction: column;
  gap: var(--phy-space-4);
}

.change-password-field {
  margin-bottom: var(--phy-space-8);
}

.change-password-field :deep(.el-form-item__label) {
  display: block;
  float: none;
  justify-content: flex-start;
  width: auto !important;
  height: auto;
  margin-bottom: var(--phy-space-8);
  padding: 0;
  color: var(--phy-color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.35;
  text-align: left;
}

.change-password-field :deep(.el-form-item__content) {
  display: block;
  margin-left: 0 !important;
}

.change-password-field :deep(.el-input__wrapper),
.change-password-field :deep(.el-input),
.change-password-field :deep(input) {
  min-height: var(--phy-control-height-primary);
}

.change-password-actions-item {
  margin: var(--phy-space-8) 0 0;
}

.change-password-actions-item :deep(.el-form-item__content) {
  display: block;
  margin-left: 0 !important;
}

.change-password-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--phy-space-12);
}

.change-password-actions :deep(.el-button) {
  width: 100%;
  min-height: var(--phy-control-height-primary);
  margin: 0;
}

@media (max-width: 420px) {
  .change-password-actions {
    grid-template-columns: 1fr;
  }
}
</style>
