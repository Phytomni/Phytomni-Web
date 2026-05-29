<template>
  <div class="analyst-agent-container">
    <div class="chat-header">
      <div class="header-content">
        <el-button 
          type="primary" 
          :icon="ArrowLeft" 
          @click="goBack"
          class="back-button">
          {{ $t('common.back') }}
        </el-button>
        <div class="header-text">
          <h1>{{ $t('agents.analyst.title') }}</h1>
          <p>{{ $t('agents.analyst.subtitle') }}</p>
        </div>
      </div>
    </div>
    
    <div class="chat-messages">
      <!-- 用户提问 -->
      <div class="message user-message">
        <div class="message-content">
          <div class="message-text">Your data is {"/obs/phytomni/agent_data/raw_data/04.benchmark_data/07.testbenchmark/epigenetic/callpeak/data1_1.fq.gz": "pair-end 1 chip-seq data for rice", "/obs/phytomni/agent_data/raw_data/04.benchmark_data/07.testbenchmark/epigenetic/callpeak/data1_2.fq.gz": "pair-end 2 chip-seq data for rice", "/obs/phytomni/agent_data/raw_data/04.benchmark_data/07.testbenchmark/epigenetic/callpeak/NIP_genome_final.fa": "rice genome fasta file"}, please help me to perform the callpeak analysis.</div>
        </div>
      </div>
      
      <!-- AI回答 -->
      <div class="message ai-message">
        <div class="message-avatar">
          <el-avatar :size="36" :src="botAvatar" />
        </div>
        <div class="message-content">
          <div class="message-text">
            任务创建成功4a7715a-996a-22e0-acd5-fb278e7d45b3
            <div class="download-section">
              <el-button 
                type="primary" 
                :icon="Download" 
                @click="downloadResults"
                class="download-button">
                下载分析结果
              </el-button>
            </div>
            <div class="tip-text">{{ $t('common.Tip') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ArrowLeft, Download } from '@element-plus/icons-vue'

const router = useRouter()
const goBack = () => {
  router.back()
}

const botAvatar = 'https://cube.elemecdn.com/9/3c/436fe7666b465e0e69e553e5f5a071png.png'

// 下载分析结果
const downloadResults = () => {
  const link = document.createElement('a')
  link.href = '/static/downloads/3.Analyst Agent/1.AnalystAgent/results/callpeak_results.zip'
  link.download = 'callpeak_results.zip'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
</script>

<style lang="scss" scoped>
.analyst-agent-container {
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
  
  p {
    margin: 0 0 12px 0;
    color: #333;
    font-size: 14px;
  }
  
  .download-button {
    margin-top: 8px;
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