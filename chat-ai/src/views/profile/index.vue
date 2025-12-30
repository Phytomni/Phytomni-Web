<template>
  <div class="profile-container">
    <div class="profile-content">
      <div class="profile-header">
        <h2>{{ $t('profile.title') }}</h2>
        <p>{{ $t('profile.description') }}</p>
      </div>

      <div class="profile-sections">
        <!-- 基本信息 -->
        <div class="profile-section">
          <div class="section-header">
            <h3>{{ $t('profile.basicInfo.title') }}</h3>
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

        <!-- 账户安全 -->
        <div class="profile-section">
          <div class="section-header">
            <h3>{{ $t('profile.security.title') }}</h3>
          </div>
          
          <div class="section-content">
            <div class="security-items">
              <div class="security-item">
                <div class="security-info">
                  <el-icon class="security-icon"><Lock /></el-icon>
                  <div class="security-text">
                    <h4>{{ $t('profile.security.password') }}</h4>
                    <p>{{ $t('profile.security.passwordDescription') }}</p>
                  </div>
                </div>
                <el-button 
                  type="primary" 
                  size="small" 
                  @click="changePassword"
                >
                  {{ $t('profile.security.changePassword') }}
                </el-button>
              </div>
              
              <div class="security-item">
                <div class="security-info">
                  <el-icon class="security-icon"><User /></el-icon>
                  <div class="security-text">
                    <h4>{{ $t('profile.security.permission') }}</h4>
                    <p>{{ $t('profile.security.permissionDescription') }}</p>
                  </div>
                </div>
                <el-tag :type="getPermissionTagType(userStore.permission)">
                  {{ userStore.permission || 'user' }}
                </el-tag>
              </div>
            </div>
          </div>
        </div>

        <!-- 使用统计 -->
        <div class="profile-section">
          <div class="section-header">
            <h3>{{ $t('profile.usage.title') }}</h3>
          </div>
          
          <div class="section-content">
            <div class="usage-stats">
              <div class="usage-item">
                <div class="usage-number">{{ usageStats.totalChats }}</div>
                <div class="usage-label">{{ $t('profile.usage.totalChats') }}</div>
              </div>

              <div class="usage-item">
                <div class="usage-number">{{ usageStats.lastLogin }}</div>
                <div class="usage-label">{{ $t('profile.usage.lastLogin') }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 修改密码对话框 -->
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
        <el-form-item :label="$t('profile.security.oldPassword')" prop="oldPassword">
          <el-input 
            v-model="passwordForm.oldPassword" 
            type="password" 
            show-password
            :placeholder="$t('profile.security.oldPasswordPlaceholder')"
          />
        </el-form-item>
        
        <el-form-item :label="$t('profile.security.newPassword')" prop="newPassword">
          <el-input 
            v-model="passwordForm.newPassword" 
            type="password" 
            show-password
            :placeholder="$t('profile.security.newPasswordPlaceholder')"
          />
        </el-form-item>
        
        <el-form-item :label="$t('profile.security.confirmPassword')" prop="confirmPassword">
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
            {{ $t('common.cancel') }}
          </el-button>
          <el-button type="primary" @click="handlePasswordChange">
            {{ $t('common.confirm') }}
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { userStore } from '@/stores';
import {
  Lock,
  User,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getUserProfile } from '@/api/auth';

const { t } = useI18n();
const router = useRouter();
const UserStore = userStore();

// 响应式数据
const passwordDialogVisible = ref(false);

// 基本信息表单
const basicInfoForm = reactive({
  username: '',
  email: '',
  phone: '',
  organization: '',
  position: '',
});

// 密码表单
const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});

// 使用统计
const usageStats = reactive({
  totalChats: 0,
  lastLogin: '--',
});

// 表单引用
const passwordFormRef = ref();

// 新密码强度验证函数 - 验证密码是否满足复杂度要求
const validateNewPasswordStrength = (rule: any, value: string, callback: any) => {
  if (!value) {
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

// 密码验证规则
const passwordRules = {
  oldPassword: [
    { required: true, message: () => t('profile.security.oldPasswordPlaceholder'), trigger: 'blur' }
  ],
  newPassword: [
    {
      validator: validateNewPasswordStrength,
      trigger: 'blur'
    }
  ],
  confirmPassword: [
    { required: true, message: () => t('user.validation.passwordMismatch'), trigger: 'blur' },
    {
      validator: (rule: any, value: string, callback: Function) => {
        if (value !== passwordForm.newPassword) {
          callback(new Error(t('user.validation.passwordMismatch')));
        } else {
          callback();
        }
      },
      trigger: 'blur'
    }
  ]
};

// 获取权限标签类型
const getPermissionTagType = (permission: string) => {
  switch (permission) {
    case 'admin':
      return 'danger';
    case 'vip_user':
      return 'warning';
    default:
      return 'info';
  }
};

// 修改密码
const changePassword = () => {
  passwordDialogVisible.value = true;
  // 重置表单
  passwordForm.oldPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirmPassword = '';
};

// 处理密码修改
const handlePasswordChange = async () => {
  if (!passwordFormRef.value) return;
  
  try {
    const valid = await passwordFormRef.value.validate();
    if (valid) {
      // 这里应该调用实际的API接口
      await new Promise(resolve => setTimeout(resolve, 1000));
      passwordDialogVisible.value = false;
      ElMessage.success('密码修改成功');
    }
  } catch (error) {
    console.error('密码修改失败:', error);
    ElMessage.error('密码修改失败，请重试');
  }
};

// 格式化日期时间
const formatDateTime = (dateStr: string | null): string => {
  if (!dateStr) return '--';
  try {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return '--';
  }
};

// 获取用户信息
const fetchUserInfo = async () => {
  try {
    const email = UserStore.name;
    if (!email) {
      ElMessage.warning('未获取到用户信息');
      return;
    }

    const res = await getUserProfile(email);
    if (res.code === 200 && res.data) {
      const data = res.data;

      // 填充基本信息
      basicInfoForm.username = data.email || '';
      basicInfoForm.email = data.email || '';
      basicInfoForm.phone = data.phone || '';
      basicInfoForm.organization = data.organization || '';
      basicInfoForm.position = data.position || '';

      // 填充使用统计
      usageStats.totalChats = data.dialogue_count || 0;
      usageStats.lastLogin = formatDateTime(data.last_login_at);
    } else {
      ElMessage.error(res.msg || '获取用户信息失败');
    }
  } catch (error) {
    console.error('获取用户信息失败:', error);
    ElMessage.error('获取用户信息失败');
  }
};

// 组件挂载时获取数据
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

// 响应式设计
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
</style>
