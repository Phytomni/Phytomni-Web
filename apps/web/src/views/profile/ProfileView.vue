<template>
  <PhyWorkspaceShell class="profile-workspace">
    <template #header>
      <PhyPageHeader>
        <template #title>
          <div class="profile-page-title">
            <h1>{{ $t("profile.title") }}</h1>
            <p>{{ $t("profile.description") }}</p>
          </div>
        </template>
      </PhyPageHeader>
    </template>

    <PhyAsyncState :state="asyncState">
      <template #loading>
        <PhySkeleton shape="line" :count="7" />
      </template>

      <template #error>
        <PhyErrorState
          :title="$t('profile.fetchUserInfoError')"
          :retry-label="$t('common.retry')"
          @retry="fetchUserInfo"
        />
      </template>

      <template #ready>
        <section
          class="profile-identity"
          :aria-label="$t('profile.basicInfo.title')"
        >
          <div class="profile-identity__avatar" aria-hidden="true">
            {{ basicInfoForm.email.slice(0, 1).toUpperCase() }}
          </div>
          <div class="profile-identity__summary">
            <h2 class="profile-identity__email">{{ basicInfoForm.email }}</h2>
            <p>
              {{
                basicInfoForm.organization ||
                $t("profile.basicInfo.organization")
              }}
            </p>
          </div>
          <el-tag :type="getPermissionTagType(UserStore.permission)">
            {{ UserStore.permission || "user" }}
          </el-tag>
        </section>

        <section
          class="profile-section"
          :aria-labelledby="'profile-details-title'"
        >
          <div class="profile-section__heading">
            <h2 id="profile-details-title">
              {{ $t("profile.basicInfo.title") }}
            </h2>
          </div>
          <el-form
            :model="basicInfoForm"
            class="profile-readonly-list"
            label-position="top"
          >
            <el-form-item
              v-for="field in profileFields"
              :key="field.key"
              :label="$t(field.label)"
              class="profile-readonly-field"
            >
              <el-input v-model="basicInfoForm[field.key]" disabled />
            </el-form-item>
          </el-form>
        </section>

        <section
          class="profile-section"
          :aria-labelledby="'profile-usage-title'"
        >
          <div class="profile-section__heading">
            <h2 id="profile-usage-title">{{ $t("profile.usage.title") }}</h2>
          </div>
          <dl class="profile-usage">
            <div class="profile-usage__item">
              <dt>{{ $t("profile.usage.totalChats") }}</dt>
              <dd>{{ usageStats.totalChats }}</dd>
            </div>
            <div class="profile-usage__item">
              <dt>{{ $t("profile.usage.lastLogin") }}</dt>
              <dd class="profile-last-login">
                {{ formatDisplayDate(d, usageStats.lastLoginAt, "datetime") }}
              </dd>
            </div>
          </dl>
        </section>

        <section
          class="profile-section profile-account"
          :aria-labelledby="'profile-security-title'"
        >
          <div class="profile-section__heading">
            <div>
              <h2 id="profile-security-title">
                {{ $t("profile.security.title") }}
              </h2>
              <p>{{ $t("profile.security.passwordDescription") }}</p>
            </div>
            <el-icon class="profile-account__icon"><Lock /></el-icon>
          </div>
          <div class="profile-account__action">
            <div>
              <h3>{{ $t("profile.security.password") }}</h3>
              <p class="profile-account__consequence">
                {{ $t("profile.passwordChangeSuccess") }} ·
                {{ $t("user.logout") }}
              </p>
            </div>
            <el-button
              class="profile-password-action"
              type="primary"
              @click="changePassword"
            >
              {{ $t("profile.security.changePassword") }}
            </el-button>
          </div>
        </section>
      </template>
    </PhyAsyncState>
  </PhyWorkspaceShell>

  <el-dialog
    v-model="passwordDialogVisible"
    :title="$t('profile.security.changePassword')"
    class="profile-password-dialog"
    width="min(640px, calc(100vw - 24px))"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :teleported="true"
  >
    <el-form
      ref="passwordFormRef"
      :model="passwordForm"
      :rules="passwordRules"
      class="profile-password-form"
      label-position="top"
    >
      <el-form-item
        :label="$t('profile.security.oldPassword')"
        prop="oldPassword"
      >
        <el-input
          v-model="passwordForm.oldPassword"
          type="password"
          show-password
          :disabled="submitting"
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
          :disabled="submitting"
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
          :disabled="submitting"
          :placeholder="$t('profile.security.confirmPasswordPlaceholder')"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <span class="dialog-footer">
        <el-button
          :disabled="submitting"
          @click="passwordDialogVisible = false"
        >
          {{ $t("common.cancel") }}
        </el-button>
        <el-button
          class="profile-password-submit"
          type="primary"
          :loading="submitting"
          :disabled="submitting"
          @click="handlePasswordChange"
        >
          {{ $t("common.confirm") }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Lock } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { PhyPageHeader, PhyWorkspaceShell } from "@/components/shell";
import { PhyAsyncState, PhyErrorState, PhySkeleton } from "@/components/state";
import {
  getUserProfile,
  changePassword as apiChangePassword,
} from "@/api/auth";
import { formatDisplayDate } from "@/locales/format-display-date";
import { userStore } from "@/stores";

type AsyncState = "loading" | "error" | "ready";
type ProfileFieldKey =
  "username" | "email" | "phone" | "organization" | "position";

const { t, d } = useI18n();
const router = useRouter();
const UserStore = userStore();
const loading = ref(false);
const requestFailed = ref(false);
const submitting = ref(false);
const passwordDialogVisible = ref(false);

const basicInfoForm = reactive({
  username: "",
  email: "",
  phone: "",
  organization: "",
  position: "",
});

const profileFields: Array<{ key: ProfileFieldKey; label: string }> = [
  { key: "username", label: "profile.basicInfo.username" },
  { key: "email", label: "profile.basicInfo.email" },
  { key: "phone", label: "profile.basicInfo.phone" },
  { key: "organization", label: "profile.basicInfo.organization" },
  { key: "position", label: "profile.basicInfo.position" },
];

const passwordForm = reactive({
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
});

const usageStats = reactive({
  totalChats: 0,
  lastLoginAt: null as string | null,
});

const passwordFormRef = ref<{
  validate: (callback: (valid: boolean) => void) => Promise<boolean>;
}>();

const asyncState = computed<AsyncState>(() => {
  if (loading.value) return "loading";
  if (requestFailed.value) return "error";
  return "ready";
});

const validateNewPasswordStrength = (
  _rule: unknown,
  value: string,
  callback: (error?: Error) => void
) => {
  if (!value) return callback(new Error(t("user.validation.passwordRequired")));
  if (value.length < 8)
    return callback(new Error(t("user.validation.passwordMinLength8")));
  if (value.length > 16)
    return callback(new Error(t("user.validation.passwordMaxLength16")));
  if (!/[A-Z]/.test(value))
    return callback(new Error(t("user.validation.passwordNeedUppercase")));
  if (!/[a-z]/.test(value))
    return callback(new Error(t("user.validation.passwordNeedLowercase")));
  if (!/[0-9]/.test(value))
    return callback(new Error(t("user.validation.passwordNeedNumber")));
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(value)) {
    return callback(new Error(t("user.validation.passwordNeedSpecial")));
  }
  callback();
};

const passwordRules = {
  oldPassword: [
    {
      required: true,
      message: () => t("profile.security.oldPasswordPlaceholder"),
      trigger: "blur",
    },
  ],
  newPassword: [{ validator: validateNewPasswordStrength, trigger: "blur" }],
  confirmPassword: [
    {
      required: true,
      message: () => t("changePassword.passwordMismatch"),
      trigger: "blur",
    },
    {
      validator: (
        _rule: unknown,
        value: string,
        callback: (error?: Error) => void
      ) => {
        callback(
          value === passwordForm.newPassword
            ? undefined
            : new Error(t("changePassword.passwordMismatch"))
        );
      },
      trigger: "blur",
    },
  ],
};

const getPermissionTagType = (permission: string) => {
  if (permission === "admin") return "danger";
  if (permission === "vip_user") return "warning";
  return "info";
};

const changePassword = () => {
  passwordDialogVisible.value = true;
  passwordForm.oldPassword = "";
  passwordForm.newPassword = "";
  passwordForm.confirmPassword = "";
};

const handlePasswordChange = async () => {
  if (!passwordFormRef.value || submitting.value) return;
  submitting.value = true;

  try {
    let valid = false;
    await passwordFormRef.value.validate((result) => {
      valid = result;
    });
    if (!valid) {
      submitting.value = false;
      return;
    }

    try {
      const formData = new FormData();
      formData.append("password", passwordForm.oldPassword);
      formData.append("new_password", passwordForm.newPassword);
      const response = await apiChangePassword(formData);
      if (response.code === 200) {
        passwordDialogVisible.value = false;
        ElMessage.success(t("profile.passwordChangeSuccess"));
        try {
          await UserStore.FedLogOut();
        } finally {
          await router.replace("/login").catch(() => undefined);
        }
      } else {
        ElMessage.error(t("profile.passwordChangeFailed"));
      }
    } catch {
      ElMessage.warning(t("profile.passwordChangeFailed"));
    } finally {
      submitting.value = false;
    }
  } catch {
    submitting.value = false;
    ElMessage.warning(t("profile.passwordChangeFailed"));
  }
};

const fetchUserInfo = async () => {
  loading.value = true;
  requestFailed.value = false;
  try {
    const email = UserStore.name;
    if (!email) {
      requestFailed.value = true;
      ElMessage.warning(t("profile.userInfoNotFound"));
      return;
    }

    const res = await getUserProfile(email);
    if (res.code !== 200 || !res.data) {
      requestFailed.value = true;
      ElMessage.error(t("profile.fetchUserInfoFailed"));
      return;
    }

    const data = res.data;
    basicInfoForm.username = data.email || "";
    basicInfoForm.email = data.email || "";
    basicInfoForm.phone = data.phone || "";
    basicInfoForm.organization = data.organization || "";
    basicInfoForm.position = data.position || "";
    usageStats.totalChats = data.dialogue_count || 0;
    usageStats.lastLoginAt = data.last_login_at ?? null;
  } catch {
    requestFailed.value = true;
    ElMessage.error(t("profile.fetchUserInfoError"));
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchUserInfo().catch(() => undefined);
});
</script>

<style lang="scss" scoped>
.profile-workspace {
  min-width: 0;
}

.profile-page-title p,
.profile-section__heading p,
.profile-identity__summary p,
.profile-account__consequence {
  margin: var(--phy-space-4) 0 0;
  color: var(--phy-color-text-secondary);
  line-height: 1.5;
}

.profile-identity,
.profile-section {
  border-bottom: 1px solid var(--phy-color-border);
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: var(--phy-space-16);
  min-width: 0;
  padding: 0 0 var(--phy-space-24);
}

.profile-identity__avatar {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: var(--phy-color-primary-soft);
  color: var(--phy-color-primary);
  font-weight: 700;
}

.profile-identity__summary {
  min-width: 0;
  flex: 1;
}

.profile-identity__email,
.profile-section__heading h2,
.profile-account h3 {
  margin: 0;
  color: var(--phy-color-text);
}

.profile-identity__email {
  overflow-wrap: anywhere;
  font-size: 1.125rem;
}

.profile-section {
  padding: var(--phy-space-24) 0;
}

.profile-section__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--phy-space-16);
  margin-bottom: var(--phy-space-16);
}

.profile-section__heading h2 {
  font-size: 1rem;
}

.profile-readonly-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--phy-space-24);
  min-width: 0;
}

.profile-readonly-field {
  margin-bottom: var(--phy-space-8);
}

.profile-usage {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--phy-space-16);
  margin: 0;
}

.profile-usage__item {
  display: flex;
  flex-direction: column;
  gap: var(--phy-space-4);
}

.profile-usage__item dt {
  color: var(--phy-color-text-secondary);
}

.profile-usage__item dd {
  margin: 0;
  color: var(--phy-color-text);
  font-size: 1.125rem;
  font-weight: 600;
}

.profile-account {
  border-bottom: 0;
}

.profile-account__icon {
  color: var(--phy-color-primary);
  font-size: 1.25rem;
}

.profile-account__action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--phy-space-16);
  min-width: 0;
}

.profile-account__consequence {
  font-size: 0.875rem;
}

.dialog-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--phy-space-8);
}

.profile-password-dialog {
  max-height: min(720px, calc(100dvh - 32px));
  overflow: auto;
}

.profile-password-form :deep(.el-input__wrapper) {
  min-height: 48px;
}

@media (max-width: 599px) {
  .profile-identity,
  .profile-account__action {
    align-items: flex-start;
  }

  .profile-identity {
    flex-wrap: wrap;
  }

  .profile-identity .el-tag {
    margin-left: 64px;
  }

  .profile-readonly-list,
  .profile-usage {
    grid-template-columns: 1fr;
  }

  .profile-account__action {
    flex-direction: column;
  }

  .profile-password-action {
    width: 100%;
  }
}
</style>
