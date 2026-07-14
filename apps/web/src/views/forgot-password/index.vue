<template>
  <PhyAuthLayout>
    <template #lang>
      <LangSwitch />
    </template>
    <template #brand>
      <PhyAuthBrand :title="$t('chat.appTitle')" />
    </template>

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
  </PhyAuthLayout>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useRoute } from "vue-router";
import { onMounted } from "vue";
import { redirectIfAuthed } from "@/utils/auth-redirect";
import { WarningFilled } from "@element-plus/icons-vue";
import LangSwitch from "@/components/LangSwitch.vue";
import { PhyAuthBrand, PhyAuthLayout } from "@/components/shell";

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
.forgot-password-title {
  margin: 0 0 20px;
  font-size: 1.35rem;
  font-weight: 600;
}

.notice-container {
  text-align: center;

  .notice-icon {
    margin-bottom: 20px;
  }

  .notice-title {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0 0 16px;
    color: var(--phy-color-text);
  }

  .notice-message {
    font-size: 13px;
    color: var(--phy-color-text-secondary);
    margin-bottom: 30px;
    line-height: 1.5;
  }
}

.submit-button {
  width: 100%;
  margin-top: 8px;
}
</style>
