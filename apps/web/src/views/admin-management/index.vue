<template>
  <PiiWatermark>
  <div class="admin-management-container">
    <!-- Top operation bar -->
    <div class="operation-bar">
      <div class="no-add-notice">
        <el-button type="primary" disabled>
        </el-button>
      </div>
    </div>

    <!-- User table -->
    <div class="table-container">
      <div class="table-title">{{ $t("user.listTitle") }}</div>
      <el-table
        :data="tableData"
        border
        stripe
        v-loading="loading"
        style="width: 100%"
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
          align="center"
        />
        <el-table-column
          prop="description"
          :label="$t('user.role')"
          align="center"
        />
        <el-table-column
          :label="$t('common.operation')"
          width="180"
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
            </el-space>
          </template>
        </el-table-column>
      </el-table>

      <!-- Pagination -->
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 30, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </div>

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
          :prop="dialogType === 'add' ? 'password' : ''"
          :required="dialogType === 'add'"
        >
          <el-input
            v-model="userForm.password"
            type="password"
            autocomplete="new-password"
            show-password
            :placeholder="dialogType === 'edit' ? $t('user.passwordEditPlaceholder') : ''"
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
          </el-select>
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
          <span class="value">{{ getRoleName(currentUser.description) }}</span>
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
  </div>
  </PiiWatermark>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { Plus } from "@element-plus/icons-vue";
import PiiWatermark from "@/components/PiiWatermark.vue";
import { ElMessage } from "element-plus";
import { getUserList, addUser, changePermission } from "@/api/auth";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

// User data interface
interface UserData {
  id: number;
  email: string;
  code: string;
  description: string;
  password: string;
  createTime: string;
  lastLogin: string;
}

// Table-related state
const loading = ref(false);
const currentPage = ref(1);
const pageSize = ref(10);
const total = ref(0);
const tableData = ref<UserData[]>([]);

// Form-related state
const dialogVisible = ref(false);
const viewDialogVisible = ref(false);
const dialogType = ref<"add" | "edit">("add");
const userFormRef = ref();
const currentUser = ref<UserData | null>(null);

// Form data
const userForm = reactive({
  id: 0,
  email: "",
  password: "",
  code: "",
});

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
      required: dialogType.value === "add",
      message: t("user.validation.passwordRequired"),
      trigger: "blur",
    },
    {
      min: 8,
      max: 16,
      message: t("user.validation.passwordLength"),
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

// Get the role display name
const getRoleName = (code: string): string => {
  const codeMap: Record<string, string> = {
    super_admin: "super_admin",
    admin: "admin",
    user: "Regular user",
    vip_user: "VIP user",
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

// Pagination methods
const handleSizeChange = (size: number) => {
  pageSize.value = size;
  fetchData();
};

const handleCurrentChange = (page: number) => {
  currentPage.value = page;
  fetchData();
};

// Add a user
const handleAdd = () => {
  dialogType.value = "add";
  userForm.id = 0;
  userForm.email = "";
  userForm.password = "";
  userForm.code = "";

  dialogVisible.value = true;
};

// Edit a user
const handleEdit = (row: UserData) => {
  dialogType.value = "edit";

  userForm.id = row.id;
  userForm.email = row.email;
  userForm.code = row.code;
  userForm.password = row.password;

  dialogVisible.value = true;
};

// View a user
const handleView = (row: UserData) => {
  currentUser.value = row;
  viewDialogVisible.value = true;
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
  // Clear the form validation state
  if (userFormRef.value) {
    userFormRef.value.clearValidate();
  }
};

// Submit the form
const handleSubmit = async () => {
  if (!userFormRef.value) return;

  await userFormRef.value.validate(async (valid: any, fields: any) => {
    if (valid) {
      try {
        if (dialogType.value === "add") {
          // Add a user - via POST /api/v1/users, FormData format
          const formData = new FormData();
          formData.append("email", userForm.email);
          formData.append("password", userForm.password);
          formData.append("code", userForm.code);

          const res = await addUser(formData);
          if (res.code === 200) {
            ElMessage.success(t("common.userAddedSuccess"));
            currentPage.value = 1;
            pageSize.value = 10;
            fetchData();
            closeDialog();
          } else {
            ElMessage.error(res.message || t("user.addFailed"));
          }
        } else {
          // Edit a user - via PUT /api/v1/users/:id/permissions, FormData format
          const formData = new FormData();
          formData.append("id", userForm.id.toString());
          formData.append("code", userForm.code);
          // If the password is non-empty, update the password
          if (userForm.password) {
            formData.append("password", userForm.password);
          }

          const res = await changePermission(formData);
          if (res.code === 200) {
            ElMessage.success(t("common.userUpdatedSuccess"));
            currentPage.value = 1;
            pageSize.value = 10;
            fetchData();
            closeDialog();
          } else {
            ElMessage.error(res.message || t("user.editFailed"));
          }
        }
      } catch (error: any) {
        console.error("Operation failed:", error);
        ElMessage.error(
          error.message ||
            (dialogType.value === "add" ? t("user.addFailed") : t("user.editFailed"))
        );
      }
    } else {
      console.log("Form validation failed", fields);
    }
  });
};

// Fetch data on page load
onMounted(() => {
  fetchData();
});
</script>

<style scoped lang="scss">
.admin-management-container {
  height: auto;
  min-height: 100%;
  padding: 20px;

  .operation-bar {
    margin-bottom: 20px;
    display: flex;
    justify-content: flex-end;

    .no-add-notice {
      display: flex;
      align-items: center;
      gap: 12px;

      .notice-text {
        color: #f56c6c;
        font-size: 14px;
        font-weight: 500;
      }
    }
  }

  .table-container {
    margin-bottom: 20px;
    padding: 20px;
    border-radius: 4px;
    box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);

    .table-title {
      font-size: 18px;
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
    }

    .table-subtitle {
      font-size: 14px;
      color: #f56c6c;
      margin-bottom: 20px;
    }

    .el-table {
      width: 100%;
    }
  }

  .pagination-container {
    margin-top: 20px;
    display: flex;
    justify-content: flex-end;
  }

  .view-info {
    .info-item {
      margin-bottom: 15px;
      display: flex;

      .label {
        width: 100px;
        color: #606266;
        text-align: right;
        padding-right: 12px;
      }

      .value {
        flex: 1;
        color: #303133;
      }
    }
  }
}

/* Table header styling */
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
