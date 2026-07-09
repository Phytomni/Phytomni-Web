<template>
  <div class="forgot-password-container">
    <div class="forgot-password-left">
      <div class="logo-container">
        <div class="logo" style="width: 40px; height: 40px"></div>
      </div>
      <div class="slogan">
        <!-- A slogan for the forgot-password page can be added here -->
      </div>
    </div>
    <div class="forgot-password-right">
      <div class="lang-switch">
        <LangSwitch />
      </div>
      <div class="forgot-password-form">
        <h2 class="forgot-password-title">{{ $t("forgotPassword.title") }}</h2>

        <div class="notice-container">
          <el-icon class="notice-icon" color="#e6a23c" :size="64">
            <WarningFilled />
          </el-icon>
          <h3 class="notice-title">
            {{ $t("forgotPassword.unavailableTitle") }}
          </h3>
          <p class="notice-message">
            {{ $t("forgotPassword.unavailableMessage") }}
          </p>
          <el-button type="primary" class="submit-button" @click="goToLogin">
            {{ $t("forgotPassword.backToLogin") }}
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useRoute } from "vue-router";
import { onMounted } from "vue";
import { redirectIfAuthed } from "@/utils/auth-redirect";
import { WarningFilled } from "@element-plus/icons-vue";
import LangSwitch from "@/components/LangSwitch.vue";

const router = useRouter();
const route = useRoute();
onMounted(() => {
  redirectIfAuthed(route, router);
});

const goToLogin = () => {
  router.push("/login");
};
</script>

<style lang="scss" scoped>
.forgot-password-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
}

.forgot-password-left {
  width: 100%;
  background: #fff;
  display: flex;
  flex-direction: column;
  padding: 120px 60px;
  color: var(--phy-color-text);
  position: relative;
}

.logo-container {
  display: flex;
  align-items: center;
  margin-bottom: 80px;

  .logo {
    width: 50px;
    height: 50px;
    margin-right: 15px;
  }
}

.forgot-password-right {
  width: 60%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #fff;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);

  .lang-switch {
    position: absolute;
    top: 20px;
    right: 20px;

    :deep(.lang-dropdown-link) {
      color: var(--phy-color-text-secondary);
      font-size: 14px;

      &:hover {
        color: var(--phy-color-primary);
      }
    }
  }
}

.forgot-password-form {
  width: 75%;
  max-width: 450px;
}

.forgot-password-title {
  font-size: 42px;
  font-weight: 600;
  margin-bottom: 15px;
  text-align: center;
  color: #333;
}

.notice-container {
  text-align: center;
  padding: 40px 0;

  .notice-icon {
    margin-bottom: 20px;
  }

  .notice-title {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 16px;
    color: #333;
  }

  .notice-message {
    font-size: 16px;
    color: #666;
    margin-bottom: 30px;
    line-height: 1.5;
  }
}

.submit-button {
  width: 100%;
  padding: 12px 0;
  font-size: 16px;
  background: var(--phy-color-primary);
  height: 50px;
  color: #fff;
  border-color: var(--phy-color-primary);

  &:hover {
    background: var(--phy-color-primary-hover);
    border-color: var(--phy-color-primary-hover);
  }
}
</style>
