<template>
  <div class="global-config-container">
    <div class="page-header">
      <h1>{{ $t("menu.globalConfig") }}</h1>
      <p class="page-description">{{ $t("globalConfig.description") }}</p>
    </div>

    <el-card class="config-card">
      <template #header>
        <div class="card-header">
          <span>{{ $t("globalConfig.systemSettings") }}</span>
        </div>
      </template>

      <el-form :model="configForm" label-width="200px" class="config-form">
        <!-- System basic settings -->
        <el-divider content-position="left">{{
          $t("globalConfig.basicSettings")
        }}</el-divider>

        <el-form-item :label="$t('globalConfig.systemName')">
          <el-input
            v-model="configForm.systemName"
            :placeholder="$t('globalConfig.systemNamePlaceholder')"
          />
        </el-form-item>

        <el-form-item :label="$t('globalConfig.maxFileSize')">
          <el-input-number
            v-model="configForm.maxFileSize"
            :min="1"
            :max="1000"
            :step="10"
            controls-position="right"
          />
          <span class="unit">MB</span>
        </el-form-item>

        <el-form-item :label="$t('globalConfig.sessionTimeout')">
          <el-input-number
            v-model="configForm.sessionTimeout"
            :min="30"
            :max="1440"
            :step="30"
            controls-position="right"
          />
          <span class="unit">{{ $t("globalConfig.minutes") }}</span>
        </el-form-item>

        <!-- Security policy settings -->
        <el-divider content-position="left">{{
          $t("globalConfig.securitySettings")
        }}</el-divider>

        <el-form-item :label="$t('globalConfig.passwordPolicy')">
          <el-checkbox-group v-model="configForm.passwordPolicy">
            <el-checkbox value="uppercase">{{
              $t("globalConfig.requireUppercase")
            }}</el-checkbox>
            <el-checkbox value="lowercase">{{
              $t("globalConfig.requireLowercase")
            }}</el-checkbox>
            <el-checkbox value="numbers">{{
              $t("globalConfig.requireNumbers")
            }}</el-checkbox>
            <el-checkbox value="symbols">{{
              $t("globalConfig.requireSymbols")
            }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>

        <el-form-item :label="$t('globalConfig.loginAttempts')">
          <el-input-number
            v-model="configForm.maxLoginAttempts"
            :min="3"
            :max="10"
            controls-position="right"
          />
          <span class="unit">{{ $t("globalConfig.attempts") }}</span>
        </el-form-item>

        <el-form-item :label="$t('globalConfig.ipWhitelist')">
          <el-input
            v-model="configForm.ipWhitelist"
            type="textarea"
            :rows="3"
            :placeholder="$t('globalConfig.ipWhitelistPlaceholder')"
          />
        </el-form-item>

        <!-- Feature settings -->
        <el-divider content-position="left">{{
          $t("globalConfig.featureSettings")
        }}</el-divider>

        <el-form-item :label="$t('globalConfig.enableRegistration')">
          <el-switch v-model="configForm.enableRegistration" />
        </el-form-item>

        <el-form-item :label="$t('globalConfig.enableFileUpload')">
          <el-switch v-model="configForm.enableFileUpload" />
        </el-form-item>

        <el-form-item :label="$t('globalConfig.enableChatHistory')">
          <el-switch v-model="configForm.enableChatHistory" />
        </el-form-item>

        <el-form-item :label="$t('globalConfig.maxChatHistory')">
          <el-input-number
            v-model="configForm.maxChatHistory"
            :min="10"
            :max="1000"
            :step="10"
            controls-position="right"
          />
          <span class="unit">{{ $t("globalConfig.records") }}</span>
        </el-form-item>

        <!-- Action buttons -->
        <el-form-item>
          <el-button type="primary" @click="handleSave" :loading="saving">
            {{ $t("common.save") }}
          </el-button>
          <el-button @click="handleReset">
            {{ $t("common.reset") }}
          </el-button>
          <el-button @click="handleTest" :loading="testing">
            {{ $t("globalConfig.testConfig") }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- Configuration history -->
    <el-card class="history-card">
      <template #header>
        <div class="card-header">
          <span>{{ $t("globalConfig.configHistory") }}</span>
        </div>
      </template>

      <el-table :data="configHistory" style="width: 100%">
        <el-table-column :label="$t('globalConfig.timestamp')" width="180">
          <template #default="{ row }">
            {{ formatDisplayDate(d, row.timestamp, "timestamp") }}
          </template>
        </el-table-column>
        <el-table-column
          prop="operator"
          :label="$t('globalConfig.operator')"
          width="120"
        />
        <el-table-column prop="changes" :label="$t('globalConfig.changes')" />
        <el-table-column :label="$t('common.operation')" width="120">
          <template #default="scope">
            <el-button type="text" @click="handleViewHistory(scope.row)">
              {{ $t("common.view") }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { formatDisplayDate } from "@/locales/format-display-date";

const { t, d } = useI18n();

// Configuration form data
const configForm = reactive({
  systemName: "Phytomni",
  maxFileSize: 10,
  sessionTimeout: 120,
  passwordPolicy: ["lowercase", "numbers"],
  maxLoginAttempts: 5,
  ipWhitelist: "",
  enableRegistration: true,
  enableFileUpload: true,
  enableChatHistory: true,
  maxChatHistory: 100,
});

// Configuration history data
const configHistory = ref([
  {
    timestamp: "2024-01-15T10:30:00",
    operator: "admin",
    changes: "Updated file upload size limit",
  },
  {
    timestamp: "2024-01-14T15:20:00",
    operator: "admin",
    changes: "Updated password policy config",
  },
]);

// State
const saving = ref(false);
const testing = ref(false);

// Save configuration
const handleSave = async () => {
  saving.value = true;
  try {
    // This should call an API to save the configuration
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate API call

    ElMessage.success(t("globalConfig.saveSuccess"));

    // Add to history records
    configHistory.value.unshift({
      timestamp: new Date().toISOString(),
      operator: "admin",
      changes: "Saved global policy config",
    });
  } catch (error) {
    ElMessage.error(t("globalConfig.saveFailed"));
  } finally {
    saving.value = false;
  }
};

// Reset configuration
const handleReset = async () => {
  try {
    await ElMessageBox.confirm(
      t("globalConfig.resetConfirm"),
      t("common.warning"),
      {
        confirmButtonText: t("common.confirm"),
        cancelButtonText: t("common.cancel"),
        type: "warning",
      }
    );

    // Reset to default values
    Object.assign(configForm, {
      systemName: "Phytomni",
      maxFileSize: 10,
      sessionTimeout: 120,
      passwordPolicy: ["lowercase", "numbers"],
      maxLoginAttempts: 5,
      ipWhitelist: "",
      enableRegistration: true,
      enableFileUpload: true,
      enableChatHistory: true,
      maxChatHistory: 100,
    });

    ElMessage.success(t("globalConfig.resetSuccess"));
  } catch {
    // User cancelled
  }
};

// Test configuration
const handleTest = () => {
  // The config-test endpoint is not wired to the backend yet. It previously used
  // setTimeout to simulate and always reported "test passed", which would mislead
  // users into thinking the config had passed backend validation; switched to an
  // explicit "feature unavailable" notice, to be restored once a real validation
  // endpoint lands.
  ElMessage.info(t("globalConfig.testUnavailable"));
};

// View history details
const handleViewHistory = (row: any) => {
  ElMessageBox.alert(
    t("globalConfig.historyDetailContent", {
      time: formatDisplayDate(d, row.timestamp, "timestamp"),
      operator: row.operator,
      changes: row.changes,
    }),
    t("globalConfig.historyDetail"),
    {
      confirmButtonText: t("common.confirm"),
    }
  );
};

// Load configuration on component mount
onMounted(() => {
  // This should call an API to load the current configuration
  console.log("Loading global policy configuration...");
});
</script>

<style scoped lang="scss">
.global-config-container {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;

  h1 {
    margin: 0 0 8px 0;
    color: #303133;
    font-size: 24px;
    font-weight: 600;
  }

  .page-description {
    margin: 0;
    color: #606266;
    font-size: 14px;
  }
}

.config-card,
.history-card {
  margin-bottom: 20px;

  .card-header {
    font-weight: 600;
    color: #303133;
  }
}

.config-form {
  .el-divider {
    margin: 24px 0 16px 0;
  }

  .unit {
    margin-left: 8px;
    color: #909399;
    font-size: 14px;
  }

  .el-form-item {
    margin-bottom: 20px;
  }
}

.history-card {
  .el-table {
    margin-top: 16px;
  }
}
</style>
