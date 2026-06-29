<template>
  <div class="gene-network-agent-container">
    <div class="chat-header">
      <div class="header-content">
        <el-button
          type="primary"
          :icon="ArrowLeft"
          @click="goBack"
          class="back-button"
        >
          返回
        </el-button>
        <div class="header-text">
          <h1>{{ $t("agents.geneNetwork.title") }}</h1>
          <p>{{ $t("agents.geneNetwork.subtitle") }}</p>
        </div>
      </div>
    </div>

    <div class="chat-messages">
      <!-- User question -->
      <div class="message user-message">
        <div class="message-content">
          <div class="message-text">
            Please help me to analysis the hormone regulatory network in the
            traits of TO:0000011
          </div>
        </div>
      </div>

      <!-- AI answer -->
      <div class="message ai-message">
        <div class="message-avatar">
          <el-avatar :size="36" :src="botAvatar" />
        </div>
        <div class="message-content">
          <div class="message-text">
            任务创建成功8ab4434b-772a-44f0-aaa5-fa163e7f84a3
            <div class="download-section">
              <el-button
                type="primary"
                :icon="Download"
                @click="downloadResults"
                :loading="isDownloading"
                class="download-button"
              >
                {{ isDownloading ? "正在下载..." : "下载分析结果" }}
              </el-button>
              <div v-if="isDownloading" class="download-progress">
                <p>正在下载分卷文件 {{ currentDownloadIndex + 1 }}/5</p>
                <p class="file-name">{{ currentDownloadFile }}</p>
              </div>
            </div>
            <div class="tip-text">{{ $t("common.Tip") }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { ArrowLeft, Download } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";

import { ref } from "vue";

const router = useRouter();
const goBack = () => {
  router.back();
};

const botAvatar =
  "/avatars/bot.svg";

// Download state management
const isDownloading = ref(false);
const currentDownloadIndex = ref(0);
const currentDownloadFile = ref("");

// Download analysis results - supports multi-volume download
const downloadResults = () => {
  const fileParts = [
    "network_results.zip.001",
    "network_results.zip.002",
    "network_results.zip.003",
    "network_results.zip.004",
    "network_results.zip.005",
  ];

  const basePath =
    "/static/downloads/5.Gene Netwrok Agent/3.NetwrokAgent/results/";

  // Start downloading
  isDownloading.value = true;
  currentDownloadIndex.value = 0;
  currentDownloadFile.value = fileParts[0];

  // Show download-start notice
  ElMessage({
    message: `Downloading ${fileParts.length} split file(s), please wait until all downloads finish`,
    type: "info",
    duration: 4000,
  });

  // Download each volume file in sequence
  fileParts.forEach((fileName, index) => {
    setTimeout(() => {
      try {
        // Update current download state
        currentDownloadIndex.value = index;
        currentDownloadFile.value = fileName;

        const link = document.createElement("a");
        link.href = basePath + fileName;
        link.download = fileName;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Last file finished downloading
        if (index === fileParts.length - 1) {
          setTimeout(() => {
            isDownloading.value = false;
            ElMessage({
              message: "All split files downloaded! Put them in the same directory and extract",
              type: "success",
              duration: 5000,
            });
          }, 1000);
        }
      } catch (error) {
        console.error(`Failed to download file ${fileName}:`, error);
        isDownloading.value = false;
        ElMessage({
          message: `Failed to download ${fileName}, please try again`,
          type: "error",
          duration: 3000,
        });
      }
    }, index * 1000); // Download files 1 second apart to avoid browser limits
  });
};
</script>

<style lang="scss" scoped>
.gene-network-agent-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
}

.chat-header {
  background: #fff;
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;

  .header-content {
    display: flex;
    align-items: center;
    gap: 16px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .back-button {
    flex-shrink: 0;
  }

  .header-text {
    flex: 1;
    text-align: center;

    h1 {
      margin: 0 0 8px 0;
      color: #333;
      font-size: 24px;
    }

    p {
      margin: 0;
      color: #666;
      font-size: 14px;
    }
  }
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  margin: 20px 0px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: var(--el-bg-color);
  box-shadow: 0 0 10px 0 rgb(218, 217, 217);
  border-radius: 10px;
}

.message {
  display: flex;
  margin-bottom: 16px;

  &.user-message {
    justify-content: flex-end;

    .message-content {
      background: #eff6ff;
      color: #333;
      border-radius: 18px 18px 4px 18px;
      max-width: 100%;
    }
  }

  &.ai-message {
    justify-content: flex-start;

    .message-avatar {
      flex-shrink: 0;
      align-self: flex-start;
      margin-right: 8px;
    }

    .message-content {
      background: white;
      color: #333;
      border-radius: 18px 18px 18px 4px;
      max-width: 85%;
      border: 1px solid #e0e0e0;
    }
  }
}

.message-content {
  padding: 12px 16px;
  word-wrap: break-word;

  .message-text {
    line-height: 1.5;
  }
}

.download-section {
  margin-top: 12px;

  .download-button {
    margin-top: 8px;
  }

  .download-progress {
    margin-top: 12px;
    padding: 12px;
    background-color: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 8px;

    p {
      margin: 4px 0;
      color: #0369a1;
      font-size: 14px;

      &.file-name {
        font-weight: 500;
        color: #0c4a6e;
      }
    }
  }
}

.tip-text {
  font-size: 12px;
  color: #909399;
  margin-top: 10px;
  width: 100%;
  text-align: right;
}
</style>
