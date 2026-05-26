<template>
  <div class="chat-container">
    <!-- 左侧侧边栏 -->
    <Sidebar :chatList="chatList" :currentChatId="currentChatId" :collapsed="leftSidebarCollapsed"
      @selectChat="selectChat" @startNewChat="startNewChat" @openKnowledgeBase="openKnowledgeBase"
      @handleSidebarCollapse="handleSidebarCollapse" />
    <!-- 中间聊天区域 -->
    <div class="chat-main">
      <div class="chat-header">
        <h2>{{ $t('chat.title') }}</h2>
        <LangSwitch class="header-lang-switch" />
      </div>

      <!-- 消息区域 -->
      <div class="message-container" ref="messageContainer">
        <template v-if="currentChat?.messages?.length">
          <div v-for="(message, index) in currentChat.messages" :key="index" class="message" :class="message.role">
            <!-- 只有助手消息才显示头像 -->
            <div v-if="message.role === 'assistant'" class="message-avatar">
              <el-avatar :size="36" :src="botAvatar" />
            </div>
            <div class="message-content">
              <!-- 用户消息或没有思考步骤的回答 -->
              <div v-if="message.role === 'user' || (!message.steps && !message.tableHeaders)" class="message-text">
                <MarkdownViewer  :instantMessage="(message?.instantMessage && currentChat.messages.length-1 == index)|| false" :content="message.content" />
                <div v-if="message.doc_list && message.doc_list.length > 0">
                  <div class="doc-list-title">
                    {{ $t('chat.relatedDocuments') }}：
                  </div>
                  <div class="doc-list-item" v-for="(doc, docIndex) in message.doc_list" :key="docIndex">
                    <div v-if="doc.title" class="doc-simple">
                      {{ docIndex + 1 + '、' }}{{ doc.title }}
                    </div>
                    <div v-else-if="doc.au || doc.ti" class="doc-detailed">
                      <div class="doc-citation">
                        {{ docIndex + 1 }}. {{ formatDetailedCitation(doc) }}
                      </div>
                      <div class="doc-links" v-if="doc.dl || doc.pm">
                        <a v-if="doc.dl" :href="doc.dl" target="_blank" class="doc-link doi-link">
                          <el-icon><Link /></el-icon>
                          DOI
                        </a>
                        <a v-if="doc.pm" :href="`https://pubmed.ncbi.nlm.nih.gov/${doc.pm}`" target="_blank" class="doc-link pm-link">
                          <el-icon><Link /></el-icon>
                          PubMed
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
                 <el-button @click="()=>downloadFile(message?.upload_path)" v-if="message?.status && message?.status=='SUCCEEDED' && message?.upload_path && message?.upload_path !=='' " type="primary">
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{ $t('chat.downloadURL') }}</span>
                </el-button>
                  
                <div v-if="message.role === 'user'" class="message-user">
                  <div class="message-fotter"  v-if="copyVisible == 0 || copyVisible !==index+1" >
                    <el-tooltip
                      effect="dark"
                      :content="$t('chat.copy')"
                      placement="top-start"
                    >
                    <div class="message-fotter-item">
                       <el-icon
                        @click="()=>{
                        fallbackCopyText(message.content,index+1)
                        }"><CopyDocument /></el-icon>
                    </div>
                     
                    </el-tooltip>
                  </div>
                  <div class="message-fotter" v-else-if="copyVisible == index+1" >
                    <div class="message-fotter-item">
                       <el-icon><SuccessFilled /></el-icon>
                    </div>
                    
                  </div>
                </div>
                <div v-else>
                  <div class="message-fotter"  v-if="copyVisible == 0 || copyVisible !==index+1" >
                    <el-tooltip
                      effect="dark"
                      :content="$t('chat.copy')"
                      placement="top-start"
                    >
                     <div class="message-fotter-item">
                        <el-icon @click="() => copyMessageWithDocs(message, index)"><CopyDocument /></el-icon>
                     </div>
                      
                    </el-tooltip>
                  </div>
                  <div class="message-fotter" v-else-if="copyVisible == index+1" >
                     <div class="message-fotter-item"><el-icon><SuccessFilled /></el-icon></div>
                  </div>
                </div>
              </div>
              <!-- 表格数据展示 -->
              <div v-else-if="message.tableHeaders" class="table-response">
                <el-table :data="message.content" border style="width: 100%">
                  <el-table-column v-for="header in message.tableHeaders" :key="header.prop" :prop="header.prop"
                    :label="header.label" align="center" />
                </el-table>
                 <el-button @click="()=>downloadFile(message?.upload_path)" v-if="message?.status && message?.status=='SUCCEEDED' && message?.upload_path && message?.upload_path !=='' " type="primary">
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{ $t('chat.downloadURL') }}</span>
                </el-button>
                <div class="message-fotter" v-if="copyVisible == 0 || copyVisible !==index+1" >
                   <el-tooltip
                        effect="dark"
                        :content="$t('chat.copy')"
                        placement="top-start"
                      >
                       <div class="message-fotter-item">
                          <el-icon @click="fallbackCopyText(message.original,index+1)"><CopyDocument /></el-icon>
                       </div>
                   </el-tooltip>
                </div>
                <div class="message-fotter" v-else-if="copyVisible == index+1" >
                   <div class="message-fotter-item">
                      <el-icon><SuccessFilled /></el-icon>
                   </div>  
                </div>
              </div>
              <!-- 有思考步骤的助手回答  暂时没有作用 2025/07/21-->
              <div v-else class="ai-response">
                <!-- 思考步骤 -->
                <div v-if="message.steps && message.steps.length > 0">
                  <div class="steps-title">
                    {{ $t('chat.thinkingSteps') }}：
                  </div>
                  <div v-for="(step, stepIndex) in message.steps" :key="stepIndex" class="step-item">
                    <div v-if="stepIndex === 0" class="step-label">
                      {{ $t('chat.useTool') }}
                    </div>
                    <div v-else class="step-label">
                      {{ $t('chat.stepResult') }}
                    </div>
                    <div class="step-text">{{ step }}</div>
                  </div>
                </div>
                <!-- 最终答案 -->
                <div class="final-answer">
                  <!-- <div class="answer-content">{{ message.content }}</div> -->
                  <MarkdownViewer :instantMessage="(message?.instantMessage && currentChat.messages.length-1 == index) || false" :content="message.content" />
                </div>
                <el-button @click="()=>downloadFile(message?.upload_path)" v-if="message?.status && message?.status=='SUCCEEDED' && message?.upload_path && message?.upload_path !=='' " type="primary">
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{ $t('chat.downloadURL') }}</span>
                </el-button>
                 <div class="message-fotter" v-if="copyVisible == 0 || copyVisible !==index+1" >
                  <el-tooltip
                    effect="dark"
                    :content="$t('chat.copy')"
                    placement="top-start"
                  >
                    <div class="message-fotter-item">
                      <el-icon @click="() => copyMessageWithDocs(message, index)">
                        <CopyDocument />
                      </el-icon>
                    </div>
                  </el-tooltip>
                   
                 </div>
                <div class="message-fotter" v-else-if="copyVisible == index+1" >
                  <div class="message-fotter-item">
                    <el-icon><SuccessFilled /></el-icon>
                  </div> 
                </div>
              </div>
            </div>
            
          </div>
        </template>

        <!-- Loading消息 -->
        <div v-if="isSending" class="message assistant">
          <div class="message-avatar">
            <el-avatar :size="36" :src="botAvatar" />
          </div>
          <div class="message-content">
            <div class="message-text loading-message">
              <div class="loading-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!currentChat?.messages?.length" class="empty-chat">
          <div class="welcome-container">
            <h3>{{ $t('chat.welcome') }}</h3>
            <!-- <div class="suggestion-list">
              <div class="suggestion-item" @click="usePrompt($t('chat.suggestions.brca1'))">
                {{ $t('chat.suggestions.brca1') }}
              </div>
              <div class="suggestion-item" @click="usePrompt($t('chat.suggestions.mapk'))">
                {{ $t('chat.suggestions.mapk') }}
              </div>
              <div class="suggestion-item" @click="usePrompt($t('chat.suggestions.tp53'))">
                {{ $t('chat.suggestions.tp53') }}
              </div>
            </div> -->
            <!-- <div class="feature-container">
              <div class="feature-title">{{ $t('chat.features.title') }}</div>
              <div class="feature-list">
                <div class="feature-item">
                  <el-icon><el-icon-search /></el-icon>
                  <span>{{ $t('chat.features.research') }}</span>
                </div>
                <div class="feature-item">
                  <el-icon><el-icon-data-analysis /></el-icon>
                  <span>{{ $t('chat.features.analysis') }}</span>
                </div>
                <div class="feature-item">
                  <el-icon><el-icon-reading /></el-icon>
                  <span>{{ $t('chat.features.knowledge') }}</span>
                </div>
                <div class="feature-item">
                  <el-icon><el-icon-data-line /></el-icon>
                  <span>{{ $t('chat.features.design') }}</span>
                </div>
                <div class="feature-item">
                  <el-icon><el-icon-collection-tag /></el-icon>
                  <span>{{ $t('chat.features.organize') }}</span>
                </div>
                <div class="feature-item">
                  <el-icon><el-icon-eleme /></el-icon>
                  <span>{{ $t('chat.features.assistant') }}</span>
                </div>
              </div>
            </div> -->
          </div>
        </div>
      </div>





      <!-- 输入区域 -->
      <div class="input-container" :style="{ bottom: currentChat?.messages?.length ? '2%' : '30%' }">

        <div class="input-container-warpper">
          <!-- 文件列表区域 -->
          <div v-if="fileList.length > 0" class="file-list-container">
            <div class="file-list">
              <div v-for="(file, index) in fileList" :key="index" class="file-item">
                <div class="file-info">
                  <el-icon>
                    <document />
                  </el-icon>
                  <span class="file-name">{{ file.name }}</span>
                  <span class="file-size">({{ formatFileSize(file.size) }})</span>
                </div>
                <el-button type="text" @click="removeFile(index)" class="remove-btn">
                  <el-icon><icon-close /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
          <div class="input-actions">

            <div class="agent-button" :class="{
              'agent-button-active': activeButton.includes('RAG'),
              'agent-button-disabled': !hasButtonPermission('RAG')
            }" @click="hasButtonPermission('RAG') && handleButtonClick('RAG')">
              {{ $t('chat.agents.RAG') }}
            </div>
            <div class="agent-button" :class="{
              'agent-button-active': activeButton.includes('BI'),
              'agent-button-disabled': !hasButtonPermission('BI')
            }" @click="hasButtonPermission('BI') && handleButtonClick('BI')">
              {{ $t('chat.agents.BI') }}
            </div>
            <div class="agent-button" :class="{
              'agent-button-active': activeButton.includes('GA'),
              'agent-button-disabled': !hasButtonPermission('GA')
            }" @click="hasButtonPermission('GA') && handleButtonClick('GA')">
              {{ $t('chat.agents.GA') }}
            </div>
            <div class="agent-button" :class="{
              'agent-button-active': activeButton.includes('联网搜索'),
              'agent-button-disabled': !hasButtonPermission('联网搜索')
            }" @click="hasButtonPermission('联网搜索') && handleButtonClick('联网搜索')">
              {{ $t('chat.agents.search') }}
            </div>
          </div>
          <div class="input-box">
            <el-input class="input-box-input" border="none" v-model="messageInput" type="textarea" :rows="2"
              :placeholder="$t('chat.inputPlaceholder')" resize="none" :disabled="isSending"
              @keydown.enter.prevent="sendMessage" />
            <el-upload ref="uploadRef" class="upload-demo" :show-file-list="false" :auto-upload="false"
              :on-change="handleFileChange" multiple action="#">
              <template #trigger>
                <el-tooltip content="支持文件上传" placement="top">
                  <div class="upload-btn">
                    <img src="../../assets/images/chat/upload.png" alt="upload" />
                  </div>
                </el-tooltip>
              </template>
            </el-upload>
            <!-- <el-button type="primary" class="send-btn" :loading="isSending"
              :disabled="!messageInput.trim() || isSending" @click="sendMessage">
              {{ $t('chat.send') }}
            </el-button> -->
            <div v-if="!messageInput.trim() || isSending" class="send-btn">
              <el-tooltip content="请输入你的问题" placement="top">
                <img src="../../assets/images/chat/send_close.png" alt="send" />
              </el-tooltip>
            </div>
            <div v-else class="send-btn" @click="sendMessage">
              <img src="../../assets/images/chat/send_open.png" alt="send" />

            </div>
          </div>
        </div>

      </div>
      <div v-if="!currentChat?.messages?.length" class="input-container-bottom" @wheel.prevent="handleScroll"
        :style="containerStyle">
        <div class="agent-list">
          <div class="agent-page">
            <div v-for="agent in presetAgents" :key="agent.id" class="input-container-bottom-item"
              @click="handleAgentClick(agent)">
              <span>{{ agent.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧侧边栏 -->
    <div class="right-sidebar" :class="{ 'is-open': drawerVisible }">
      <div class="sidebar-header">
        <h3>{{ $t('chat.detailInfo') }}</h3>
        <el-button type="text" @click="drawerVisible = false" class="close-btn">
          <el-icon><icon-close /></el-icon>
        </el-button>
      </div>
      <div class="sidebar-content">
        <h3>{{ $t('chat.relatedLinks') }}</h3>
        <div class="links-container">
          <div v-for="(link, index) in currentLinks" :key="index" class="link-item">
            <el-icon><el-icon-link /></el-icon>
            <a :href="link.url" target="_blank">{{ link.title }}</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref, nextTick, watch, computed } from 'vue';
import type { Ref } from 'vue';
import Sidebar from './sidebar.vue';
import {
  Close as IconClose,
  Delete as IconDelete,
  Document,
  CopyDocument,
  SuccessFilled,
  Search,
  DataLine,
  Edit,
  Loading,
  DataAnalysis,
  Reading,
  Collection,
  Check,
  Download,
  Link
} from '@element-plus/icons-vue';
import { getAnswerCheck, getHistoryQuestionList, getQuery, getChatdownloadURL } from '@/api/chat';
import { userStore } from '@/stores';
import LangSwitch from '@/components/LangSwitch.vue';
import { useI18n } from 'vue-i18n';
import type { UploadInstance } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Paperclip } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router';
import MarkdownViewer from '@/components/MarkdownViewer.vue'
import axios from 'axios';

const uploadRef = ref<UploadInstance>()
const fileList = ref<UploadFile[]>([])
// 复制状态
const copyVisible = ref<number>(0);
const copyTimeRef = ref<ReturnType<typeof setTimeout> | undefined>(undefined);

const submitUpload = () => {
  uploadRef.value!.submit()
}
const { t } = useI18n();
// 抽屉状态
const drawerVisible = ref(false);

// 左侧侧边栏状态
const leftSidebarCollapsed = ref(false);

// 监听右侧侧边栏状态，当右侧打开时，确保左侧是收起的
watch(drawerVisible, newValue => {
  if (newValue === true && !leftSidebarCollapsed.value) {
    // 右侧打开，左侧需要收起
    leftSidebarCollapsed.value = true;
  }
});

const botAvatar =
  'https://cube.elemecdn.com/9/3c/436fe7666b465e0e69e553e5f5a071png.png';

// 定义接口
interface Chat {
  id: number;
  dialogue_id: string;
  title: string;
  date: string;
  messages?: ChatMessage[];
  original?:string;
  isFavorite: boolean; // 添加收藏状态属性
}

interface ChatMessage {
  role: string;
  content: any;
  steps?: any[];
  doc_list?: any[];
  tableHeaders?: Array<{
    prop: string;
    label: string;
  }>;
  instantMessage?:boolean;
  status?:string;
  upload_path?:string;
  original?:string;
}

interface ChatResponse {
  query: string;
  answer: string;
  tool_name?: string;
  status?:string;
  upload_path?:string;
  steps?: any[];
}

interface UploadFile {
  name: string;
  size: number;
  type: string;
  file: File;
}

// 格式化详细引用信息
const formatDetailedCitation = (doc: any) => {
  const parts = [];
  
  // 作者
  if (doc.au) {
    parts.push(doc.au);
  }
  
  // 标题
  if (doc.ti) {
    // 移除HTML标签
    const cleanTitle = doc.ti.replace(/<[^>]*>/g, '');
    parts.push(`"${cleanTitle}"`);
  }
  
  // 期刊名称
  if (doc.so) {
    parts.push(doc.so);
  }
  
  // 卷号和页码
  if (doc.vl) {
    if (doc.bp && doc.ep) {
      parts.push(`${doc.vl}: ${doc.bp}-${doc.ep}`);
    } else if (doc.bp) {
      parts.push(`${doc.vl}: ${doc.bp}`);
    } else {
      parts.push(doc.vl);
    }
  } else if (doc.bp && doc.ep) {
    parts.push(`${doc.bp}-${doc.ep}`);
  }
  
  // 出版年份
  if (doc.py) {
    parts.push(doc.py);
  }
  
  return parts.join('. ');
};

// 对话列表
const chatList = ref<Chat[]>([]);

const rolesTool = userStore().roles;
console.log(rolesTool, 'rolesTool');
// 定义按钮权限映射关系
const buttonPermissions = {
  RAG: 'RAG',
  BI: 'BI',
  GA: 'GA',
  联网搜索: '联网搜索',
};

// 检查按钮权限
const hasButtonPermission = (buttonType: string) => {
  const permission =
    buttonPermissions[buttonType as keyof typeof buttonPermissions];
  return rolesTool.includes(permission);
};

// 当前激活的按钮
const activeButton = ref<string[]>([]);

const router = useRouter();

onMounted(() => {
  // 确保有权限信息
  if (!rolesTool.length) {
    const UserStore = userStore();
    UserStore.getUserTools();
  }

  // 获取历史问题列表
  getHistoryQuestionData().then(() => {
    // 获取URL中的chatId
    const urlChatId = getChatIdFromUrl();
    // chatId 不存在默认为新对话
    if (urlChatId && chatList.value.length > 0) {
      // 查找是否存在对应的聊天
      const chatExists = chatList.value.some(chat => chat.dialogue_id === urlChatId);
      if (chatExists) {
        // 如果存在，选择该聊天
        selectChat(urlChatId);
      } else if (chatList.value.length > 0) {
        // 如果不存在但有聊天记录，更新URL为第一条聊天记录的ID
        const firstChatId = chatList.value[0].dialogue_id;
        updateUrlWithChatId(firstChatId);
        selectChat(firstChatId);
      }
    }
  });
});

// 获取历史问题数据
const getHistoryQuestionData = () => {
  return new Promise<void>(resolve => {
    getHistoryQuestionList()
      .then((res: any) => {
        if (res.code === 200 && res.data) {
          // 处理返回的数据，保留原始结构
          const formattedData = res.data.map((item: any) => {
            return {
              id: item.id,
              dialogue_id: item.dialogue_id,
              title: item.title_query || item.query, // 优先使用 title_query
              date: item.created_at, // 保留原始时间字符串
              isFavorite: false, // 添加缺失的属性
            };
          });

          // 更新chatList，保持API返回的顺序
          chatList.value = formattedData;
        }
        resolve();
      })
      .catch((err: any) => {
        resolve();
      });
  });
};

// 当前选中的对话
const currentChatId = ref('');
const currentChat: Ref<any> = ref(null);

// 开始新对话
const startNewChat = () => {
  currentChatId.value = '';
  currentChat.value = { messages: [] };
  historyQuestion.value = null;

  // 移除URL中的id参数
  const url = new URL(window.location.href);
  url.searchParams.delete('dialogue_id');
  window.history.pushState({}, '', url.toString());
};

// 处理按钮点击
const handleButtonClick = (buttonType: string) => {
  // 检查是否有权限
  if (!hasButtonPermission(buttonType)) {
    ElMessage.warning(t('chat.noPermission'));
    return;
  }

  const index = activeButton.value.indexOf(buttonType);
  if (index === -1) {
    // 如果不在数组中，添加
    activeButton.value.push(buttonType);
  } else {
    // 如果在数组中，移除
    activeButton.value.splice(index, 1);
  }
};

  const updateCopyIconHandler = (index:number,delay = 3000,) => {
    copyVisible.value=index;
    if (copyTimeRef.value) {
      clearTimeout(copyTimeRef.value);
    }
    copyTimeRef.value = setTimeout(() => {
      copyVisible.value=0;
    }, delay);
  };

//copy复制对话
const textAreaCopyCore= (text:any,index:number)=> {
  // const textarea = document.createElement('textarea');
  // textarea.value = text;
  // document.body.appendChild(textarea);
  // textarea.select();
  // document.execCommand('copy');
  // document.body.removeChild(textarea);
      const textArea = document.createElement('textarea');
      textArea.value = text;
      // 使text area不在viewport，同时设置不可见
      textArea.style.position = 'absolute';
      textArea.style.opacity = '0';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      updateCopyIconHandler(index);
      textArea.remove();
      ElMessage.success(t('chat.copySuccess'));
}

const fallbackCopyText = (text:any,index:number) => {
  try {
    if (window.isSecureContext) {
      navigator.clipboard.writeText(text);
      updateCopyIconHandler(index);
      ElMessage.success(t('chat.copySuccess'));
    } else {
      textAreaCopyCore(text,index);
    }
  } catch {
    ElMessage.success(t('chat.copyFailed'));
  }
};

// 打开聊天代理
const openChatAgents = () => {
  console.log(t('chat.logs.openChatAgent'));

  // 如果左侧侧边栏是展开的，先收起
  if (!leftSidebarCollapsed.value) {
    leftSidebarCollapsed.value = true;
  }

  // 打开右侧侧边栏
  drawerVisible.value = true;
};

// 知识代理人
const openKnowledgeAgents = () => {
  console.log(t('chat.logs.openKnowledgeAgent'));
  // 这里实现知识代理人功能
};

// 数据库代理
const openDatabaseAgents = () => {
  console.log(t('chat.logs.openDatabaseAgent'));
  // 这里实现数据库代理功能
};

// 分析代理
const openAnalysisAgents = () => {
  console.log(t('chat.logs.openAnalysisAgent'));
  // 这里实现分析代理功能
};

// 基因功能代理
const openGeneFunctionAgents = () => {
  console.log(t('chat.logs.openGeneFunctionAgent'));
  // 这里实现基因功能代理功能
};

// 审查代理人
const openReviewAgents = () => {
  console.log(t('chat.logs.openReviewAgent'));
  // 这里实现审查代理人功能
};

// 下载链接
const downloadFile = async(url:string)=>{
  // 在这里调用 getChatdownloadURL 接口 获取下载链接
  const res = await getChatdownloadURL({ obs_path: url });
  if(res.code == 200){
    window.open(res.data,"_blank",'noopener,noreferrer')
  }
}

// 打开知识库
const openKnowledgeBase = () => {
  console.log(t('chat.logs.openKnowledgeBase'));

  // 如果左侧侧边栏是展开的，先收起
  if (!leftSidebarCollapsed.value) {
    leftSidebarCollapsed.value = true;
  }

  // 打开右侧侧边栏
  drawerVisible.value = true;
};
const historyQuestion = ref();
// 选择对话
const selectChat = async (dialogueId: string) => {
  currentChatId.value = dialogueId;
  const chat = chatList.value.find((c: Chat) => c.dialogue_id === dialogueId);

  // 在这里调用 getAnswerCheck 接口 获取对话记录
  const res = await getAnswerCheck({ dialogue_id: dialogueId });
  console.log(res, 'res');

  if (res.code === 200) {
    // 处理返回的数据，转换为消息格式
    const messages: ChatMessage[] = [];
    const historyMessages: ChatMessage[] = [];
    historyQuestion.value = null;
    // 遍历返回的数组，转换为消息格式
    if (res.data && Array.isArray(res.data)) {
      res.data.forEach((item: ChatResponse) => {
        // 添加用户消息
        if (item.query) {
          messages.push({
            role: 'user',
            content: item.query,
          });
          historyMessages.push({
            role: 'user',
            content: item.query,
          });
        }

        // 添加助手消息
        if (item.answer) {
          try {
            const answerData = JSON.parse(item.answer);
            if (answerData.final_answer) {
              messages.push({
                role: 'assistant',
                content: answerData.final_answer,
                steps: answerData.steps || [],
                status:item?.status|| '',
                upload_path:item?.upload_path||''
              });
              historyMessages.push({
                role: 'assistant',
                content: answerData.final_answer,
              });
            } else {
              if (item.tool_name === 'ChatAgents'|| item.tool_name === 'ChatAgent') {
                messages.push({
                  role: 'assistant',
                  content: item.answer,
                  steps: [],
                  status:item?.status|| '',
                  upload_path:item?.upload_path||''
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              } else if (item.tool_name === 'KnowledgeAgents'||item.tool_name ==='ReviewAgents'||item.tool_name === 'KnowledgeAgent'||item.tool_name ==='ReviewAgent') {
                const contentData = JSON.parse(item.answer);
                messages.push({
                  role: 'assistant',
                  content: contentData.content,
                  doc_list: contentData.doc_list,
                  status:item?.status|| '',
                  upload_path:item?.upload_path|| ''
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              } else if (item.tool_name === 'DatabaseAgents'||item.tool_name === 'DataAgent') {
                const contentData = JSON.parse(item.answer);
                const tableData = convertToTableData(contentData);
                messages.push({
                  role: 'assistant',
                  content: tableData,
                  tableHeaders: contentData.headers.map((header: string) => ({
                    prop: header.replace(/\s+/g, '_').toLowerCase(),
                    label: header,
                  })),
                  status:item?.status|| '',
                  upload_path:item?.upload_path|| '',
                  original:item.answer,
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              } else if (item.tool_name === 'AnalysisAgents') {
                // const contentData = JSON.parse(item.answer);
                messages.push({
                  role: 'assistant',
                  content: '任务执行中，请等待',
                  status:item?.status|| '',
                  upload_path:item?.upload_path|| ''
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              }else if (item.tool_name === 'DeepGenomeAgent') {
                messages.push({
                  role: 'assistant',
                  content:item?.answer,
                  status:item?.status|| '',
                  upload_path:item?.upload_path|| ''
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              }else if(item.tool_name === 'AnalystAgent'){
                messages.push({
                  role: 'assistant',
                  content: item.answer,
                  status:item?.status|| '',
                  upload_path:item?.upload_path||''
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              }else{
                messages.push({
                  role: 'assistant',
                  content: item.answer,
                  status:item?.status|| '',
                  upload_path:item?.upload_path||''
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              }
            }
          } catch (e) {
            messages.push({
              role: 'assistant',
              content: item.answer,
              steps: [],
              status:item?.status|| '',
              upload_path:item?.upload_path||''
            });
            historyMessages.push({
              role: 'assistant',
              content: item.answer,
            });
          }
        }
      });
    }
    historyQuestion.value = historyMessages;
    // 更新当前对话的消息
    currentChat.value = {
      ...chat,
      messages: messages,
    };
  }
  updateUrlWithChatId(dialogueId);
};
// 输入框内容
const messageInput = ref('');

// 发送消息的加载状态
const isSending = ref(false);

// 消息容器引用，用于自动滚动
const messageContainer = ref<HTMLElement | null>(null);

// 发送消息
const sendMessage = async () => {
  if (!messageInput.value.trim() || isSending.value) return;

  isSending.value = true;
  const currentMessage = messageInput.value;
  messageInput.value = '';

  const isNewChat = !currentChat.value?.messages || currentChat.value.messages.length === 0;
  if (isNewChat) currentChat.value = { messages: [] };

  currentChat.value.messages.push({
    role: 'user',
    content: currentMessage,
  });

  await nextTick();
  if (messageContainer.value) {
    messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
  }

  try {
    const urlChatId = getDialogueIdFromChatId();
    const queryData = new FormData();
    queryData.append('query', currentMessage);
    queryData.append('id', (urlChatId ? Number(urlChatId) : 0).toString());
    queryData.append('tool', activeButton.value.join(','));
    if (historyQuestion.value) {
      queryData.append('history', JSON.stringify(historyQuestion.value));

    }
    if (fileList.value.length > 0) {
      fileList.value.forEach(fileItem => {
        queryData.append('files', fileItem.file);
      });
    }

    const response = await getQuery(queryData as any);
    console.log('response', response.data);

    if (response.data) {
    
      let assistantMessage;
      if (response.data.final_answer) {
        assistantMessage = {
          role: 'assistant',
          content: response.data.final_answer || '抱歉，我无法回答这个问题。',
          steps: response.data.steps || [],
          status:response.data?.status|| '',
          upload_path:response.data?.upload_path||'',
          instantMessage:true
        };
      } else {
        if (response.data.tool_name) {
          if (response.data.tool_name === 'ChatAgents'|| response.data === 'ChatAgent') {
            assistantMessage = {
              role: 'assistant',
              content: response.data.answer,
              status:response.data?.status|| '',
              upload_path:response.data?.upload_path||'',
              instantMessage:true
            };
          }else if (response.data.tool_name === 'DeepGenomeAgent') {
            assistantMessage = {
              role: 'assistant',
              content: response.data.answer,
              status:response.data?.status|| '',
              upload_path:response.data?.upload_path||'',
              instantMessage:true
            };
          } else if (response.data.tool_name === 'KnowledgeAgents'||response.data.tool_name ==='ReviewAgents'||response.data.tool_name === 'KnowledgeAgent'||response.data.tool_name ==='ReviewAgent') {
            const contentData = JSON.parse(response.data.answer);
            assistantMessage = {
              role: 'assistant',
              content: contentData.content,
              doc_list: contentData.doc_list,
              status:response.data?.status|| '',
              upload_path:response.data?.upload_path||'',
              instantMessage:true
            };
          } else if (response.data.tool_name === 'DatabaseAgents'||response.data.tool_name === 'DataAgent') {
            const contentData = JSON.parse(response.data.answer);
            const tableData = convertToTableData(contentData);
            assistantMessage = {
              role: 'assistant',
              content: tableData,
              tableHeaders: contentData.headers.map((header: string) => ({
                prop: header.replace(/\s+/g, '_').toLowerCase(),
                label: header,
              })),
              status:response.data?.status|| '',
              upload_path:response.data?.upload_path||'',
              instantMessage:true,
              original:response.data.answer,
            };
          }else if (response.data.tool_name === 'AnalysisAgents') {
            const contentData = JSON.parse(response.data.answer);
            const tableData = convertToTableData(contentData);
            assistantMessage = {
              role: 'assistant',
              content: '任务执行中，请等待',
              status:response.data?.status|| '',
              upload_path:response.data?.upload_path||'',
              instantMessage:true
            };
          }else if(response.data.tool_name === 'AnalystAgent'){
              assistantMessage = {
                role: 'assistant',
                content: response.data.answer,
                status:response.data?.status|| '',
                upload_path:response.data?.upload_path||'',
                instantMessage:true
              };
          }
        } else {
          assistantMessage = {
            role: 'assistant',
            content: response.data.answer,
            status:response.data?.status|| '',
            upload_path:response.data?.upload_path||'',
            instantMessage:true
          };
        }
      }

       currentChat.value.messages.push(assistantMessage);

    } else {
      currentChat.value.messages.push({
        role: 'assistant',
        content: '抱歉，我无法回答这个问题。',
        steps: [],
        status: '',
        upload_path:'',
        instantMessage:true
      });
    }
  } catch (error: any) {
    console.error(t('chat.logs.sendMessageFailed'), error);
    // 检查是否是token过期错误
    if (error.response && error.response.data && error.response.data.detail && error.response.data.detail.code === 403) {
      ElMessageBox.alert(
        '登录已过期，请重新登录',
        '系统提示',
        {
          confirmButtonText: '我知道了',
          type: 'warning',
          callback: () => {
            const UserStore = userStore();
            UserStore.FedLogOut().then(() => {
              // 清除所有缓存和cookie
              localStorage.clear();
              sessionStorage.clear();
              document.cookie.split(";").forEach(function(c) { 
                document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
              });
              location.href = '/login';
            });
          }
        }
      );
      return;
    }
    currentChat.value.messages.push({
      role: 'assistant',
      content: t('chat.sendFailed'),
      steps: [],
      status:'',
      upload_path:'',
      instantMessage:true
    });
  } finally {
    if (isNewChat) {
      await getHistoryQuestionData();
      if (chatList.value.length > 0) {
        const newChat = chatList.value[0];
        currentChatId.value = newChat.dialogue_id;
        updateUrlWithChatId(newChat.dialogue_id);
      } 
    }
    isSending.value = false;

    await nextTick();
    if (messageContainer.value) {
      messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
    }
    // 发送信息后 不需要重新刷新历史列表 导致打字效果失效
    // const urlChatId = getChatIdFromUrl();
    // if (urlChatId) {
    //   // selectChat(urlChatId);
    // }
  }
};

// 使用预设问题
const usePrompt = (prompt: string) => {
  if (isSending.value) return;
  messageInput.value = prompt;
  sendMessage();
};

// 相关链接
const currentLinks = ref([
  {
    title: t('chat.links.brca1'),
    url: 'https://www.ncbi.nlm.nih.gov/gene/672',
  },
  {
    title: t('chat.links.mapk'),
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3135676/',
  },
  {
    title: t('chat.links.tp53'),
    url: 'https://p53.iarc.fr/',
  },
]);

// 侧边栏控制函数
const handleSidebarCollapse = (isCollapsed: boolean) => {
  // 更新左侧侧边栏状态
  leftSidebarCollapsed.value = isCollapsed;

  // 如果左侧侧边栏展开且右侧侧边栏也是展开的，则关闭右侧
  if (!isCollapsed && drawerVisible.value) {
    drawerVisible.value = false;
  }
};

// 更新URL中的聊天ID
const updateUrlWithChatId = (dialogueId: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set('dialogue_id', dialogueId);
  window.history.pushState({}, '', url.toString());
};

// 从URL读取聊天ID
const getChatIdFromUrl = () => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('dialogue_id');
};
// 根据聊天ID读取对话ID
const getDialogueIdFromChatId = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const dialogueId = urlParams.get('dialogue_id');
  const chatRealId = chatList.value.find((c: Chat) => c.dialogue_id === dialogueId)?.id;
  return chatRealId;
};
// 转换数据格式为 Element Plus Table 格式
const convertToTableData = (data: { headers: string[]; rows: any[][] }) => {
  return data.rows.map(row => {
    const obj: Record<string, any> = {};
    data.headers.forEach((header, index) => {
      // 替换空格为下划线，避免属性名中的空格
      const key = header.replace(/\s+/g, '_').toLowerCase();
      obj[key] = row[index];
    });
    return obj;
  });
};

// 文件处理相关函数
const handleFileChange = (file: any) => {
  const newFile: UploadFile = {
    name: file.name,
    size: file.size,
    type: file.type,
    file: file.raw
  };
  fileList.value.push(newFile);
};

const removeFile = (index: number) => {
  fileList.value.splice(index, 1);
};

const clearFiles = () => {
  fileList.value = [];
};

const formatFileSize = (size: number) => {
  if (size < 1024) {
    return size + ' B';
  } else if (size < 1024 * 1024) {
    return (size / 1024).toFixed(2) + ' KB';
  } else {
    return (size / (1024 * 1024)).toFixed(2) + ' MB';
  }
};

// 预设的agents数据
const presetAgents = ref([
  {
    id: 1,
    name: t('chat.geneDetail'),
    icon: 'Document',
    route: '/gene-display'
  },
  {
    id: 2,
    name: 'Research Agent',
    icon: 'Search',
    route: '/research'
  },
  {
    id: 3,
    name: 'Gene Agent',
    icon: 'DataLine',
    route: '/gene-agent'
  },
  {
    id: 4,
    name: 'Design Agent',
    icon: 'Edit',
    route: '/design'
  }
]);
// 基础高度
const baseHeight = 140;
// 展开时的高度
const expandedHeight = 480;
// 额外的覆盖高度
const overlayHeight = 10;

// 计算当前容器高度
const containerHeight = computed(() => {
  return isExpanded.value ? expandedHeight : baseHeight;
});

// 计算当前容器的样式
const containerStyle = computed(() => ({
  height: `${containerHeight.value}px`,
  transform: isExpanded.value ? `translateY(-${overlayHeight}px)` : 'none'
}));

// 是否展开
const isExpanded = ref(false);

// 处理滚动
const handleScroll = (event: WheelEvent) => {
  if (isAnimating.value) return;

  // 向下滚动且未展开
  if (event.deltaY > 0 && !isExpanded.value) {
    isAnimating.value = true;
    isExpanded.value = true;
    setTimeout(() => {
      isAnimating.value = false;
    }, 500);
  }
  // 向上滚动且已展开
  else if (event.deltaY < 0 && isExpanded.value) {
    isAnimating.value = true;
    isExpanded.value = false;
    setTimeout(() => {
      isAnimating.value = false;
    }, 500);
  }
};

// 是否正在动画中
const isAnimating = ref(false);

// 处理agent点击
const handleAgentClick = (agent: any) => {
  router.push(agent.route);
};

// 复制消息内容 + 引用的文档列表(从 inline @click 提取,绕开 vue-tsc
// 0.39.5 在模板多语句箭头函数内解析局部 const 时把它误映射到
// component instance 的 bug —— 详见 copy.vue 中 4 处 @click 用法)
const copyMessageWithDocs = (message: any, index: number) => {
  const docs =
    message.doc_list && message.doc_list.length > 0
      ? message.doc_list
          .map((item: any, idx: number) => {
            if (item.title) {
              return `${idx + 1}. ${item.title}`;
            } else if (item.au || item.ti) {
              return `${idx + 1}. ${formatDetailedCitation(item)}`;
            }
            return `${idx + 1}. ${JSON.stringify(item)}`;
          })
          .join('\n')
      : '';
  const text =
    message.content + (docs && docs !== '' ? '\n参考资料:\n' : '') + docs;
  fallbackCopyText(text, index + 1);
};

</script>

<style lang="scss" scoped>
.chat-container {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
}

// 聊天主界面
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #fff;
  overflow: hidden;
  transition: all 0.3s ease;
}

.chat-header {
  padding: 0 16px;
  border-bottom: 1px solid #e6e6e6;
  text-align: center;
  height: 62px;
  display: flex;
  align-items: center;
  justify-content: space-between;

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 500;
  }

  .header-lang-switch {
    margin-left: auto;
  }
}

.message-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.message {
  display: flex;
  margin-bottom: 16px;

  &.user {
    justify-content: flex-end;

    .message-content {
      display: flex;
      justify-content: flex-end;
      width: calc(100% - 48px);
      border-radius: 15px;
      background-color: transparent;

      .message-text {
        // background-color: #e6f7ff;
      }
    }
  }

  &.assistant {
    flex-direction: row;

    .message-content {
      border-radius: 15px;
      margin-left: 12px;
      background-color: transparent;
      width: 100%;
    }
  }

  .message-avatar {
    flex-shrink: 0;
    align-self: flex-start;
  }

  .message-content {
    padding: 0 12px 12px;
    max-width: 100%;

    .message-text {
      position: relative;
      word-break: break-word;
      white-space: pre-wrap;
      // background-color: #f5f5f5;
      box-shadow: 0 0 10px 0 rgba(212, 210, 210, 0.35);
      width: 100%;
      padding: 12px;
      border-radius: 8px;
    }
    .message-text:hover .message-user{
      display: block !important;
    }

    .ai-response {
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 0 10px 0 rgba(212, 210, 210, 0.35);
      .steps-title {
        font-weight: bold;
        margin-bottom: 12px;
        color: #333;
      }

      .step-item {
        margin-bottom: 12px;
        padding: 12px 16px;
        background-color: #fff;
        border-radius: 8px;
        border-left: 3px solid #1890ff;

        .step-label {
          font-weight: bold;
          color: #666;
          margin-bottom: 8px;
          font-size: 13px;
        }

        .step-text {
          color: #333;
        }
      }

      .final-answer {

        .answer-title {
          font-weight: bold;
          margin-bottom: 12px;
          color: #333;
          font-size: 16px;
        }

        .answer-content {
          word-break: break-word;
          white-space: pre-wrap;
          color: #333;
        }
      }
    }
  }
}

.empty-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;

  .welcome-container {
    width: 80%;
    max-width: 800px;

    h3 {
      text-align: center;
      margin-bottom: 24px;
      color: #333;
      margin-top: 100px;
    }
  }

  .suggestion-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 40px;

    .suggestion-item {
      background-color: #f5f5f5;
      padding: 12px 16px;
      border-radius: 8px;
      cursor: pointer;

      &:hover {
        background-color: #e6f7ff;
      }
    }
  }

  .feature-container {
    margin-top: 40px;

    .feature-title {
      text-align: center;
      font-size: 16px;
      margin-bottom: 16px;
      color: #333;
    }

    .feature-list {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 16px;

      .feature-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        width: 100px;
        padding: 16px;
        background-color: #f9f9f9;
        border-radius: 8px;

        .el-icon {
          font-size: 24px;
          color: #1890ff;
        }
      }
    }
  }
}

.input-container {
  width: 100%;
  position: relative;
  z-index: 1;

  .input-container-warpper {
    padding: 8px 4px 8px 8px;
    border-top: 1px solid #e6e6e6;
    position: relative;
    left: 50%;
    transform: translateX(-50%);
    width: 85%;
    border: 1px solid #e6e6e6;
    border-radius: 10px;
  }

  .input-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;

    .agent-button {
      padding: 4px 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 400;
      color: #223e36;
      border: 1.5px solid transparent;
      background-color: #fff;
      transition: all 0.3s ease;

      &:hover:not(.agent-button-disabled) {
        border-color: #223e36;
        color: #223e36;
      }

      &.agent-button-active {
        background-color: #223e36;
        color: #fff;
        border-color: #223e36;

        &:hover {
          opacity: 0.8;
          color: #fff;
        }
      }

      &.agent-button-disabled {
        background-color: #fff;
        border: 1px solid #d4d4d4;
        color: #999;
        cursor: not-allowed;
        opacity: 0.6;
      }
    }
  }

  .input-box {
    display: flex;
    gap: 12px;
    align-items: flex-end;

    .el-textarea {
      flex: 1;
    }

    .upload-btn {
      position: absolute;
      right: 70px;
      bottom: -3px;
      width: 20px;
      height: 20px;
      cursor: pointer;
      z-index: 1000;

      img {
        width: 100%;
        height: 100%;
      }
    }

    .send-btn {
      align-self: flex-end;
      position: absolute;
      right: 35px;
      bottom: 3px;
      cursor: pointer;
      width: 25px;
      height: 20px;
      z-index: 1000;

      img {
        width: 100%;
        height: 100%;
      }
    }
  }
}

// 右侧侧边栏样式
.right-sidebar {
  width: 0;
  height: 100%;
  background-color: #fff;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;

  &.is-open {
    width: 350px;
    min-width: 350px;
  }

  .sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid #e6e6e6;

    h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
    }

    .close-btn {
      padding: 4px;
    }
  }

  .sidebar-content {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
    width: 350px;

    h3 {
      margin-top: 0;
      margin-bottom: 16px;
    }

    .links-container {
      display: flex;
      flex-direction: column;
      gap: 12px;

      .link-item {
        display: flex;
        align-items: center;
        gap: 8px;

        a {
          color: #1890ff;
          text-decoration: none;

          &:hover {
            text-decoration: underline;
          }
        }
      }
    }
  }
}
.message-user{
  position: absolute;
  bottom:0px;
  right: 1px;
  display: none;
}

.message-fotter{
  width: 100%;
  height: auto;
  display: flex;
  gap:10px;
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  margin-top: 5px;
  &-item{
    display: flex;
    justify-content: center;
    align-items: center;
    width: 22px;
    height: 22px;
    padding: 2px;
    box-sizing: border-box;
    border-radius: 4px;
  }
  &-item:hover{
      color: #1890ff;
      background: #e8e6e6;
    }
}

// 加载动画
.loading-message {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  background-color: #f5f5f5;
  padding: 12px;
  border-radius: 8px;
  width: 75px;

  .loading-dots {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;

    .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: #1890ff;
      animation: dot-pulse 1.4s infinite ease-in-out;

      &:nth-child(1) {
        animation-delay: 0s;
      }

      &:nth-child(2) {
        animation-delay: 0.2s;
      }

      &:nth-child(3) {
        animation-delay: 0.4s;
      }
    }
  }

  @keyframes dot-pulse {

    0%,
    100% {
      opacity: 0.4;
      transform: scale(0.8);
    }

    50% {
      opacity: 1;
      transform: scale(1);
    }
  }
}

.doc-list-title {
  color: #48a0f0;
  font-size: 14px;
  font-weight: 500;
  margin-top: 8px;
  margin-bottom: 2px;
}

.doc-list-item {
  color: #48a0f0;
  font-size: 13px;
  font-weight: 400;
  margin-bottom: 8px;
  
  .doc-simple {
    // 简单格式（只有title）
  }
  
  .doc-detailed {
    .doc-citation {
      color: var(--el-text-color-primary);
      font-size: 14px;
      line-height: 1.4;
      margin-bottom: 6px;
    }
    
    .doc-links {
      display: flex;
      gap: 12px;
      margin-top: 4px;
      
      .doc-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 4px;
        text-decoration: none;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s ease;
        
        .el-icon {
          font-size: 12px;
        }
        
        &.doi-link {
          background-color: #e6f7ff;
          color: #1890ff;
          border: 1px solid #91d5ff;
          
          &:hover {
            background-color: #bae7ff;
            border-color: #69c0ff;
          }
        }
        
        &.pm-link {
          background-color: #f6ffed;
          color: #52c41a;
          border: 1px solid #b7eb8f;
          
          &:hover {
            background-color: #d9f7be;
            border-color: #95de64;
          }
        }
      }
    }
  }
}

.file-list-container {
  margin-bottom: 10px;

  .file-list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    h4 {
      margin: 0;
      color: #606266;
    }
  }

  .file-list {
    display: flex;
    flex-direction: row;
    gap: 8px;
  }

  .file-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0px 4px;
    background-color: #fff;
    border-radius: 4px;
    border: 1px solid #e6e6e6;
    font-size: 12px;

    .file-info {
      display: flex;
      align-items: center;
      gap: 8px;

      .el-icon {
        color: #909399;
      }

      .file-name {
        color: #303133;
      }

      .file-size {
        color: #909399;
        font-size: 12px;
      }
    }

    .remove-btn {
      padding: 2px;

      &:hover {
        color: #f56c6c;
      }
    }
  }
}

::v-deep(.el-textarea__inner) {
  box-shadow: none;
  margin-bottom: 30px;
}

::v-deep(.el-textarea__inner):focus {
  box-shadow: none;
}

::v-deep(.el-textarea__inner):hover {
  box-shadow: none;
}

.input-container-bottom {
  margin-top: 30px;
  padding: 8px 16px;
  background-color: #fff;
  overflow: hidden;
  box-sizing: border-box;
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 12px;
  // box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 1000;

  &::before {
    content: '';
    position: absolute;
    top: -20px;
    left: 0;
    right: 0;
    height: 20px;
    background: linear-gradient(to bottom, transparent, rgba(255, 255, 255, 0.9));
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  &::after {
    content: '';
    position: absolute;
    bottom: -20px;
    left: 0;
    right: 0;
    height: 20px;
    background: linear-gradient(to top, transparent, rgba(255, 255, 255, 0.9));
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  &:hover {

    &::before,
    &::after {
      opacity: 1;
    }
  }

  .agent-list {
    height: 100%;
  }

  .agent-page {
    height: 100%;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-around;
    align-content: flex-start;
    gap: 12px;
    padding-bottom: 8px;
  }

  .input-container-bottom-item {
    display: flex;
    width: 200px;
    height: 120px;
    align-items: center;
    justify-content: center;
    padding: 8px 16px;
    background-color: #156082;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

    &:hover {
      background-color: rgba(21, 97, 132, 0.8);
      transform: translateY(-2px) scale(1.02);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    span {
      color: #fff;
      font-size: 14px;
      white-space: nowrap;
    }
  }
}

// 为了确保容器可以覆盖其他内容
.input-container {
  position: relative;
  z-index: 1;
}
</style>
