<!--
 * 组件注释
 * @Author: AI Assistant
 * @Date: 2024-05-09
 * @Description: 修改密码页面
 * 既往不恋！当下不杂！！未来不迎！！！
-->
<template>
  <div class="change-password-page">
    <div class="page-header">
      <div class="back-button">
        <el-button @click="goBack" icon="ArrowLeft" text>{{
          $t('common.back')
        }}</el-button>
      </div>
      <h1 class="page-title">{{ $t('app.title') }}</h1>
    </div>

    <div class="change-password-container">
      <div class="form-card">
        <h2 class="title">{{ $t('user.changePassword') }}</h2>

        <el-form
          ref="passwordFormRef"
          :model="passwordForm"
          :rules="formRules"
          label-width="180px"
          status-icon>

          <el-form-item :label="$t('user.username')" prop="username">
            <el-input
              v-model="passwordForm.username"
              :placeholder="$t('changePassword.usernamePlaceholder')"
              disabled
              :readonly="true" />
          </el-form-item>

          <el-form-item
            :label="$t('changePassword.oldPassword')"
            prop="oldPassword">
            <el-input
              v-model="passwordForm.oldPassword"
              type="password"
              show-password
              :placeholder="$t('changePassword.oldPasswordPlaceholder')" />
          </el-form-item>

          <el-form-item
            :label="$t('changePassword.newPassword')"
            prop="newPassword">
            <el-input
              v-model="passwordForm.newPassword"
              type="password"
              show-password
              :placeholder="$t('changePassword.newPasswordPlaceholder')" />
          </el-form-item>

          <el-form-item
            :label="$t('changePassword.confirmPassword')"
            prop="confirmPassword">
            <el-input
              v-model="passwordForm.confirmPassword"
              type="password"
              show-password
              :placeholder="$t('changePassword.confirmPasswordPlaceholder')" />
          </el-form-item>

          <el-form-item>
            <el-space>
              <el-button @click="resetForm">{{ $t('common.reset') }}</el-button>
              <el-button type="primary" @click="submitForm">{{
                $t('changePassword.confirm')
              }}</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, onMounted } from 'vue';
  import { ElMessage } from 'element-plus';
  import { useRouter } from 'vue-router';
  import { userStore } from '@/stores';
  import { useI18n } from 'vue-i18n';
  import { changePassword } from '@/api/auth';

  const { t } = useI18n();
  const router = useRouter();

  // 表单引用
  const passwordFormRef = ref();

  // 表单数据
  const passwordForm = reactive({
    id: '', // 用户ID
    code: '', // 用户代码/权限代码
    username: 'admin', // 默认用户名，实际应用中可从登录状态获取
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // 返回上一页
  const goBack = () => {
    router.back();
  };

  // 密码验证函数 - 验证确认密码是否与新密码一致
  const validateConfirmPassword = (rule: any, value: string, callback: any) => {
    if (value === '') {
      callback(new Error(t('changePassword.confirmPasswordRequired')));
    } else if (value !== passwordForm.newPassword) {
      callback(new Error(t('changePassword.passwordMismatch')));
    } else {
      callback();
    }
  };

  // 密码强度验证函数 - 验证新密码是否满足复杂度要求
  const validatePasswordStrength = (rule: any, value: string, callback: any) => {
    if (!value) {
      callback();
      return;
    }

    // 至少8位
    if (value.length < 8) {
      callback(new Error(t('changePassword.passwordMinLength8')));
      return;
    }

    // 包含大写字母
    if (!/[A-Z]/.test(value)) {
      callback(new Error(t('changePassword.passwordNeedUppercase')));
      return;
    }

    // 包含小写字母
    if (!/[a-z]/.test(value)) {
      callback(new Error(t('changePassword.passwordNeedLowercase')));
      return;
    }

    // 包含数字
    if (!/[0-9]/.test(value)) {
      callback(new Error(t('changePassword.passwordNeedNumber')));
      return;
    }

    // 包含特殊符号
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(value)) {
      callback(new Error(t('changePassword.passwordNeedSpecial')));
      return;
    }

    callback();
  };

  // 表单验证规则
  const formRules = reactive({
    username: [
      {
        required: true,
        message: t('changePassword.usernameRequired'),
        trigger: 'blur',
      },
    ],
    oldPassword: [
      {
        required: true,
        message: t('changePassword.oldPasswordRequired'),
        trigger: 'blur',
      },
      {
        min: 6,
        message: t('changePassword.passwordMinLength'),
        trigger: 'blur',
      },
    ],
    newPassword: [
      {
        required: true,
        message: t('changePassword.newPasswordRequired'),
        trigger: 'blur',
      },
      {
        validator: validatePasswordStrength,
        trigger: 'blur',
      },
      {
        validator: (rule: any, value: string, callback: any) => {
          if (value === passwordForm.oldPassword) {
            callback(new Error(t('changePassword.passwordSame')));
          } else {
            // 当新密码变化时，如果已经输入了确认密码，则重新验证确认密码
            if (passwordForm.confirmPassword !== '') {
              passwordFormRef.value.validateField('confirmPassword');
            }
            callback();
          }
        },
        trigger: 'blur',
      },
    ],
    confirmPassword: [
      {
        required: true,
        message: t('changePassword.confirmPasswordRequired'),
        trigger: 'blur',
      },
      { validator: validateConfirmPassword, trigger: 'blur' },
    ],
  });

  // 重置表单
  const resetForm = () => {
    passwordForm.oldPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirmPassword = '';
    passwordFormRef.value.resetFields();
  };

  // 提交表单
  const submitForm = async () => {
    if (!passwordFormRef.value) return;

    await passwordFormRef.value.validate(async (valid: boolean, fields: any) => {
      if (valid) {
        try {
          // 准备API请求数据 - 使用FormData格式
          const formData = new FormData();
          formData.append('password', passwordForm.oldPassword); 
          formData.append('new_password', passwordForm.newPassword); 
          // 调用修改密码接口
          const response = await changePassword(formData);
          
          if (response.code === 200) {
            ElMessage.success('密码修改成功');
            // 修改成功后退出登录
            const UserStore = userStore();
            UserStore.FedLogOut().then(() => router.replace('/login'));
          } else {
            ElMessage.error(response.message || '密码修改失败');
          }
        } catch (error: any) {
          console.error('修改密码失败:', error);
          ElMessage.warning(error.response.data.message || '密码修改失败，请稍后重试');
        }
      } else {
        console.log('表单验证失败', fields);
        ElMessage.warning(t('changePassword.formValidationFailed'));
        return false;
      }
    });
  };

  // 页面加载时，可以获取当前登录用户信息
  onMounted(() => {
    // 从用户存储中获取当前登录用户的信息
    const UserStore = userStore();
    if (UserStore.name) {
      passwordForm.username = UserStore.name;
    }
    // 注意：用户ID和代码需要从其他地方获取，或者让用户手动输入
    // 这里可以根据实际业务需求进行调整
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
</style>
