<template>
  <div class="data-agent-container">
    <div class="chat-header">
      <div class="header-content">
        <el-button 
          type="primary" 
          :icon="ArrowLeft" 
          @click="goBack"
          class="back-button">
          返回
        </el-button>
        <div class="header-text">
          <h1>{{ $t('agents.data.title') }}</h1>
          <p>{{ $t('agents.data.subtitle') }}</p>
        </div>
      </div>
    </div>
    
    <div class="chat-messages">
      <!-- 第一轮对话 -->
      <div class="message user-message">
        <div class="message-content">
          <div class="message-text">Please list the transcript ID of Os01g0177400 in rice.</div>
        </div>
      </div>
      
      <div class="message ai-message">
        <div class="message-avatar">
          <el-avatar :size="36" :src="botAvatar" />
        </div>
        <div class="message-content">
          <div class="message-text">
            <MarkdownViewer :content="round1Response" :instantMessage="true"/>
            <div class="tip-text">{{ $t('common.Tip') }}</div>
          </div>
        </div>
      </div>

      <!-- 第二轮对话 -->
      <div class="message user-message">
        <div class="message-content">
          <div class="message-text">How many bases does the CDS sequence of rice transcript Os01t0177400-01 contain?</div>
        </div>
      </div>
      
      <div class="message ai-message">
        <div class="message-avatar">
          <el-avatar :size="36" :src="botAvatar" />
        </div>
        <div class="message-content">
          <div class="message-text">
            <MarkdownViewer :content="round2Response" :instantMessage="true"/>
            <div class="tip-text">{{ $t('common.Tip') }}</div>
          </div>
        </div>
      </div>

      <!-- 第三轮对话 -->
      <div class="message user-message">
        <div class="message-content">
          <div class="message-text">List the homologous genes of rice Os01g0177400 in maize.</div>
        </div>
      </div>
      
      <div class="message ai-message">
        <div class="message-avatar">
          <el-avatar :size="36" :src="botAvatar" />
        </div>
        <div class="message-content">
          <div class="message-text">
            <MarkdownViewer :content="round3Response" :instantMessage="true"/>
            <div class="tip-text">{{ $t('common.Tip') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import MarkdownViewer from '@/components/MarkdownViewer.vue'

const router = useRouter()
const goBack = () => {
  router.back()
}

const botAvatar = 'https://cube.elemecdn.com/9/3c/436fe7666b465e0e69e553e5f5a071png.png'

// 第一轮对话响应
const round1Response = `|  Transcript ID  |
| :-------------: |
| Os01t0177400-01 |
`

// 第二轮对话响应
const round2Response = `| LENGTH([sequence_2]) |
| :------------------: |
|         1113         |`

// 第三轮对话响应
const round3Response = `| Query Gene ID | Query Species | Homology Gene ID | Homology Species |
| ------------- | :-----------: | :--------------: | :--------------: |
| Os01g0177400  |      osa      | Zm00001eb122500  |       zma        |`
</script>

<style lang="scss" scoped>
.data-agent-container {
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
    
    :deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
      margin-top: 0;
      margin-bottom: 12px;
      color: inherit;
    }
    
    :deep(p) {
      margin-bottom: 12px;
      &:last-child {
        margin-bottom: 0;
      }
    }
    
    :deep(ul), :deep(ol) {
      margin-bottom: 12px;
      padding-left: 20px;
    }
    
    :deep(li) {
      margin-bottom: 4px;
    }
    
    :deep(strong) {
      font-weight: 600;
    }
    
    :deep(code) {
      background: rgba(0, 0, 0, 0.1);
      padding: 2px 4px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
    
    :deep(pre) {
      background: rgba(0, 0, 0, 0.05);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin-bottom: 12px;
    }
    
    :deep(table) {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
      
      th, td {
        border: 1px solid #ddd;
        padding: 8px 12px;
        text-align: left;
      }
      
      th {
        background-color: #f5f5f5;
        font-weight: 600;
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