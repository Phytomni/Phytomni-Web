<!--
 * 组件注释
 * @Author: AI Assistant
 * @Date: 2024-05-09
 * @Description: 用户列表页面，包含用户表格、操作按钮和编辑弹窗
 * 既往不恋！当下不杂！！未来不迎！！！
-->
<template>
  <div class="user-list-container">
    <!-- 顶部操作栏 -->
    <div class="operation-bar">
      <el-button type="primary" @click="handleAdd">
        <el-icon><Plus /></el-icon>{{ $t('user.add') }}
      </el-button>
    </div>

    <!-- 用户表格 -->
    <div class="table-container">
      <el-table
        :data="tableData"
        border
        stripe
        v-loading="loading"
        style="width: 100%"
        header-row-class-name="table-header-row"
        header-cell-class-name="table-header-cell">
        <el-table-column
          type="index"
          :label="$t('common.index')"
          width="80"
          align="center" />
        <el-table-column
          prop="email"
          :label="$t('user.username')"
          align="center" />
        <el-table-column
          prop="description"
          :label="$t('user.role')"
          align="center" />
        <el-table-column
          prop="phone"
          :label="$t('user.phone')"
          align="center">
          <template #default="scope">
            {{ scope.row.phone || '-' }}
          </template>
        </el-table-column>
        <el-table-column
          prop="organization"
          :label="$t('user.organization')"
          align="center">
          <template #default="scope">
            {{ scope.row.organization || '-' }}
          </template>
        </el-table-column>
        <el-table-column
          prop="position"
          :label="$t('user.position')"
          align="center">
          <template #default="scope">
            {{ scope.row.position || '-' }}
          </template>
        </el-table-column>
        <el-table-column
          prop="last_login_at"
          :label="$t('user.lastLoginAt')"
          align="center"
          width="180">
          <template #default="scope">
            {{ scope.row.last_login_at ?  scope.row.last_login_at.replace('T', ' ').slice(0, 19)  : $t('user.notLoggedIn') }}
          </template>
        </el-table-column>
        <el-table-column
          prop="chat_limit"
          :label="$t('user.chatLimit')"
          align="center"
          width="120">
          <template #default="scope">
            {{ scope.row.code === 'guest' ? (scope.row.chat_limit ?? '-') : $t('user.unlimited') }}
          </template>
        </el-table-column>
        <el-table-column
          :label="$t('common.operation')"
          width="250"
          align="center">
          <template #default="scope">
            <el-space>
              <el-button
                size="small"
                type="primary"
                @click="handleView(scope.row)">
                {{ $t('common.view') }}
              </el-button>
              <el-button
                size="small"
                type="success"
                @click="handleEdit(scope.row)">
                {{ $t('common.edit') }}
              </el-button>
              <el-button
                v-if="scope.row.locked_until"
                size="small"
                type="warning"
                @click="handleUnlock(scope.row)">
                <el-icon><Unlock /></el-icon>
                {{ $t('user.unlock') }}
              </el-button>
            </el-space>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 30, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange" />
      </div>
    </div>

    <!-- 用户编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogType === 'add' ? $t('user.add') : $t('user.edit')"
      width="500px"
      :close-on-click-modal="false"
      @closed="resetForm">
      <el-form
        ref="userFormRef"
        :model="userForm"
        :rules="formRules"
        label-width="85px"
        autocomplete="off">
        <el-form-item :label="$t('user.username')" prop="email">
          <el-input
            v-model="userForm.email"
            autocomplete="new-email"
            :disabled="dialogType === 'edit'" />
        </el-form-item>
        <el-form-item
          :label="$t('user.password')"
          prop="password"
          :required="dialogType === 'add'">
          <el-input
            v-model="userForm.password"
            type="password"
            autocomplete="new-password"
            show-password
            :placeholder="dialogType === 'edit' ? '留空则不修改密码' : ''" />
        </el-form-item>
        <el-form-item :label="$t('user.role')" prop="code">
          <el-select
            v-model="userForm.code"
            :placeholder="$t('user.roleSelect')"
            style="width: 100%">
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
            :placeholder="$t('user.phonePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('user.organization')">
          <el-input
            v-model="userForm.organization"
            :placeholder="$t('user.organizationPlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('user.position')">
          <el-input
            v-model="userForm.position"
            :placeholder="$t('user.positionPlaceholder')" />
        </el-form-item>
        <el-form-item
          v-if="userForm.code === 'guest'"
          :label="$t('user.chatLimit')"
          prop="chat_limit">
          <el-input-number
            v-model="userForm.chat_limit"
            :min="0"
            :placeholder="$t('user.chatLimitPlaceholder')"
            style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-space>
            <el-button @click="closeDialog">{{
              $t('common.cancel')
            }}</el-button>
            <el-button type="primary" @click="handleSubmit">{{
              $t('common.confirm')
            }}</el-button>
          </el-space>
        </span>
      </template>
    </el-dialog>

    <!-- 用户查看弹窗 -->
    <el-dialog
      v-model="viewDialogVisible"
      :title="$t('user.detail')"
      width="500px">
      <div class="view-info" v-if="currentUser">
        <div class="info-item">
          <span class="label">{{ $t('user.username') }}：</span>
          <span class="value">{{ currentUser.email }}</span>
        </div>
        <div class="info-item">
          <span class="label">{{ $t('user.role') }}：</span>
          <span class="value">{{ getRoleName(currentUser.description) }}</span>
        </div>
        <div class="info-item">
          <span class="label">{{ $t('user.phone') }}：</span>
          <span class="value">{{ currentUser.phone || '-' }}</span>
        </div>
        <div class="info-item">
          <span class="label">{{ $t('user.organization') }}：</span>
          <span class="value">{{ currentUser.organization || '-' }}</span>
        </div>
        <div class="info-item">
          <span class="label">{{ $t('user.position') }}：</span>
          <span class="value">{{ currentUser.position || '-' }}</span>
        </div>
        <div class="info-item">
          <span class="label">{{ $t('user.lastLoginAt') }}：</span>
          <span class="value">{{ currentUser.last_login_at || $t('user.notLoggedIn') }}</span>
        </div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-space>
            <el-button @click="viewDialogVisible = false">{{
              $t('common.close')
            }}</el-button>
          </el-space>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, onMounted } from 'vue';
  import { Plus, Unlock } from '@element-plus/icons-vue';
  import { ElMessage, ElMessageBox } from 'element-plus';
  import { getUserList, addUser, changePermission, unlockUser } from '@/api/auth';
  import { useI18n } from 'vue-i18n';

  const { t } = useI18n();

  // 定义用户数据接口
  interface UserData {
    id: number;
    email: string;
    code: string;
    description: string;
    password: string;
    createTime: string;
    lastLogin: string;
    locked_until: string | null;
    last_login_at: string | null;
    phone: string;
    organization: string;
    position: string;
    chat_limit: number | null;
  }

  // 表格相关
  const loading = ref(false);
  const currentPage = ref(1);
  const pageSize = ref(10);
  const total = ref(0);
  const tableData = ref<UserData[]>([]);

  // 表单相关
  const dialogVisible = ref(false);
  const viewDialogVisible = ref(false);
  const dialogType = ref<'add' | 'edit'>('add');
  const userFormRef = ref();
  const currentUser = ref<UserData | null>(null);

  // 表单数据
  const userForm = reactive({
    id: 0,
    email: '',
    password: '',
    code: '',
    phone: '',
    organization: '',
    position: '',
    chat_limit: null as number | null,
  });

  // 密码强度验证函数 - 验证密码是否满足复杂度要求
  const validatePasswordStrength = (rule: any, value: string, callback: any) => {
    // 编辑模式下，密码为空时不验证（表示不修改密码）
    if (dialogType.value === 'edit' && !value) {
      callback();
      return;
    }

    // 新增模式下，密码为空时提示必填
    if (dialogType.value === 'add' && !value) {
      callback(new Error(t('user.validation.passwordRequired')));
      return;
    }

    // 至少8位
    if (value.length < 8) {
      callback(new Error(t('user.validation.passwordMinLength8')));
      return;
    }

    // 最多16位
    if (value.length > 16) {
      callback(new Error(t('user.validation.passwordMaxLength16')));
      return;
    }

    // 包含大写字母
    if (!/[A-Z]/.test(value)) {
      callback(new Error(t('user.validation.passwordNeedUppercase')));
      return;
    }

    // 包含小写字母
    if (!/[a-z]/.test(value)) {
      callback(new Error(t('user.validation.passwordNeedLowercase')));
      return;
    }

    // 包含数字
    if (!/[0-9]/.test(value)) {
      callback(new Error(t('user.validation.passwordNeedNumber')));
      return;
    }

    // 包含特殊符号
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(value)) {
      callback(new Error(t('user.validation.passwordNeedSpecial')));
      return;
    }

    callback();
  };

  // 表单验证规则
  const formRules = reactive({
    email: [
      {
        required: true,
        message: t('user.validation.emailRequired'),
        trigger: 'blur',
      },
      {
        type: 'email' as const,
        message: t('user.validation.emailFormat'),
        trigger: 'blur',
      },
    ],
    password: [
      {
        validator: validatePasswordStrength,
        trigger: 'blur',
      },
    ],
    code: [
      {
        required: true,
        message: t('user.validation.roleRequired'),
        trigger: 'change',
      },
    ],
  });

  // 获取角色名称
  const getRoleName = (code: string): string => {
    const codeMap: Record<string, string> = {
      super_admin: 'super_admin',
      admin: 'admin',
      user: 'user',
      vip_user: 'vip_user',
    };
    return codeMap[code] || code;
  }

  // 获取数据的方法
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

  // 分页方法
  const handleSizeChange = (size: number) => {
    pageSize.value = size;
    fetchData();
  };

  const handleCurrentChange = (page: number) => {
    currentPage.value = page;
    fetchData();
  };

  // 新增用户
  const handleAdd = () => {
    dialogType.value = 'add';
    userForm.id = 0;
    userForm.email = '';
    userForm.password = '';
    userForm.code = '';
    userForm.phone = '';
    userForm.organization = '';
    userForm.position = '';
    userForm.chat_limit = null;

    dialogVisible.value = true;
  };

  // 编辑用户
  const handleEdit = (row: UserData) => {
    dialogType.value = 'edit';

    userForm.id = row.id;
    userForm.email = row.email;
    userForm.code = row.code;
    userForm.password = '';
    userForm.phone = row.phone || '';
    userForm.organization = row.organization || '';
    userForm.position = row.position || '';
    userForm.chat_limit = row.chat_limit ?? null;

    dialogVisible.value = true;
  };

  // 查看用户
  const handleView = (row: UserData) => {
    currentUser.value = row;
    viewDialogVisible.value = true;
  };

  // 解锁用户
  const handleUnlock = (row: UserData) => {
    ElMessageBox.confirm(
      t('user.unlockConfirmMessage', { email: row.email }),
      t('user.unlockConfirmTitle'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      }
    )
      .then(async () => {
        try {
          const res = await unlockUser(row.id);
          if (res.code === 200) {
            ElMessage.success(t('user.unlockSuccess'));
            fetchData();
          } else {
            ElMessage.error(res.msg || t('user.unlockFailed'));
          }
        } catch (error: any) {
          console.error('解锁用户失败:', error);
          ElMessage.error(error.message || t('user.unlockFailed'));
        }
      })
      .catch(() => {
        // 用户取消操作
      });
  };

  // 关闭弹窗
  const closeDialog = () => {
    resetForm();
    dialogVisible.value = false;
  };

  // 重置表单
  const resetForm = () => {
    userForm.id = 0;
    userForm.email = '';
    userForm.password = '';
    userForm.code = '';
    userForm.phone = '';
    userForm.organization = '';
    userForm.position = '';
    userForm.chat_limit = null;
    // 清除表单验证状态
    if (userFormRef.value) {
      userFormRef.value.clearValidate();
    }
  };

  // 提交表单
  const handleSubmit = async () => {
    if (!userFormRef.value) return;

    await userFormRef.value.validate(async (valid: any, fields: any) => {
      if (valid) {
        try {
          if (dialogType.value === 'add') {
            // 新增用户 - 使用 /v1/register 接口，FormData格式
            const formData = new FormData();
            formData.append('email', userForm.email);
            formData.append('password', userForm.password);
            formData.append('code', userForm.code);
            formData.append('phone', userForm.phone);
            formData.append('organization', userForm.organization);
            formData.append('position', userForm.position);
            // 如果是 guest 用户，添加 chat_limit 参数
            if (userForm.code === 'guest' && userForm.chat_limit !== null) {
              formData.append('chat_limit', userForm.chat_limit.toString());
            }

            const res = await addUser(formData);
            if (res.code === 200) {
              ElMessage.success('用户添加成功');
              currentPage.value = 1;
              pageSize.value = 10;
              fetchData();
              closeDialog();
            } else {
              ElMessage.error(res.msg || '用户添加失败');
            }
          } else {
            // 编辑用户 - 使用 /v1/modify/permission 接口，FormData格式
            const formData = new FormData();
            formData.append('id', userForm.id.toString());
            formData.append('code', userForm.code);
            // 如果密码不为空，则修改密码
            if (userForm.password) {
              formData.append('password', userForm.password);
            }
            // 添加手机号、机构、职位
            formData.append('phone', userForm.phone);
            formData.append('organization', userForm.organization);
            formData.append('position', userForm.position);
            // 如果是 guest 用户，添加 chat_limit 参数
            if (userForm.code === 'guest' && userForm.chat_limit !== null) {
              formData.append('chat_limit', userForm.chat_limit.toString());
            }

            const res = await changePermission(formData);
            if (res.code === 200) {
              ElMessage.success('用户信息修改成功');
              currentPage.value = 1;
              pageSize.value = 10;
              fetchData();
              closeDialog();
            } else {
              ElMessage.error(res.msg || '用户信息修改失败');
            }
          }
        } catch (error: any) {
          console.error('操作失败:', error);
          ElMessage.error(
            error.message ||
              (dialogType.value === 'add' ? '用户添加失败' : '用户信息修改失败')
          );
        }
      } else {
        console.log('表单验证失败', fields);
        ElMessage.warning(t('user.validation.formValidationFailed'));
      }
    });
  };

  // 页面加载时获取数据
  onMounted(() => {
    fetchData();
  });
</script>

<style scoped lang="scss">
  .user-list-container {
    height: auto;
    min-height: 100%;
    padding: 20px;

    .operation-bar {
      margin-bottom: 20px;
      display: flex;
      justify-content: flex-end;
    }

    .table-container {
      margin-bottom: 20px;
      padding: 20px;
      border-radius: 4px;
      box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);

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

  /* 表头样式 */
  :deep(.table-header-row) {
    background-color: #409eff !important;
  }

  :deep(.table-header-cell) {
    background-color: #409eff !important;
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
