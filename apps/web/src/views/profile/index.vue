<template>
  <div class="profile-container">
    <div class="profile-content">
      <div class="profile-header">
        <h2>{{ $t("profile.title") }}</h2>
        <p>{{ $t("profile.description") }}</p>
      </div>

      <div class="profile-sections">
        <!-- Basic info -->
        <div class="profile-section">
          <div class="section-header">
            <h3>{{ $t("profile.basicInfo.title") }}</h3>
          </div>

          <div class="section-content">
            <el-form
              :model="basicInfoForm"
              disabled
              label-width="120px"
              class="profile-form"
            >
              <el-form-item :label="$t('profile.basicInfo.username')">
                <el-input v-model="basicInfoForm.username" />
              </el-form-item>

              <el-form-item :label="$t('profile.basicInfo.email')">
                <el-input v-model="basicInfoForm.email" />
              </el-form-item>

              <el-form-item :label="$t('profile.basicInfo.phone')">
                <el-input v-model="basicInfoForm.phone" />
              </el-form-item>

              <el-form-item :label="$t('profile.basicInfo.organization')">
                <el-input v-model="basicInfoForm.organization" />
              </el-form-item>

              <el-form-item :label="$t('profile.basicInfo.position')">
                <el-input v-model="basicInfoForm.position" />
              </el-form-item>
            </el-form>
          </div>
        </div>

        <!-- Account security -->
        <div class="profile-section">
          <div class="section-header">
            <h3>{{ $t("profile.security.title") }}</h3>
          </div>

          <div class="section-content">
            <div class="security-items">
              <div class="security-item">
                <div class="security-info">
                  <el-icon class="security-icon"><Lock /></el-icon>
                  <div class="security-text">
                    <h4>{{ $t("profile.security.password") }}</h4>
                    <p>{{ $t("profile.security.passwordDescription") }}</p>
                  </div>
                </div>
                <el-button type="primary" size="small" @click="changePassword">
                  {{ $t("profile.security.changePassword") }}
                </el-button>
              </div>

              <div class="security-item">
                <div class="security-info">
                  <el-icon class="security-icon"><User /></el-icon>
                  <div class="security-text">
                    <h4>{{ $t("profile.security.permission") }}</h4>
                    <p>{{ $t("profile.security.permissionDescription") }}</p>
                  </div>
                </div>
                <el-tag :type="getPermissionTagType(UserStore.permission)">
                  {{ UserStore.permission || "user" }}
                </el-tag>
              </div>
            </div>
          </div>
        </div>

        <!-- Usage statistics -->
        <div class="profile-section">
          <div class="section-header">
            <h3>{{ $t("profile.usage.title") }}</h3>
          </div>

          <div class="section-content">
            <div class="usage-stats">
              <div class="usage-item">
                <div class="usage-number">{{ usageStats.totalChats }}</div>
                <div class="usage-label">
                  {{ $t("profile.usage.totalChats") }}
                </div>
              </div>

              <div class="usage-item">
                <div class="usage-number">{{ usageStats.lastLogin }}</div>
                <div class="usage-label">
                  {{ $t("profile.usage.lastLogin") }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Change password dialog -->
    <el-dialog
      v-model="passwordDialogVisible"
      :title="$t('profile.security.changePassword')"
      width="500px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <el-form
        :model="passwordForm"
        :rules="passwordRules"
        ref="passwordFormRef"
        label-width="120px"
      >
        <el-form-item
          :label="$t('profile.security.oldPassword')"
          prop="oldPassword"
        >
          <el-input
            v-model="passwordForm.oldPassword"
            type="password"
            show-password
            :placeholder="$t('profile.security.oldPasswordPlaceholder')"
          />
        </el-form-item>

        <el-form-item
          :label="$t('profile.security.newPassword')"
          prop="newPassword"
        >
          <el-input
            v-model="passwordForm.newPassword"
            type="password"
            show-password
            :placeholder="$t('profile.security.newPasswordPlaceholder')"
          />
        </el-form-item>

        <el-form-item
          :label="$t('profile.security.confirmPassword')"
          prop="confirmPassword"
        >
          <el-input
            v-model="passwordForm.confirmPassword"
            type="password"
            show-password
            :placeholder="$t('profile.security.confirmPasswordPlaceholder')"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="passwordDialogVisible = false">
            {{ $t("common.cancel") }}
          </el-button>
          <el-button type="primary" @click="handlePasswordChange">
            {{ $t("common.confirm") }}
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { userStore } from "@/stores";
import { Lock, User } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { getUserProfile, changePassword as apiChangePassword } from "@/api/auth";

const { t } = useI18n();
const router = useRouter();
const UserStore = userStore();

// Reactive data
const passwordDialogVisible = ref(false);

// Basic info form
const basicInfoForm = reactive({
  username: "",
  email: "",
  phone: "",
  organization: "",
  position: "",
});

// Password form
const passwordForm = reactive({
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
});

// Usage statistics
const usageStats = reactive({
  totalChats: 0,
  lastLogin: "--",
});

// Form reference
const passwordFormRef = ref();

// New-password strength validation function - checks the password meets complexity requirements
const validateNewPasswordStrength = (
  rule: any,
  value: string,
  callback: any
) => {
  if (!value) {
    callback(new Error(t("user.validation.passwordRequired")));
    return;
  }

  // At least 8 characters
  if (value.length < 8) {
    callback(new Error(t("user.validation.passwordMinLength8")));
    return;
  }

  // At most 16 characters
  if (value.length > 16) {
    callback(new Error(t("user.validation.passwordMaxLength16")));
    return;
  }

  // Must contain an uppercase letter
  if (!/[A-Z]/.test(value)) {
    callback(new Error(t("user.validation.passwordNeedUppercase")));
    return;
  }

  // Must contain a lowercase letter
  if (!/[a-z]/.test(value)) {
    callback(new Error(t("user.validation.passwordNeedLowercase")));
    return;
  }

  // Must contain a digit
  if (!/[0-9]/.test(value)) {
    callback(new Error(t("user.validation.passwordNeedNumber")));
    return;
  }

  // Must contain a special character
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(value)) {
    callback(new Error(t("user.validation.passwordNeedSpecial")));
    return;
  }

  callback();
};

// Password validation rules
const passwordRules = {
  oldPassword: [
    {
      required: true,
      message: () => t("profile.security.oldPasswordPlaceholder"),
      trigger: "blur",
    },
  ],
  newPassword: [
    {
      validator: validateNewPasswordStrength,
      trigger: "blur",
    },
  ],
  confirmPassword: [
    {
      required: true,
      message: () => t("changePassword.passwordMismatch"),
      trigger: "blur",
    },
    {
      validator: (
        rule: unknown,
        value: string,
        callback: (error?: Error) => void
      ) => {
        if (value !== passwordForm.newPassword) {
          callback(new Error(t("changePassword.passwordMismatch")));
        } else {
          callback();
        }
      },
      trigger: "blur",
    },
  ],
};

// Get the permission tag type
const getPermissionTagType = (permission: string) => {
  switch (permission) {
    case "admin":
      return "danger";
    case "vip_user":
      return "warning";
    default:
      return "info";
  }
};

// Change password
const changePassword = () => {
  passwordDialogVisible.value = true;
  // Reset the form
  passwordForm.oldPassword = "";
  passwordForm.newPassword = "";
  passwordForm.confirmPassword = "";
};

// Handle password change
const handlePasswordChange = async () => {
  if (!passwordFormRef.value) return;
  await passwordFormRef.value.validate(async (valid: boolean) => {
    if (!valid) return;
    try {
      const formData = new FormData();
      formData.append("password", passwordForm.oldPassword);
      formData.append("new_password", passwordForm.newPassword);
      const response = await apiChangePassword(formData);
      if (response.code === 200) {
        passwordDialogVisible.value = false;
        ElMessage.success(t("profile.passwordChangeSuccess"));
        // Password change succeeded -> force logout to align with /change-password route semantics
        // (prevents an old JWT from staying usable after the new password takes effect).
        await UserStore.FedLogOut().finally(() => router.replace("/login"));
      } else {
        ElMessage.error(
          response.message || t("profile.passwordChangeFailed")
        );
      }
    } catch (error: any) {
      console.error("Failed to change password:", error);
      ElMessage.warning(
        error?.response?.data?.message || t("profile.passwordChangeFailed")
      );
    }
  });
};

// Format the date and time
const formatDateTime = (dateStr: string | null): string => {
  if (!dateStr) return "--";
  try {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return "--";
  }
};

// Fetch user info
const fetchUserInfo = async () => {
  try {
    const email = UserStore.name;
    if (!email) {
      ElMessage.warning(t("profile.userInfoNotFound"));
      return;
    }

    const res = await getUserProfile(email);
    if (res.code === 200 && res.data) {
      const data = res.data;

      // Populate basic info
      basicInfoForm.username = data.email || "";
      basicInfoForm.email = data.email || "";
      basicInfoForm.phone = data.phone || "";
      basicInfoForm.organization = data.organization || "";
      basicInfoForm.position = data.position || "";

      // Populate usage statistics
      usageStats.totalChats = data.dialogue_count || 0;
      usageStats.lastLogin = formatDateTime(data.last_login_at);
    } else {
      ElMessage.error(res.message || t("profile.fetchUserInfoFailed"));
    }
  } catch (error) {
    console.error("Failed to fetch user info:", error);
    ElMessage.error(t("profile.fetchUserInfoError"));
  }
};

// Fetch data when the component mounts
onMounted(() => {
  fetchUserInfo();
});
</script>

<style lang="scss" scoped>
.profile-container {
  padding: 24px;
  background-color: #f5f7fa;
  min-height: 100vh;
}

.profile-content {
  max-width: 800px;
  margin: 0 auto;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.profile-header {
  padding: 32px 32px 24px;
  border-bottom: 1px solid #ebeef5;
  text-align: center;

  h2 {
    margin: 0 0 12px 0;
    font-size: 24px;
    font-weight: 600;
    color: #303133;
  }

  p {
    margin: 0;
    color: #909399;
    font-size: 14px;
    line-height: 1.6;
  }
}

.profile-sections {
  padding: 0;
}

.profile-section {
  border-bottom: 1px solid #ebeef5;

  &:last-child {
    border-bottom: none;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px 32px 16px;
    background-color: #fafafa;

    h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: #303133;
    }
  }

  .section-content {
    padding: 24px 32px 32px;
  }
}

.profile-form {
  .el-form-item {
    margin-bottom: 20px;
  }
}

.security-items {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.security-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background-color: #fafafa;

  .security-info {
    display: flex;
    align-items: center;
    gap: 16px;

    .security-icon {
      font-size: 24px;
      color: #409eff;
    }

    .security-text {
      h4 {
        margin: 0 0 4px 0;
        font-size: 16px;
        font-weight: 500;
        color: #303133;
      }

      p {
        margin: 0;
        color: #909399;
        font-size: 14px;
        line-height: 1.4;
      }
    }
  }
}

.usage-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 20px;
}

.usage-item {
  text-align: center;
  padding: 24px 16px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background-color: #fafafa;
  transition: all 0.3s ease;

  &:hover {
    border-color: #409eff;
    background-color: #f0f9ff;
  }

  .usage-number {
    font-size: 28px;
    font-weight: 600;
    color: #409eff;
    margin-bottom: 8px;
  }

  .usage-label {
    font-size: 14px;
    color: #606266;
    line-height: 1.4;
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

// Responsive design
@media (max-width: 768px) {
  .profile-container {
    padding: 16px;
  }

  .profile-content {
    max-width: 100%;
  }

  .profile-header {
    padding: 24px 20px 20px;

    h2 {
      font-size: 20px;
    }
  }

  .profile-section {
    .section-header {
      padding: 20px 20px 12px;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;

      h3 {
        font-size: 16px;
      }
    }

    .section-content {
      padding: 20px 20px 24px;
    }
  }

  .security-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
    text-align: left;

    .security-info {
      width: 100%;
    }
  }

  .usage-stats {
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }

  .usage-item {
    padding: 20px 12px;

    .usage-number {
      font-size: 24px;
    }

    .usage-label {
      font-size: 12px;
    }
  }
}

// Dark mode adaptation
.theme-dark .profile-container {
  background-color: var(--color-background);
}

.theme-dark .profile-content {
  background-color: var(--color-background-card);
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.3);
}

.theme-dark .profile-header {
  border-bottom-color: var(--color-border);

  h2 {
    color: var(--el-text-color-primary);
  }

  p {
    color: var(--el-text-color-secondary);
  }
}

.theme-dark .profile-section {
  border-bottom-color: var(--color-border);

  .section-header {
    background-color: var(--color-background);

    h3 {
      color: var(--el-text-color-primary);
    }
  }
}

.theme-dark .security-item {
  border-color: var(--color-border);
  background-color: var(--color-background);

  .security-info {
    .security-icon {
      color: var(--el-color-primary);
    }

    .security-text {
      h4 {
        color: var(--el-text-color-primary);
      }

      p {
        color: var(--el-text-color-secondary);
      }
    }
  }
}

.theme-dark .usage-item {
  border-color: var(--color-border);
  background-color: var(--color-background);

  &:hover {
    border-color: var(--el-color-primary);
    background-color: var(--color-background-card);
  }

  .usage-number {
    color: var(--el-color-primary);
  }

  .usage-label {
    color: var(--el-text-color-secondary);
  }
}

// Dialog style adaptation in dark mode
.theme-dark :deep(.el-dialog) {
  background-color: var(--color-background-card);
  border: 1px solid var(--color-border);
}

.theme-dark :deep(.el-dialog__title) {
  color: var(--el-text-color-primary);
}

.theme-dark :deep(.el-dialog__body) {
  color: var(--el-text-color-primary);
}

// Input style adaptation in dark mode
.theme-dark :deep(.el-input__wrapper) {
  background-color: var(--color-background);
  border-color: var(--color-border);
}

.theme-dark :deep(.el-form-item__label) {
  color: var(--el-text-color-primary);
}
</style>
