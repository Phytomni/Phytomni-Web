<template>
  <PiiWatermark>
    <PhyWorkspaceShell class="user-list-workspace" data-scroll-root="workspace">
      <template #header>
        <PhyPageHeader :title="$t('menu.userList')">
          <template #actions>
            <el-button type="primary" @click="handleAdd">
              <el-icon><Plus /></el-icon>{{ $t("user.add") }}
            </el-button>
          </template>
        </PhyPageHeader>
      </template>

      <PhyTableFrame>
        <el-table
          :data="tableData"
          border
          stripe
          v-loading="loading"
          class="user-table"
          table-layout="auto"
          header-row-class-name="table-header-row"
          header-cell-class-name="table-header-cell"
        >
          <el-table-column
            type="index"
            :label="$t('common.index')"
            width="80"
            align="center"
          />
          <el-table-column
            prop="email"
            :label="$t('user.username')"
            min-width="220"
            align="center"
          />
          <el-table-column
            prop="description"
            :label="$t('user.role')"
            min-width="130"
            align="center"
          />
          <el-table-column
            prop="phone"
            :label="$t('user.phone')"
            min-width="140"
            align="center"
          >
            <template #default="scope">
              {{ scope.row.phone || "-" }}
            </template>
          </el-table-column>
          <el-table-column
            prop="organization"
            :label="$t('user.organization')"
            min-width="180"
            align="center"
          >
            <template #default="scope">
              {{ scope.row.organization || "-" }}
            </template>
          </el-table-column>
          <el-table-column
            prop="position"
            :label="$t('user.position')"
            min-width="160"
            align="center"
          >
            <template #default="scope">
              {{ scope.row.position || "-" }}
            </template>
          </el-table-column>
          <el-table-column
            prop="last_login_at"
            :label="$t('user.lastLoginAt')"
            align="center"
            width="180"
          >
            <template #default="scope">
              {{
                scope.row.last_login_at
                  ? scope.row.last_login_at.replace("T", " ").slice(0, 19)
                  : $t("user.notLoggedIn")
              }}
            </template>
          </el-table-column>
          <el-table-column
            prop="chat_limit"
            :label="$t('user.chatLimit')"
            align="center"
            width="120"
          >
            <template #default="scope">
              {{
                scope.row.code === "guest"
                  ? scope.row.chat_limit ?? "-"
                  : $t("user.unlimited")
              }}
            </template>
          </el-table-column>
          <el-table-column
            :label="$t('common.operation')"
            width="250"
            align="center"
          >
            <template #default="scope">
              <el-space>
                <el-button
                  size="small"
                  type="primary"
                  @click="handleView(scope.row)"
                >
                  {{ $t("common.view") }}
                </el-button>
                <el-button
                  size="small"
                  type="success"
                  @click="handleEdit(scope.row)"
                >
                  {{ $t("common.edit") }}
                </el-button>
                <el-button
                  v-if="scope.row.locked_until"
                  size="small"
                  type="warning"
                  @click="handleUnlock(scope.row)"
                >
                  <el-icon><Unlock /></el-icon>
                  {{ $t("user.unlock") }}
                </el-button>
              </el-space>
            </template>
          </el-table-column>
        </el-table>

        <template #pagination>
          <el-pagination
            class="user-pagination"
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 30, 50]"
            layout="total, sizes, prev, pager, next"
            :total="total"
            @size-change="handleSizeChange"
            @current-change="handleCurrentChange"
          />
        </template>
      </PhyTableFrame>

      <!-- User edit dialog -->
      <el-dialog
        v-model="dialogVisible"
        :title="dialogType === 'add' ? $t('user.add') : $t('user.edit')"
        width="500px"
        :close-on-click-modal="false"
        @closed="resetForm"
      >
        <el-form
          ref="userFormRef"
          :model="userForm"
          :rules="formRules"
          label-width="85px"
          autocomplete="off"
        >
          <el-form-item :label="$t('user.username')" prop="email">
            <el-input
              v-model="userForm.email"
              autocomplete="new-email"
              :disabled="dialogType === 'edit'"
            />
          </el-form-item>
          <el-form-item
            :label="$t('user.password')"
            prop="password"
            :required="dialogType === 'add'"
          >
            <el-input
              v-model="userForm.password"
              type="password"
              autocomplete="new-password"
              show-password
              :placeholder="
                dialogType === 'edit' ? $t('user.passwordEditPlaceholder') : ''
              "
            />
          </el-form-item>
          <el-form-item :label="$t('user.role')" prop="code">
            <el-select
              v-model="userForm.code"
              :placeholder="$t('user.roleSelect')"
              style="width: 100%"
            >
              <el-option label="super_admin" value="super_admin" />
              <el-option label="admin" value="admin" />
              <el-option label="user" value="user" />
              <el-option label="vip_user" value="vip_user" />
              <el-option label="guest" value="guest" />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('user.phone')">
            <el-input
              v-model="userForm.phone"
              :placeholder="$t('user.phonePlaceholder')"
            />
          </el-form-item>
          <el-form-item :label="$t('user.organization')">
            <el-input
              v-model="userForm.organization"
              :placeholder="$t('user.organizationPlaceholder')"
            />
          </el-form-item>
          <el-form-item :label="$t('user.position')">
            <el-input
              v-model="userForm.position"
              :placeholder="$t('user.positionPlaceholder')"
            />
          </el-form-item>
          <el-form-item
            v-if="userForm.code === 'guest'"
            :label="$t('user.chatLimit')"
            prop="chat_limit"
          >
            <el-input-number
              v-model="userForm.chat_limit"
              :min="0"
              :placeholder="$t('user.chatLimitPlaceholder')"
              style="width: 100%"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <span class="dialog-footer">
            <el-space>
              <el-button @click="closeDialog">{{
                $t("common.cancel")
              }}</el-button>
              <el-button type="primary" @click="handleSubmit">{{
                $t("common.confirm")
              }}</el-button>
            </el-space>
          </span>
        </template>
      </el-dialog>

      <!-- User view dialog -->
      <el-dialog
        v-model="viewDialogVisible"
        :title="$t('user.detail')"
        width="500px"
      >
        <div class="view-info" v-if="currentUser">
          <div class="info-item">
            <span class="label">{{ $t("user.username") }}：</span>
            <span class="value">{{ currentUser.email }}</span>
          </div>
          <div class="info-item">
            <span class="label">{{ $t("user.role") }}：</span>
            <span class="value">{{
              getRoleName(currentUser.description || currentUser.code)
            }}</span>
          </div>
          <div class="info-item">
            <span class="label">{{ $t("user.phone") }}：</span>
            <span class="value">{{ currentUser.phone || "-" }}</span>
          </div>
          <div class="info-item">
            <span class="label">{{ $t("user.organization") }}：</span>
            <span class="value">{{ currentUser.organization || "-" }}</span>
          </div>
          <div class="info-item">
            <span class="label">{{ $t("user.position") }}：</span>
            <span class="value">{{ currentUser.position || "-" }}</span>
          </div>
          <div class="info-item">
            <span class="label">{{ $t("user.lastLoginAt") }}：</span>
            <span class="value">{{
              currentUser.last_login_at || $t("user.notLoggedIn")
            }}</span>
          </div>
        </div>
        <template #footer>
          <span class="dialog-footer">
            <el-space>
              <el-button @click="viewDialogVisible = false">{{
                $t("common.close")
              }}</el-button>
            </el-space>
          </span>
        </template>
      </el-dialog>
    </PhyWorkspaceShell>
  </PiiWatermark>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { Plus, Unlock } from "@element-plus/icons-vue";
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormValidateCallback,
} from "element-plus";
import { getUserList, addUser, changePermission, unlockUser } from "@/api/auth";
import type { UserSummary } from "@/api/types";
import { useI18n } from "vue-i18n";
import PiiWatermark from "@/components/PiiWatermark.vue";
import {
  PhyPageHeader,
  PhyTableFrame,
  PhyWorkspaceShell,
} from "@/components/shell";

const { t } = useI18n();

type UserData = UserSummary;

// Table-related
const loading = ref(false);
const currentPage = ref(1);
const pageSize = ref(10);
const total = ref(0);
const tableData = ref<UserData[]>([]);

// Form-related
const dialogVisible = ref(false);
const viewDialogVisible = ref(false);
const dialogType = ref<"add" | "edit">("add");
const userFormRef = ref<FormInstance>();
const currentUser = ref<UserData | null>(null);

// Form data
const userForm = reactive({
  id: 0,
  email: "",
  password: "",
  code: "",
  phone: "",
  organization: "",
  position: "",
  chat_limit: null as number | null,
});

// Password strength validation function - checks the password meets complexity requirements
const validatePasswordStrength = (
  rule: unknown,
  value: unknown,
  callback: (error?: string | Error) => void
) => {
  void rule;
  const password = typeof value === "string" ? value : "";

  // In edit mode, skip validation when the password is empty (means keep current password)
  if (dialogType.value === "edit" && !password) {
    callback();
    return;
  }

  // In add mode, prompt that the password is required when empty
  if (dialogType.value === "add" && !password) {
    callback(new Error(t("user.validation.passwordRequired")));
    return;
  }

  // At least 8 characters
  if (password.length < 8) {
    callback(new Error(t("user.validation.passwordMinLength8")));
    return;
  }

  // At most 16 characters
  if (password.length > 16) {
    callback(new Error(t("user.validation.passwordMaxLength16")));
    return;
  }

  // Must contain an uppercase letter
  if (!/[A-Z]/.test(password)) {
    callback(new Error(t("user.validation.passwordNeedUppercase")));
    return;
  }

  // Must contain a lowercase letter
  if (!/[a-z]/.test(password)) {
    callback(new Error(t("user.validation.passwordNeedLowercase")));
    return;
  }

  // Must contain a digit
  if (!/[0-9]/.test(password)) {
    callback(new Error(t("user.validation.passwordNeedNumber")));
    return;
  }

  // Must contain a special character
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
    callback(new Error(t("user.validation.passwordNeedSpecial")));
    return;
  }

  callback();
};

// Form validation rules
const formRules = reactive({
  email: [
    {
      required: true,
      message: t("user.validation.emailRequired"),
      trigger: "blur",
    },
    {
      type: "email" as const,
      message: t("user.validation.emailFormat"),
      trigger: "blur",
    },
  ],
  password: [
    {
      validator: validatePasswordStrength,
      trigger: "blur",
    },
  ],
  code: [
    {
      required: true,
      message: t("user.validation.roleRequired"),
      trigger: "change",
    },
  ],
});

// Get the role name
const getRoleName = (code: string): string => {
  const codeMap: Record<string, string> = {
    super_admin: "super_admin",
    admin: "admin",
    user: "user",
    vip_user: "vip_user",
  };
  return codeMap[code] || code;
};

// Method to fetch data
const fetchData = async () => {
  loading.value = true;
  try {
    const res = await getUserList({
      current: currentPage.value,
      size: pageSize.value,
    });

    if (res.code === 200) {
      tableData.value = res.data.user_list || [];
      total.value = res.data.total || 0;
    }
  } finally {
    loading.value = false;
  }
};

const refreshData = async () => {
  try {
    await fetchData();
  } catch {
    ElMessage.error(t("common.refreshFailedRetry"));
  }
};

// Pagination methods
const handleSizeChange = async (size: number) => {
  pageSize.value = size;
  await refreshData();
};

const handleCurrentChange = async (page: number) => {
  currentPage.value = page;
  await refreshData();
};

// Add a user
const handleAdd = () => {
  dialogType.value = "add";
  userForm.id = 0;
  userForm.email = "";
  userForm.password = "";
  userForm.code = "";
  userForm.phone = "";
  userForm.organization = "";
  userForm.position = "";
  userForm.chat_limit = null;

  dialogVisible.value = true;
};

// Edit a user
const handleEdit = (row: UserData) => {
  dialogType.value = "edit";

  userForm.id = row.id;
  userForm.email = row.email;
  userForm.code = row.code;
  userForm.password = "";
  userForm.phone = row.phone || "";
  userForm.organization = row.organization || "";
  userForm.position = row.position || "";
  userForm.chat_limit = row.chat_limit ?? null;

  dialogVisible.value = true;
};

// View a user
const handleView = (row: UserData) => {
  currentUser.value = row;
  viewDialogVisible.value = true;
};

// Unlock a user
const handleUnlock = async (row: UserData) => {
  try {
    await ElMessageBox.confirm(
      t("user.unlockConfirmMessage", { email: row.email }),
      t("user.unlockConfirmTitle"),
      {
        confirmButtonText: t("common.confirm"),
        cancelButtonText: t("common.cancel"),
        type: "warning",
      }
    );
  } catch {
    // User cancelled the operation
    return;
  }

  try {
    const res = await unlockUser(row.id);
    if (res.code === 200) {
      ElMessage.success(t("user.unlockSuccess"));
      await refreshData();
    } else {
      ElMessage.error(res.message || t("user.unlockFailed"));
    }
  } catch (error: unknown) {
    console.error("Failed to unlock user:", error);
    ElMessage.error(
      (error instanceof Error ? error.message : undefined) ||
        t("user.unlockFailed")
    );
  }
};

// Close the dialog
const closeDialog = () => {
  resetForm();
  dialogVisible.value = false;
};

// Reset the form
const resetForm = () => {
  userForm.id = 0;
  userForm.email = "";
  userForm.password = "";
  userForm.code = "";
  userForm.phone = "";
  userForm.organization = "";
  userForm.position = "";
  userForm.chat_limit = null;
  // Clear the form validation state
  if (userFormRef.value) {
    userFormRef.value.clearValidate();
  }
};

// Submit the form
const handleSubmit = async () => {
  if (!userFormRef.value) return;

  const form = userFormRef.value;
  if (!form) return;

  const submitForm: FormValidateCallback = async (valid, fields) => {
    if (valid) {
      try {
        if (dialogType.value === "add") {
          // Add user - uses the POST /api/v1/users endpoint, FormData format
          const formData = new FormData();
          formData.append("email", userForm.email);
          formData.append("password", userForm.password);
          formData.append("code", userForm.code);
          formData.append("phone", userForm.phone);
          formData.append("organization", userForm.organization);
          formData.append("position", userForm.position);
          // For guest users, append the chat_limit parameter
          if (userForm.code === "guest" && userForm.chat_limit !== null) {
            formData.append("chat_limit", userForm.chat_limit.toString());
          }

          const res = await addUser(formData);
          if (res.code === 200) {
            ElMessage.success(t("common.userAddedSuccess"));
            currentPage.value = 1;
            pageSize.value = 10;
            await refreshData();
            closeDialog();
          } else {
            ElMessage.error(res.message || t("user.addFailed"));
          }
        } else {
          // Edit user - uses the PUT /api/v1/users/:id/permissions endpoint, FormData format
          const formData = new FormData();
          formData.append("id", userForm.id.toString());
          formData.append("code", userForm.code);
          // If the password is not empty, change the password
          if (userForm.password) {
            formData.append("password", userForm.password);
          }
          // Append phone, organization, and position
          formData.append("phone", userForm.phone);
          formData.append("organization", userForm.organization);
          formData.append("position", userForm.position);
          // For guest users, append the chat_limit parameter
          if (userForm.code === "guest" && userForm.chat_limit !== null) {
            formData.append("chat_limit", userForm.chat_limit.toString());
          }

          const res = await changePermission(formData);
          if (res.code === 200) {
            ElMessage.success(t("common.userUpdatedSuccess"));
            currentPage.value = 1;
            pageSize.value = 10;
            await refreshData();
            closeDialog();
          } else {
            ElMessage.error(res.message || t("user.editFailed"));
          }
        }
      } catch (error: unknown) {
        console.error("Operation failed:", error);
        const message = error instanceof Error ? error.message : undefined;
        ElMessage.error(
          message ||
            (dialogType.value === "add"
              ? t("user.addFailed")
              : t("user.editFailed"))
        );
      }
    } else {
      console.log("Form validation failed", fields);
      ElMessage.warning(t("user.validation.formValidationFailed"));
    }
  };

  await form.validate(submitForm);
};

// Fetch data when the page loads
onMounted(() => {
  refreshData().catch(() => undefined);
});
</script>

<style scoped lang="scss">
.user-list-workspace {
  :deep(.el-watermark) {
    height: 100%;
  }

  :deep(.user-table) {
    min-width: 1420px;
  }

  :deep(.user-pagination) {
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 8px;
  }

  :deep(.el-pagination__jump) {
    display: none;
  }

  :deep(.phy-table-frame__pagination) {
    min-width: 0;
  }

  @container (max-width: 720px) {
    :deep(.phy-table-frame__pagination) {
      justify-content: flex-start;
    }
  }
}

.view-info {
  .info-item {
    display: flex;
    margin-bottom: 15px;

    .label {
      width: 100px;
      flex: 0 0 auto;
      padding-right: 12px;
      color: var(--phy-color-text-secondary);
      text-align: right;
    }

    .value {
      min-width: 0;
      flex: 1;
      color: var(--phy-color-text);
      overflow-wrap: anywhere;
    }
  }
}

/* Table header styles */
:deep(.table-header-row) {
  background-color: var(--el-color-primary) !important;
}

:deep(.table-header-cell) {
  background-color: var(--el-color-primary) !important;
  color: white !important;
  font-weight: bold !important;
}
:deep(.el-input__wrapper) {
  background-color: transparent !important;
}
:deep(.el-select__wrapper) {
  background-color: transparent !important;
}
</style>
