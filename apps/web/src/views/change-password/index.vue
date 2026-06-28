<template>
  <div class="change-password-page">
    <div class="page-header">
      <div v-if="!isFirstLogin" class="back-button">
        <el-button @click="goBack" icon="ArrowLeft" text>{{
          $t("common.back")
        }}</el-button>
      </div>
      <h1 class="page-title">{{ $t("app.title") }}</h1>
    </div>

    <div class="change-password-container">
      <div class="form-card">
        <h2 class="title">{{ $t("user.changePassword") }}</h2>

        <el-form
          ref="passwordFormRef"
          :model="passwordForm"
          :rules="formRules"
          label-width="180px"
          status-icon
        >
          <el-form-item :label="$t('user.username')" prop="username">
            <el-input
              v-model="passwordForm.username"
              :placeholder="$t('changePassword.usernamePlaceholder')"
              disabled
              :readonly="true"
            />
          </el-form-item>

          <el-form-item
            :label="$t('changePassword.oldPassword')"
            prop="oldPassword"
          >
            <el-input
              v-model="passwordForm.oldPassword"
              type="password"
              show-password
              :placeholder="$t('changePassword.oldPasswordPlaceholder')"
            />
          </el-form-item>

          <el-form-item
            :label="$t('changePassword.newPassword')"
            prop="newPassword"
          >
            <el-input
              v-model="passwordForm.newPassword"
              type="password"
              show-password
              :placeholder="$t('changePassword.newPasswordPlaceholder')"
            />
          </el-form-item>

          <el-form-item
            :label="$t('changePassword.confirmPassword')"
            prop="confirmPassword"
          >
            <el-input
              v-model="passwordForm.confirmPassword"
              type="password"
              show-password
              :placeholder="$t('changePassword.confirmPasswordPlaceholder')"
            />
          </el-form-item>

          <el-form-item>
            <el-space>
              <el-button @click="resetForm">{{ $t("common.reset") }}</el-button>
              <el-button type="primary" @click="submitForm">{{
                $t("changePassword.confirm")
              }}</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { useRouter } from "vue-router";
import { userStore } from "@/stores";
import { useI18n } from "vue-i18n";
import { changePassword } from "@/api/auth";

const { t } = useI18n();
const router = useRouter();

// Form ref
const passwordFormRef = ref();

// Form data
const passwordForm = reactive({
  id: "", // User ID
  code: "", // User code / permission code
  username: "",
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
});

// First-login user has no legitimate back destination — router guard
// will bounce them back. Hide goBack to avoid the visible "flash and
// return" UX. Voluntary access (login_status='1') keeps the button.
const UserStore = userStore();
const isFirstLogin = computed(() => UserStore.login_status === "0");

// Go back to the previous page
const goBack = () => {
  router.back();
};

// Password validator - check that the confirm password matches the new password
const validateConfirmPassword = (rule: any, value: string, callback: any) => {
  if (value === "") {
    callback(new Error(t("changePassword.confirmPasswordRequired")));
  } else if (value !== passwordForm.newPassword) {
    callback(new Error(t("changePassword.passwordMismatch")));
  } else {
    callback();
  }
};

// Password strength validator - check that the new password meets complexity requirements
const validatePasswordStrength = (rule: any, value: string, callback: any) => {
  if (!value) {
    callback();
    return;
  }

  // At least 8 characters
  if (value.length < 8) {
    callback(new Error(t("changePassword.passwordMinLength8")));
    return;
  }

  // Contains an uppercase letter
  if (!/[A-Z]/.test(value)) {
    callback(new Error(t("changePassword.passwordNeedUppercase")));
    return;
  }

  // Contains a lowercase letter
  if (!/[a-z]/.test(value)) {
    callback(new Error(t("changePassword.passwordNeedLowercase")));
    return;
  }

  // Contains a digit
  if (!/[0-9]/.test(value)) {
    callback(new Error(t("changePassword.passwordNeedNumber")));
    return;
  }

  // Contains a special character
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(value)) {
    callback(new Error(t("changePassword.passwordNeedSpecial")));
    return;
  }

  callback();
};

// Form validation rules
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
      validator: (rule: any, value: string, callback: any) => {
        if (value === passwordForm.oldPassword) {
          callback(new Error(t("changePassword.passwordSame")));
        } else {
          // When the new password changes, re-validate the confirm password if it has already been entered
          if (passwordForm.confirmPassword !== "") {
            passwordFormRef.value.validateField("confirmPassword");
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

// Reset the form
const resetForm = () => {
  passwordForm.oldPassword = "";
  passwordForm.newPassword = "";
  passwordForm.confirmPassword = "";
  passwordFormRef.value.resetFields();
};

// Submit the form
const submitForm = async () => {
  if (!passwordFormRef.value) return;

  await passwordFormRef.value.validate(async (valid: boolean, fields: any) => {
    if (valid) {
      try {
        // Prepare the API request payload - using FormData format
        const formData = new FormData();
        formData.append("password", passwordForm.oldPassword);
        formData.append("new_password", passwordForm.newPassword);
        // Call the change-password endpoint
        const response = await changePassword(formData);

        if (response.code === 200) {
          ElMessage.success(t("changePassword.passwordChangeSuccess"));
          const UserStore = userStore();
          UserStore.FedLogOut().finally(() => {
            // Tutorial hand-off (TW-D15): a completed password change is the only
            // natural anchor for triggering the tutorial. sessionStorage is written
            // after FedLogOut's .clear(), so the new write survives until the tab closes.
            try {
              sessionStorage.setItem("tutorial_pending", "1");
            } catch (err) {
              console.warn("sessionStorage unavailable for tutorial hand-off", err);
            }
            router.replace("/login");
          });
        } else {
          ElMessage.error(
            response.message || t("changePassword.passwordChangeFailed")
          );
        }
      } catch (error: any) {
        console.error("Failed to change password:", error);
        ElMessage.warning(
          error.response.data.message || t("changePassword.passwordChangeRetry")
        );
      }
    } else {
      console.log("Form validation failed", fields);
      ElMessage.warning(t("changePassword.formValidationFailed"));
      return false;
    }
  });
};

// On page load, fetch the current logged-in user's info
onMounted(() => {
  // Read the current logged-in user's info from the user store
  const UserStore = userStore();
  if (UserStore.name) {
    passwordForm.username = UserStore.name;
  }
  // Note: the user ID and code must be obtained elsewhere, or entered manually by the user
  // Adjust this according to the actual business requirements
});
</script>

<style scoped lang="scss">
.change-password-page {
  height: 100vh;
  width: 100%;
  display: flex;
  flex-direction: column;
  background-color: #f5f7fa;
}

.page-header {
  background-color: #fff;
  height: 60px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
  position: relative;

  .back-button {
    position: absolute;
    left: 20px;
    z-index: 10;
  }

  .page-title {
    width: 100%;
    text-align: center;
    font-size: 20px;
    font-weight: 600;
    color: #409eff;
    margin: 0;
  }
}

.change-password-container {
  flex: 1;
  padding: 20px;
  display: flex;
  justify-content: center;
  align-items: flex-start;

  .form-card {
    background: #fff;
    border-radius: 4px;
    box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
    width: 500px;
    padding: 30px;
    margin-top: 50px;

    .title {
      text-align: center;
      margin-bottom: 30px;
      color: #303133;
    }
  }
}
/* Dark mode adaptation */
.theme-dark .change-password-page {
  background-color: var(--color-background);
}

.theme-dark .page-header {
  background-color: var(--color-background-card);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.theme-dark .page-title {
  color: var(--el-color-primary);
}

.theme-dark .change-password-container .form-card {
  background: var(--color-background-card);
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.3);
}

.theme-dark .form-card .title {
  color: var(--el-text-color-primary);
}

/* Element Plus form style adaptation in dark mode */
.theme-dark :deep(.el-form-item__label) {
  color: var(--el-text-color-primary);
}

/* Let inputs use Element Plus's default dark theme styling, without setting a separate background color */
.theme-dark :deep(.el-input__inner) {
  color: var(--el-text-color-primary);
}

.theme-dark :deep(.el-input__inner::placeholder) {
  color: var(--el-text-color-placeholder);
}

/* Button styling in dark mode */
.theme-dark :deep(.el-button) {
  background-color: #f5f5f5;
  border-color: #dcdcdc;
  color: #333;
}

.theme-dark :deep(.el-button:hover) {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}

.theme-dark :deep(.el-button--primary) {
  background-color: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: #fff;
}

.theme-dark :deep(.el-button--primary:hover) {
  background-color: var(--el-color-primary-light-3);
  border-color: var(--el-color-primary-light-3);
  color: #fff;
}
.theme-dark .el-input :deep(.el-input__inner) {
  background: #ffffff !important;
  color: #333 !important;
}

.theme-dark .reset-btn {
  color: #303133;
}
.theme-dark .reset-btn:hover {
  color: #409eff;
}
</style>
