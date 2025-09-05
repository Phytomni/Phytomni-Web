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
            <el-button 
              type="primary" 
              size="small" 
              @click="editBasicInfo"
              :disabled="editingBasicInfo"
            >
              {{ editingBasicInfo ? $t('common.save') : $t('common.edit') }}
            </el-button>
          </div>
          
          <div class="section-content">
            <el-form 
              :model="basicInfoForm" 
              :disabled="!editingBasicInfo"
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
                <div class="usage-number">{{ usageStats.totalFiles }}</div>
                <div class="usage-label">{{ $t('profile.usage.totalFiles') }}</div>
              </div>
              
              <div class="usage-item">
                <div class="usage-number">{{ usageStats.storageUsed }}</div>
                <div class="usage-label">{{ $t('profile.usage.storageUsed') }}</div>
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
  Edit,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

const { t } = useI18n();
const router = useRouter();
const UserStore = userStore();

// 响应式数据
const editingBasicInfo = ref(false);
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
  totalFiles: 0,
  storageUsed: '0 MB',
  lastLogin: '--',
});

// 表单引用
const passwordFormRef = ref();

// 密码验证规则
const passwordRules = {
  oldPassword: [
    { required: true, message: '请输入旧密码', trigger: 'blur' }
  ],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于6位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码', trigger: 'blur' },
    {
      validator: (rule: any, value: string, callback: Function) => {
        if (value !== passwordForm.newPassword) {
          callback(new Error('两次输入的密码不一致'));
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

// 编辑基本信息
const editBasicInfo = async () => {
  if (editingBasicInfo.value) {
    // 保存信息
    try {
      // 这里应该调用实际的API接口
      await new Promise(resolve => setTimeout(resolve, 1000));
      editingBasicInfo.value = false;
      ElMessage.success('保存成功');
    } catch (error) {
      console.error('保存失败:', error);
      ElMessage.error('保存失败，请重试');
    }
  } else {
    // 开始编辑
    editingBasicInfo.value = true;
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

// 获取用户信息
const fetchUserInfo = async () => {
  try {
    // 这里应该调用实际的API接口
    // 暂时使用模拟数据
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 填充基本信息
    basicInfoForm.username = UserStore.name || '未设置';
    basicInfoForm.email = 'user@example.com';
    basicInfoForm.phone = '138****8888';
    basicInfoForm.organization = '中国农业科学院';
    basicInfoForm.position = '研究员';
    
    // 填充使用统计
    usageStats.totalChats = 156;
    usageStats.totalFiles = 23;
    usageStats.storageUsed = '45.2 MB';
    usageStats.lastLogin = '2024-01-15 10:30';
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
