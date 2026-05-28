<template>
  <div class="chat-container">
    <!-- 教学引导遮罩层 -->
    <div v-if="showTutorial" class="tutorial-overlay" @click="handleTutorialOverlayClick">
      <!-- 第一步：左侧侧边栏高亮 -->
      <div v-if="currentTutorialStep === 1" class="tutorial-step-1">
        <!-- 左侧侧边栏高亮区域 -->
        <div class="sidebar-highlight-area"></div>
        <!-- 教学内容 -->
        <div class="tutorial-content sidebar-tutorial">
          <h3>{{ $t('tutorial.step1.title') }}</h3>
          <p>{{ $t('tutorial.step1.content') }}</p>
          <div class="tutorial-actions">
            <el-button type="primary" @click="nextTutorialStep">{{ $t('tutorial.nextStep') }}</el-button>
            <div class="tutorial-hint">
              <small>{{ $t('tutorial.navigationHint') }}</small>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 第二步：底部案例栏高亮 -->
      <div v-if="currentTutorialStep === 2" class="tutorial-step-2">
        <!-- 底部案例栏高亮区域 -->
        <div class="bottom-highlight-area"></div>
        <!-- 教学内容 -->
        <div class="tutorial-content bottom-tutorial">
          <h3>{{ $t('tutorial.step2.title') }}</h3>
          <p>{{ $t('tutorial.step2.content') }}</p>
          <div class="tutorial-actions">
            <el-button @click="prevTutorialStep">{{ $t('tutorial.prevStep') }}</el-button>
            <el-button type="primary" @click="nextTutorialStep">{{ $t('tutorial.nextStep') }}</el-button>
            <div class="tutorial-hint">
              <small>{{ $t('tutorial.navigationHint') }}</small>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 第三步：对话栏高亮 -->
      <div v-if="currentTutorialStep === 3" class="tutorial-step-3">
        <!-- 对话输入区高亮区域 -->
        <div class="input-highlight-area"></div>
        <!-- 教学内容 -->
        <div class="tutorial-content input-tutorial">
          <h3>{{ $t('tutorial.step3.title') }}</h3>
          <p>{{ $t('tutorial.step3.content') }}</p>
          <div class="tutorial-actions">
            <el-button @click="prevTutorialStep">{{ $t('tutorial.prevStep') }}</el-button>
            <el-button type="primary" @click="completeTutorial">{{ $t('tutorial.complete') }}</el-button>
            <div class="tutorial-hint">
              <small>{{ $t('tutorial.navigationHint') }}</small>
            </div>
          </div>
        </div>
      </div>
    </div>



    <!-- 左侧侧边栏 -->
    <Sidebar :chatList="chatList" :currentChatId="currentChatId" :collapsed="leftSidebarCollapsed"
      :showTutorial="showTutorial && currentTutorialStep === 1"
      @selectChat="selectChat" @startNewChat="startNewChat" @openKnowledgeBase="openKnowledgeBase"
      @handleSidebarCollapse="handleSidebarCollapse" @startTutorial="startTutorial" />
    <!-- 中间聊天区域 -->
    <div class="chat-main">
      <div class="chat-header">
        <router-link to="/help">
          <h2>{{ $t('chat.title') }}</h2>
        </router-link>
        <div class="header-controls">
          <LangSwitch class="header-lang-switch" />
          <el-button v-if="isDevelopment" type="primary" size="small" @click="startTutorial" style="margin-left: 10px;">
            {{ $t('tutorial.restartTutorial') }}
          </el-button>
          <el-button v-if="isDevelopment" type="primary" size="small" @click="testParallelChats"
            style="margin-left: 10px;">
            测试并行对话
          </el-button>
        </div>
      </div>

      <!-- 消息区域 -->
      <div class="message-container" ref="messageContainer" :key="timestamp">
        <template v-if="currentChat?.messages?.length">
          <div v-for="(message, index) in currentChat.messages" :key="index" class="message" :class="message.role">
            <!-- 只有助手消息才显示头像 -->
            <div v-if="message.role === 'assistant'" class="message-avatar">
              <el-avatar :size="36" :src="botAvatar" />
            </div>
            <div class="message-content">
              <!-- 用户消息或没有思考步骤的回答 -->
              <div v-if="message.role === 'user' || (!message.steps && !message.tableHeaders)" class="message-text"
                :class="{ 'has-user': message.role === 'user' }">

                <!-- 日志视图 - 左右两栏布局 -->
                <div v-if="message.role === 'assistant' && message.tool_name === 'AnalystAgent' && message.showLog"
                  class="log-view-container">
                  <div class="log-view-left">
                    <h4>回复内容</h4>
                    <MarkdownViewer
                      :instantMessage="(message?.instantMessage && currentChat.messages.length - 1 == index) || false"
                      :content="message.content" @finish="() => handleMarkdownFinish(index)" />
                  </div>
                  <div class="log-view-right">
                    <h4>执行日志 (ID: {{ message.id }})</h4>

                    <!-- 更新日志按钮 -->
                    <div class="log-actions">
                      <el-button type="primary" size="small" @click="updateLog(message.task_id)"
                        :loading="updatingLog[message.task_id || '']" :disabled="!message.task_id">
                        <el-icon>
                          <Refresh />
                        </el-icon>
                        更新日志
                      </el-button>
                    </div>

                    <div v-if="loadingLog[message.id || '']" class="log-loading">
                      <el-icon class="is-loading">
                        <Loading />
                      </el-icon>
                      加载日志中...
                    </div>
                    <div v-else-if="logData[message.id || '']" class="log-content">
                      <!-- 新的日志渲染逻辑 -->
                      <div v-if="typeof logData[message.id || ''] === 'string'" class="log-text-content">
                        <pre class="log-pre" v-html="formatLogContentWithColors(logData[message.id || ''])"></pre>
                      </div>
                      <!-- 原有的表格渲染逻辑（向后兼容） -->
                      <el-table v-else-if="Array.isArray(logData[message.id || ''])" :data="logData[message.id || '']"
                        border style="width: 100%">
                        <el-table-column prop="content" label="日志内容" align="left" />
                      </el-table>
                    </div>
                    <div v-else class="log-error">
                      暂无日志数据 (loadingLog: {{ loadingLog[message.id || ''] }}, logData: {{ !!logData[message.id || '']
                      }})
                    </div>
                  </div>
                </div>

                <!-- 普通消息内容 -->
                <div v-else>
                  <!-- DeepGenomeAgent 的返回使用专用查看器组件,带 references 列表;
                       其他 tool_name 回落到通用 MarkdownViewer -->
                  <DeepGenomeResultViewer
                    v-if="
                      message.doc_list && message.doc_list.length > 0 &&
                      message.role === 'assistant' &&
                      message.tool_name === 'DeepGenomeAgent'
                    "
                    :markdown="message.content.replace(/\n/g, '\\n')"
                    :references="message.doc_list || []" />
                  <MarkdownViewer
                    v-else
                    :instantMessage="(message?.instantMessage && currentChat.messages.length - 1 == index) || false"
                    :content="message.content" @finish="() => handleMarkdownFinish(index)" />
                </div>

                <!-- 用户消息的文件列表显示 -->
                <div v-if="message.role === 'user' && message.attachedFiles && message.attachedFiles.length > 0"
                  class="message-files">
                  <div class="files-list">
                    <div v-for="(file, fileIndex) in message.attachedFiles" :key="fileIndex" class="file-item-display">
                      <FilesCard :uid="fileIndex" :name="file.name" :file-size="file.size" :show-del-icon="false" />
                    </div>
                  </div>
                </div>
                <div v-if="message.tool_name !== 'DeepGenomeAgent' && message.doc_list && message.doc_list.length > 0">
                  <div class="doc-list-title">
                    {{ $t('chat.relatedDocuments') }}：
                  </div>
                  <div class="doc-list-item" v-for="(doc, docIndex) in message.doc_list" :key="docIndex">
                    <div v-if="doc.title" class="doc-simple">
                      {{ docIndex + 1 + '、' }}{{ doc.title }}
                    </div>
                    <div v-else-if="doc.au || doc.ti" class="doc-detailed">
                      <div class="doc-citation">
                        {{ docIndex + 1 }}. {{ formatDetailedCitation(doc) }}<span v-if="doc.dl || doc.pm">. <span
                            v-if="doc.dl" class="doc-link-inline">doi:<a :href="doc.dl" target="_blank"
                              class="doi-link">{{ doc.dl }}</a></span><span v-if="doc.dl && doc.pm">; </span><span
                            v-if="doc.pm" class="doc-link-inline">pmid:<a
                              :href="`https://pubmed.ncbi.nlm.nih.gov/${doc.pm}`" target="_blank" class="pmid-link">{{
                                doc.pm }}</a></span></span>
                      </div>
                    </div>
                  </div>
                  <!-- 调试信息：显示完整的 doc_list 数据 平常隐藏-->
                  <div v-if="false" class="debug-info"
                    style="margin-top: 8px; padding: 8px; background-color: #f5f5f5; border-radius: 4px; font-size: 12px; color: #666;">
                    <strong>调试信息 (doc_list):</strong>
                    <pre
                      style="margin: 4px 0; white-space: pre-wrap; word-break: break-word;">{{ JSON.stringify(message.doc_list, null, 2) }}</pre>
                  </div>
                </div>
                <el-button @click="() => downloadFile(message?.upload_path)"
                  v-if="message?.status && message?.status == 'SUCCEEDED' && message?.upload_path && message?.upload_path !== ''"
                  type="primary">
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{ $t('chat.downloadURL') }}</span>
                </el-button>
                
                <!-- 基于 download_path 的下载按钮 -->
                <el-button @click="() => downloadFileDirect(message?.download_path)"
                  v-if="message?.download_path && message?.download_path !== ''"
                  type="primary" style="margin-left: 8px;">
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">下载文件</span>
                </el-button>

                <!-- 日志按钮 - 仅在AnalystAgent类型下显示 -->
                <div v-if="message.role === 'assistant' && message.tool_name === 'AnalystAgent'"
                  class="log-button-container">
                  <el-button type="primary" size="small" @click="toggleLogView(message.id)"
                    :class="{ 'active': message.showLog }">
                    <el-icon>
                      <Document />
                    </el-icon>
                    {{ message.showLog ? '隐藏日志' : '查看日志' }}
                  </el-button>
                </div>

                <!-- 后续问题显示 -->
                <FollowUpQuestions
                  v-if="message.role === 'assistant' && message.followUpQuestions && message.followUpQuestions.length > 0 && message.showFollowUpQuestions && index == currentChat.messages.length - 1"
                  :questions="message.followUpQuestions" @question-click="handleFollowUpQuestionClick" />

                <div v-if="message.role === 'user'" class="message-user">
                  <div class="message-fotter" v-if="copyVisible == 0 || copyVisible !== index + 1">
                    <el-tooltip effect="dark" :content="$t('chat.copy')" placement="top-start">
                      <div class="message-fotter-item">
                        <el-icon @click="() => {
                          fallbackCopyText(message.content, index + 1)
                        }">
                          <CopyDocument />
                        </el-icon>
                      </div>
                    </el-tooltip>
                  </div>
                  <div class="message-fotter" v-else-if="copyVisible == index + 1">
                    <div class="message-fotter-item">
                      <el-icon>
                        <SuccessFilled />
                      </el-icon>
                    </div>
                  </div>
                </div>
                <div v-else>
                  <div class="message-fotter">
                    <el-tooltip effect="dark" :content="$t('chat.copy')" placement="top-start"
                      v-if="copyVisible == 0 || copyVisible !== index + 1">
                      <div class="message-fotter-item">
                        <el-icon @click="() => copyMessageWithDocs(message, index)">
                          <CopyDocument />
                        </el-icon>
                      </div>
                    </el-tooltip>
                    <div class="message-fotter-item" v-else-if="copyVisible == index + 1"><el-icon>
                        <SuccessFilled />
                      </el-icon></div>
                    <el-tooltip effect="dark" content="刷新回复" placement="top-start">
                      <div class="message-fotter-item">
                        <el-icon @click="() => refreshMessage(index)"
                          :class="{ 'is-loading': refreshingMessages[`${index}_${message.id || ''}`] || isSending }">
                          <Refresh />
                        </el-icon>
                      </div>
                    </el-tooltip>

                    <!-- 点赞点踩按钮 -->
                    <div v-if="message.role === 'assistant' && message.id" class="reaction-buttons">
                      <el-tooltip effect="dark" :content="getReactionTooltip(message.id, 1)" placement="top">
                        <div class="message-fotter-item reaction-btn"
                          :class="{ 'active': getReactionState(message.id) === 1 }"
                          @click="handleReaction(message.id, 1)">
                          <el-icon>
                            <SuccessFilled v-if="getReactionState(message.id) === 1" />
                            <CircleCheck v-else />
                          </el-icon>
                        </div>
                      </el-tooltip>
                      <el-tooltip effect="dark" :content="getReactionTooltip(message.id, 2)" placement="top">
                        <div class="message-fotter-item reaction-btn"
                          :class="{ 'active': getReactionState(message.id) === 2 }"
                          @click="handleReaction(message.id, 2)">
                          <el-icon>
                            <CircleCloseFilled v-if="getReactionState(message.id) === 2" />
                            <CircleClose v-else />
                          </el-icon>
                        </div>
                      </el-tooltip>
                    </div>

                    <el-dropdown v-if="downloadWhiteList.includes(message.tool_name)" placement="top-start"
                      trigger="click" @command="(v) => getFileDownUrl(message.id, v)">
                      <div class="message-fotter-item">
                        <el-icon style="vertical-align: middle">
                          <Download />
                        </el-icon>
                      </div>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item
                            v-for="(item, index) in (message?.tool_name == 'DataAgent' ? ['PDF', 'Markdown', 'Xlsx'] : ['PDF', 'Markdown', 'Word'])"
                            :key="index" :command="item">{{ item }}</el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
                  <div v-if="message.role === 'assistant'" class="tip-text">{{ $t('common.Tip') }}</div>
              </div>
              <!-- 表格数据展示 -->
              <div v-else-if="message.tableHeaders" class="table-response">
                <el-table :data="message.content" border style="width: 100%">
                  <el-table-column v-for="header in message.tableHeaders" :key="header.prop" :prop="header.prop"
                    :label="header.label" align="center" />
                </el-table>
                <el-button @click="() => downloadFile(message?.upload_path)"
                  v-if="message?.status && message?.status == 'SUCCEEDED' && message?.upload_path && message?.upload_path !== ''"
                  type="primary">
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{ $t('chat.downloadURL') }}</span>
                </el-button>
                
                <!-- 基于 download_path 的下载按钮 -->
                <el-button @click="() => downloadFileDirect(message?.download_path)"
                  v-if="message?.download_path && message?.download_path !== ''"
                  type="primary" style="margin-left: 8px;">
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">下载文件</span>
                </el-button>

                <!-- 后续问题显示 -->
                <FollowUpQuestions
                  v-if="message.followUpQuestions && message.followUpQuestions.length > 0 && message.showFollowUpQuestions && index == currentChat.messages.length - 1"
                  :questions="message.followUpQuestions" @question-click="handleFollowUpQuestionClick" />
                <div class="message-fotter">
                  <el-tooltip effect="dark" :content="$t('chat.copy')" placement="top-start"
                    v-if="copyVisible == 0 || copyVisible !== index + 1">
                    <div class="message-fotter-item">
                      <el-icon @click="fallbackCopyText(message.original, index + 1)">
                        <CopyDocument />
                      </el-icon>
                    </div>
                  </el-tooltip>
                  <div class="message-fotter-item" v-else-if="copyVisible == index + 1">
                    <el-icon>
                      <SuccessFilled />
                    </el-icon>
                  </div>
                  <el-tooltip effect="dark" content="刷新回复" placement="top-start">
                    <div class="message-fotter-item">
                      <el-icon @click="() => refreshMessage(index)"
                        :class="{ 'is-loading': refreshingMessages[`${index}_${message.id || ''}`] || isSending }">
                        <Refresh />
                      </el-icon>
                    </div>
                  </el-tooltip>

                  <!-- 点赞点踩按钮 -->
                  <div v-if="message.role === 'assistant' && message.id" class="reaction-buttons">
                    <el-tooltip effect="dark" :content="getReactionTooltip(message.id, 1)" placement="top">
                      <div class="message-fotter-item reaction-btn"
                        :class="{ 'active': getReactionState(message.id) === 1 }"
                        @click="handleReaction(message.id, 1)">
                        <el-icon>
                          <SuccessFilled v-if="getReactionState(message.id) === 1" />
                          <CircleCheck v-else />
                        </el-icon>
                      </div>
                    </el-tooltip>
                    <el-tooltip effect="dark" :content="getReactionTooltip(message.id, 2)" placement="top">
                      <div class="message-fotter-item reaction-btn"
                        :class="{ 'active': getReactionState(message.id) === 2 }"
                        @click="handleReaction(message.id, 2)">
                        <el-icon>
                          <CircleCloseFilled v-if="getReactionState(message.id) === 2" />
                          <CircleClose v-else />
                        </el-icon>
                      </div>
                    </el-tooltip>
                  </div>

                  <el-dropdown v-if="downloadWhiteList.includes(message.tool_name)" placement="top-start"
                    trigger="click" @command="(v) => getFileDownUrl(message.id, v)">
                    <div class="message-fotter-item">
                      <el-icon style="vertical-align: middle">
                        <Download />
                      </el-icon>
                    </div>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item
                          v-for="(item, index) in (message?.tool_name == 'DataAgent' ? ['PDF', 'Markdown', 'Xlsx'] : ['PDF', 'Markdown', 'Word'])"
                          :key="index" :command="item">{{ item }}</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
              <!-- 有思考步骤的助手回答  暂时没有作用 2025/07/21-->
              <div v-else class="ai-response">
                <!-- 思考步骤 -->
                <div v-if="message.steps && message.steps.length > 0">
                  <div class="steps-title">
                    {{ $t('chat.stepResult') }}：
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
                  <MarkdownViewer
                    :instantMessage="(message?.instantMessage && currentChat.messages.length - 1 == index) || false"
                    :content="message.content" @finish="() => handleMarkdownFinish(index)" />
                </div>
                <el-button @click="() => downloadFile(message?.upload_path)"
                  v-if="message?.status && message?.status == 'SUCCEEDED' && message?.upload_path && message?.upload_path !== ''"
                  type="primary">
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{ $t('chat.downloadURL') }}</span>
                </el-button>
                
                <!-- 基于 download_path 的下载按钮 -->
                <el-button @click="() => downloadFileDirect(message?.download_path)"
                  v-if="message?.download_path && message?.download_path !== ''"
                  type="primary" style="margin-left: 8px;">
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">下载文件</span>
                </el-button>

                <!-- 后续问题显示 -->
                <FollowUpQuestions
                  v-if="message.followUpQuestions && message.followUpQuestions.length > 0 && message.showFollowUpQuestions && index == currentChat.messages.length - 1"
                  :questions="message.followUpQuestions" @question-click="handleFollowUpQuestionClick" />
                <div class="message-fotter">
                  <el-tooltip effect="dark" :content="$t('chat.copy')" placement="top-start"
                    v-if="copyVisible == 0 || copyVisible !== index + 1">
                    <div class="message-fotter-item">
                      <el-icon @click="() => copyMessageWithDocs(message, index)">
                        <CopyDocument />
                      </el-icon>
                    </div>
                  </el-tooltip>
                  <div class="message-fotter-item" v-else-if="copyVisible == index + 1">
                    <el-icon>
                      <SuccessFilled />
                    </el-icon>
                  </div>
                  <el-tooltip effect="dark" content="刷新回复" placement="top-start">
                    <div class="message-fotter-item">
                      <el-icon @click="() => refreshMessage(index)"
                        :class="{ 'is-loading': refreshingMessages[`${index}_${message.id || ''}`] }">
                        <Refresh />
                      </el-icon>
                    </div>
                  </el-tooltip>

                  <!-- 点赞点踩按钮 -->
                  <div v-if="message.role === 'assistant' && message.id" class="reaction-buttons">
                    <el-tooltip effect="dark" :content="getReactionTooltip(message.id, 1)" placement="top">
                      <div class="message-fotter-item reaction-btn"
                        :class="{ 'active': getReactionState(message.id) === 1 }"
                        @click="handleReaction(message.id, 1)">
                        <el-icon>
                          <SuccessFilled v-if="getReactionState(message.id) === 1" />
                          <CircleCheck v-else />
                        </el-icon>
                      </div>
                    </el-tooltip>
                    <el-tooltip effect="dark" :content="getReactionTooltip(message.id, 2)" placement="top">
                      <div class="message-fotter-item reaction-btn"
                        :class="{ 'active': getReactionState(message.id) === 2 }"
                        @click="handleReaction(message.id, 2)">
                        <el-icon>
                          <CircleCloseFilled v-if="getReactionState(message.id) === 2" />
                          <CircleClose v-else />
                        </el-icon>
                      </div>
                    </el-tooltip>
                  </div>

                  <el-dropdown v-if="downloadWhiteList.includes(message.tool_name)" placement="top-start"
                    trigger="click" @command="(v) => getFileDownUrl(message.id, v)">
                    <div class="message-fotter-item">
                      <el-icon style="vertical-align: middle">
                        <Download />
                      </el-icon>
                    </div>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item
                          v-for="(item, index) in (message?.tool_name == 'DataAgent' ? ['PDF', 'Markdown', 'Xlsx'] : ['PDF', 'Markdown', 'Word'])"
                          :key="index" :command="item">{{ item }}</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
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
              {{
                $t('chat.ladingInner')
              }}
              <div class="loading-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          </div>
        </div>



      </div>

      <!-- 输入区域 -->
      <div class="input-container" :style="{ bottom: currentChat?.messages?.length ? '2%' : '30%' }">
        <div v-if="!currentChat?.messages?.length" class="empty-chat">
          <div class="welcome-container">
            <!-- <h3>{{ $t('chat.welcome') }}</h3> -->
            <div class="welcome-container-text">
              <div class="welcome-container-text1"><img src="../../assets/images/chat/logo.png" class="logo"
                  alt="Logo" />{{
                    $t('chat.welcomeTitle') }}</div>
              <div class="welcome-container-text2">{{ $t('chat.welcomeSubtitle') }}</div>
            </div>
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
        <div class="input-container-warpper" :class="{ 'show-tutorial': showTutorial && currentTutorialStep === 3 }">
          <div class="input-box">
            <!-- 中止按钮 - 移到MentionSender外部，确保在发送时仍可点击 -->
            <div v-if="isSending" class="abort-button-overlay">
              <el-tooltip content="中止回答" placement="top">
                <el-button round color="#f56c6c" @click="abortCurrentRequest">
                  <el-icon>
                    <Close />
                  </el-icon>
                </el-button>
              </el-tooltip>
            </div>

            <MentionSender
              v-model="messageInput"
              ref="senderRef"
              :loading="isSending"
              :disabled="isSending"
              variant="updown"
              @submit="sendMessage"
              :auto-size="{ minRows: 2, maxRows: 5 }"
              clearable
              allow-speech
              :placeholder="$t('chat.inputPlaceholder', { symbol: '@' })"
              :options="rolesTool.map((x) => ({ value: x }))"
              :trigger-strings="['@']"
              trigger-split=","
              :whole="true"
              @select="handleSelect"
              @search="handleSearch"
              submit-type="enter"
            >
              <!-- 自定义 内容头部功能列表 -->
              <template #header>
                <div class="header-self-wrap">
                  <!-- 文件列表区域 - 只在发送前显示 -->
                  <div v-if="fileList.length > 0 && !isSending" class="file-list-container">
                    <div class="file-list">
                      <div v-for="(file, index) in fileList" :key="index" class="file-item">
                        <FilesCard :uid="index" :name="file.name" :file-size="file.size" :show-del-icon="true"
                          @delete="removeFile(index)" />
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <!-- 自定义 内容左下功能列表 -->
              <template #prefix>
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <el-upload ref="uploadRef" class="upload-demo" :limit="10" accept=".pdf,.doc,.xlsx,.ppt,.txt,.png"
                    :show-file-list="false" :auto-upload="false" :disabled="isSending" :on-change="handleFileChange"
                    multiple action="#">
                    <template #trigger>
                      <el-tooltip :content="$t('chat.uploadFile')" placement="top">
                        <el-button round plain color="#626aef">
                          <el-icon>
                            <Paperclip />
                          </el-icon>
                        </el-button>
                      </el-tooltip>
                    </template>
                  </el-upload>
                  <el-dropdown v-if="currentChat?.messages?.length" placement="top-start" trigger="click"
                    :disabled="isSending" @command="handleCommand">
                    <el-button round plain color="#626aef">
                      <el-icon>
                        <Menu />
                      </el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu v-if="rolesTool.length > 0">
                        <el-dropdown-item v-for="(item, index) in rolesTool" :key="index" :command="'@' + item + ','">{{
                          item }}</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </template>

              <!-- 自定义 内容右下功能列表 -->
              <template #action-list>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <!-- 发送按钮 -->
                  <div v-if="!messageInput.trim() || isSending" class="send-btn">
                    <el-tooltip :content="$t('chat.inputPlaceholderTip')" placement="top">
                      <el-button round color="#cbcdcd">
                        <el-icon>
                          <Promotion />
                        </el-icon>
                      </el-button>
                    </el-tooltip>
                  </div>
                  <div v-else class="send-btn" @click="sendMessage">
                    <el-button round color="#626aef">
                      <el-icon>
                        <Promotion />
                      </el-icon>
                    </el-button>
                  </div>
                </div>
              </template>

              <!-- 自定义 底部插槽 -->
              <template #footer>
                <div v-if="!currentChat?.messages?.length"
                  style="display: flex; align-items: center; justify-content: center; padding: 12px;">
                  <!-- 权限加载状态 -->
                  <div v-if="rolesLoading" class="roles-loading">
                    <el-icon class="is-loading">
                      <Loading />
                    </el-icon>
                    加载智能体权限中...
                  </div>
                  
                  <!-- 智能体按钮区域 -->
                  <template v-else-if="rolesTool.length > 0">
                    <div style="width: 100px; height: 50px; margin-right: 20px;cursor: pointer;" @click="showAgentsView"  >
                      <img src="/src/assets/images/chat/Agents.png" alt="Agents" style="width: 100%; height: 100%;">
                    </div>
                    <div class="input-actions">
                      <div v-for="(item, index) in rolesTool" :key="index" class="agent-item-wrapper">
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="agent-tooltip-content">
                              <p>{{ getAgentTooltip(item) }}</p>
                            </div>
                            <a class="more-button" @click="showMoreInfo(item)" :disabled="isSending">
                              {{ $t('chat.more') }}
                            </a>
                          </template>
                          <div class="agent-button" :class="{
                            'agent-button-active': activeButton === item
                          }" @click="handleButtonClick(item)"
                            :style="{ opacity: isSending ? 0.6 : 1, cursor: isSending ? 'not-allowed' : 'pointer' }">
                            {{ item }}
                          </div>
                        </el-tooltip>
                      </div>
                    </div>
                  </template>
                </div>
              </template>
            </MentionSender>
          </div>
        </div>
      </div>
      <div v-if="!currentChat?.messages?.length" class="input-container-bottom" 
        :class="{ 'show-tutorial': showTutorial && currentTutorialStep === 2 }"
        @wheel.prevent="handleScroll" :style="containerStyle">
        <div class="agent-list">
          <div class="agent-page">
            <div v-for="agent in presetAgents" :key="agent.id" class="input-container-bottom-item"
              @click="isSending ? null : handleAgentClick(agent)"
              :style="{ opacity: isSending ? 0.6 : 1, cursor: isSending ? 'not-allowed' : 'pointer' }">
              <span>{{ agent.name }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="chat-footer">{{ $t('chat.footer') }}</div>
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
            <el-icon>
              <Link />
            </el-icon>
            <a :href="link.url" target="_blank">{{ link.title }}</a>
          </div>
        </div>
      </div>
    </div>

    <!-- Agents架构图弹窗 -->
    <el-dialog
      v-model="agentsViewVisible"
      title="Phytomni智能体架构"
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      width="800px"
      center>
      <div class="agents-view-container">
        <img 
          src="/src/assets/images/chat/AgentsView.png" 
          alt="Phytomni智能体架构图" 
          class="agents-view-image"
          style="width: 800px; height: 400px; object-fit: contain;">
      </div>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref, nextTick, watch, computed } from 'vue';
import type { Ref } from 'vue';
import Sidebar from './sidebar.vue';
import { MentionSender } from 'vue-element-plus-x';
// import { MentionOption } from 'vue-element-plus-x';
import {
  Close as IconClose,
  Delete as IconDelete,
  Document,
  CopyDocument,
  SuccessFilled,
  Download,
  Menu,
  Loading,
  Refresh,
  Link,
  CircleCheck,
  CircleClose,
  CircleCloseFilled,
} from '@element-plus/icons-vue';
import { getAnswerCheck, getHistoryQuestionList, getQuery, getQueryAbortable, getChatdownloadURL, getFileDownUrlApi, getAnalystAgentLog, getReactionType, updateAnalystAgentLog } from '@/api/chat';
import { userStore } from '@/stores';
import LangSwitch from '@/components/LangSwitch.vue';
import { useI18n } from 'vue-i18n';
import type { UploadInstance } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Paperclip, ElementPlus, Promotion, Close } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router';
import MarkdownViewer from '@/components/MarkdownViewer.vue'
import DeepGenomeResultViewer from '@/components/DeepGenomeResultViewer.vue';
import type { MentionOption } from 'vue-element-plus-x/types/components/MentionSender/types';
import { useAppStore } from '@/stores';
import FollowUpQuestions from './FollowUpQuestions.vue';
import { FilesCard } from 'vue-element-plus-x';

// 后续问题显示逻辑已移至FollowUpQuestions组件

const uploadRef = ref<UploadInstance>()
const senderRef = ref();
const timestamp = ref(Date.now());

const submitUpload = () => {
  uploadRef.value!.submit()
}
const { t } = useI18n();
// 抽屉状态
const drawerVisible = ref(false);

// 左侧侧边栏状态
const leftSidebarCollapsed = ref(false);

// Agents架构图弹窗
const agentsViewVisible = ref(false);

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
  original?: string;
  tool_name?: string;
  isSending?: boolean; // 每个对话独立的发送状态
  messageInput?: string; // 每个对话独立的输入内容
  fileList?: UploadFile[]; // 每个对话独立的文件列表
  isFavorite: boolean; // 收藏状态
}

interface ChatMessage {
  role: string;
  content: any;
  id?: string;
  steps?: any[];
  doc_list?: any[];
  tableHeaders?: Array<{
    prop: string;
    label: string;
  }>;
  instantMessage?: boolean;
  status?: string;
  upload_path?: string;
  download_path?: string; // 下载路径
  original?: string;
  tool_name?: string;
  followUpQuestions?: string[]; // 后续问题列表
  showFollowUpQuestions?: boolean; // 是否显示后续问题
  showLog?: boolean;
  attachedFiles?: UploadFile[]; // 附件文件列表
  compute_resource?: string; // 计算资源信息
  task_id?: string; // 任务ID
  server_file_path?: string; // 服务器文件路径
}

interface ChatResponse {
  query: string;
  answer: string;
  id?: string;
  task_id?: string;
  tool_name?: string;
  status?: string;
  upload_path?: string;
  download_path?: string; // 下载路径
  steps?: any[];
  reaction_type?: string; // 添加点赞点踩状态字段
  compute_resource?: string; // 计算资源信息
  follow_up_questions?: string | string[]; // 后续问题列表
  server_file_path?: string; // 服务器文件路径
}

interface UploadFile {
  name: string;
  size: number;
  type: string;
  file: File;
}

const isMouseEnter = ref(false);
const handleMouseEnter = () => {
  isMouseEnter.value = true;
};
const handleMouseLeave = () => {
  isMouseEnter.value = false;
};

// 显示Agents架构图弹窗
const showAgentsView = () => {
  agentsViewVisible.value = true;
};

// 对话列表
const chatList = ref<Chat[]>([]);

// 修复：将静态引用改为计算属性，确保响应式更新
const rolesTool = computed(() => userStore().roles);
console.log(rolesTool.value, 'rolesTool');

// 添加权限加载状态管理
const rolesLoading = ref(false);

// 定义按钮权限映射关系
const buttonPermissions = {
  RAG: 'RAG',
  BI: 'BI',
  GA: 'GA',
  联网搜索: '联网搜索',
};
//下载显示白名单
const downloadWhiteList = ['ChatAgent', 'KnowledgeAgent', 'DataAgent', 'ReviewAgent'];

// 检查按钮权限
const hasButtonPermission = (buttonType: string) => {
  const permission =
    buttonPermissions[buttonType as keyof typeof buttonPermissions];
  return rolesTool.value.includes(permission);
};

// 当前激活的按钮
const activeButton = ref<string>();

const router = useRouter();

// 优化权限加载逻辑
const loadUserTools = async () => {
  if (!userStore().roles.length) {
    rolesLoading.value = true;
    try {
      await userStore().getUserTools();
      console.log('用户权限加载成功:', userStore().roles);
    } catch (error) {
      console.error('加载用户权限失败:', error);
    } finally {
      rolesLoading.value = false;
    }
  }
};

onMounted(async () => {
  // 先加载权限信息
  await loadUserTools();

  // 获取历史问题列表
  getHistoryQuestionData().then(() => {
    // 获取URL中的chatId
    const urlChatId = getChatIdFromUrl();

    // chatId 不存在默认为新对话
    if (urlChatId && chatList.value.length > 0) {
      // 查找是否存在对应的聊天
      const chatExists = chatList.value.find(chat => chat.dialogue_id === urlChatId);
      if (chatExists) {
        // 如果存在，选择该聊天
        selectChat(urlChatId);
      } else if (chatList.value.length > 0) {
        // 如果不存在但有聊天记录，更新URL为第一条聊天记录的ID
        const firstChatId = chatList.value[0].dialogue_id;
        updateUrlWithChatId(firstChatId);
        selectChat(firstChatId);
      }
    } else {
      // 如果没有聊天记录，创建一个新对话状态
      startNewChat();
    }
  });

  // 检查是否需要显示教学引导
  checkTutorialStatus();
  
  // 添加键盘事件监听器
  document.addEventListener('keydown', handleTutorialKeydown);
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
              title: item.title_query || item.query, // 优先使用 title_query，如果没有则使用 query
              date: item.created_at, // 保留原始时间字符串
              isFavorite: false, // 默认未收藏
            };
          });

          // 更新chatList，保持API返回的顺序
          chatList.value = formattedData;

          // 如果当前有新对话状态，尝试将其与API返回的数据关联
          if (currentChatId.value && currentChatId.value.startsWith('new_')) {
            // 查找是否有新创建的对话（通过比较用户消息内容）
            const currentUserMessage = currentChat.value?.messages?.find((msg: ChatMessage) => msg.role === 'user');
            if (currentUserMessage) {
              const matchingChat = formattedData.find((chat: Chat) => {
                // 比较对话标题与用户消息内容
                return chat.title === currentUserMessage.content ||
                  chat.title.includes(currentUserMessage.content.substring(0, 20)) ||
                  currentUserMessage.content.includes(chat.title.substring(0, 20));
              });

              if (matchingChat) {
                // 找到匹配的对话，更新当前对话ID
                currentChatId.value = matchingChat.dialogue_id;
                updateUrlWithChatId(matchingChat.dialogue_id);
                console.log('新对话已关联到现有对话:', matchingChat.dialogue_id);
              }
            }
          }
        }
        resolve();
      })
      .catch((err: any) => {
        console.error('获取历史问题数据失败:', err);
        resolve();
      });
  });
};

// 当前选中的对话
const currentChatId = ref('');
const currentChat: Ref<any> = ref(null);

// 中止请求相关
const currentRequestId = ref<string>('');
const isAborted = ref(false);

// 所有对话的状态管理
const chatStates = ref<Record<string, {
  isSending: boolean;
  messageInput: string;
  fileList: UploadFile[];
  historyQuestion: any;
  copyVisible: number;
  copyTimeRef: ReturnType<typeof setTimeout> | undefined;
  logData: Record<string, any>;
  loadingLog: Record<string, boolean>;
  refreshingMessages: Record<string, boolean>;
  reactions: Record<string, number>; // 添加点赞点踩状态
  updatingLog: Record<string, boolean>; // 添加更新日志状态
}>>({});

// 获取或创建对话状态
const getChatState = (dialogueId: string) => {
  if (!chatStates.value[dialogueId]) {
    chatStates.value[dialogueId] = {
      isSending: false,
      messageInput: '',
      fileList: [],
      historyQuestion: null,
      copyVisible: 0,
      copyTimeRef: undefined,
      logData: {},
      loadingLog: {},
      refreshingMessages: {},
      reactions: {}, // 初始化点赞点踩状态
      updatingLog: {}, // 初始化更新日志状态
    };
  }
  return chatStates.value[dialogueId];
};

// 开始新对话
const startNewChat = () => {
  // 创建新对话的状态
  const newDialogueId = 'new_' + Date.now();
  getChatState(newDialogueId);

  // 设置当前对话ID为新创建的ID
  currentChatId.value = newDialogueId;
  currentChat.value = { messages: [] };

  // 移除URL中的id参数
  const url = new URL(window.location.href);
  url.searchParams.delete('dialogue_id');
  window.history.pushState({}, '', url.toString());

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });
};

// 处理按钮点击
const handleButtonClick = (buttonType: string) => {
  // 如果正在发送或刷新，阻止操作
  if (isSending.value) return;

  // 如果点击的是当前已选中的按钮，则取消选中
  if (activeButton.value === buttonType) {
    activeButton.value = '';
    // 从输入框中移除对应的 @tool, 标记
    const command = '@' + buttonType + ',';
    messageInput.value = messageInput.value.replace(command, '');
    return;
  }

  // 如果之前有其他按钮被选中，先移除
  if (activeButton.value) {
    const oldCommand = '@' + activeButton.value + ',';
    messageInput.value = messageInput.value.replace(oldCommand, '');
  }

  // 设置新的选中按钮
  activeButton.value = buttonType;
  const command = '@' + buttonType + ',';
  const newMessageValue = extractAtValues(messageInput.value);
  messageInput.value = `${command}${newMessageValue.cleanedText}`;

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });
};

const updateCopyIconHandler = (index: number, delay = 3000,) => {
  copyVisible.value = index;
  if (copyTimeRef.value) {
    clearTimeout(copyTimeRef.value);
  }
  copyTimeRef.value = setTimeout(() => {
    copyVisible.value = 0;
  }, delay);
};

//copy复制对话
const textAreaCopyCore = (text: any, index: number) => {
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

const fallbackCopyText = (text: any, index: number) => {
  try {
    if (window.isSecureContext) {
      navigator.clipboard.writeText(text);
      updateCopyIconHandler(index);
      ElMessage.success(t('chat.copySuccess'));
    } else {
      textAreaCopyCore(text, index);
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
const downloadFile = async (url: string) => {
  // 在这里调用 getChatdownloadURL 接口 获取下载链接
  const res = await getChatdownloadURL({ obs_path: url });
  if (res.code == 200) {
    window.open(res.data, "_blank", 'noopener,noreferrer')
  }
}

// 直接下载文件（基于 download_path）
const downloadFileDirect = (downloadPath: string) => {
  if (downloadPath) {
    window.open(downloadPath, "_blank", 'noopener,noreferrer')
  }
}

// 下载对话转换后的文件接链接
const getFileDownUrl = async (id: string, type: string) => {
  // 在这里调用 getFileDownUrlApi 接口 获取下载链接
  const queryData = new FormData();
  queryData.append('document_format', type);
  queryData.append('id', (id ? Number(id) : 0).toString());
  try {
    const response = await getFileDownUrlApi(queryData);
    // 从响应头中提取文件名
    const contentDisposition = response.headers['content-disposition'];
    let fileName = "default_filename"; // 默认文件名
    if (contentDisposition) {
      const fileNameMatch = contentDisposition.match(/filename="?(.+?)"?(;|$)/i);
      if (fileNameMatch && fileNameMatch[1]) {
        fileName = fileNameMatch[1];
      }
    }
    const blob = new Blob([response.data], { type: response.headers['content-type'] });

    // 创建下载链接
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName; // 设置下载文件名
    document.body.appendChild(link);
    link.click();

    // 清理资源
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(link);
  } catch (error) {
    console.error('下载文件失败:', error);
  }
};

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

// 判断字符串是否为有效的JSON
const isValidJSON = (str: string): boolean => {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
};

// 解析消息内容，提取文件信息
const parseMessageWithFiles = (messageContent: string) => {
  // 检查是否包含文件信息标记
  const fileInfoRegex = /\[附件: ([^\]]+)\]/g;
  const fileMatches = messageContent.match(fileInfoRegex);

  if (!fileMatches || fileMatches.length === 0) {
    return {
      content: messageContent,
      attachedFiles: undefined
    };
  }

  // 提取文件信息
  const attachedFiles: UploadFile[] = [];
  fileMatches.forEach(match => {
    const fileInfo = match.match(/\[附件: ([^(]+) \(([^)]+)\)\]/);
    if (fileInfo) {
      const fileName = fileInfo[1].trim();
      const fileSizeStr = fileInfo[2].trim();

      // 解析文件大小
      let fileSize = 0;
      if (fileSizeStr.includes('KB')) {
        fileSize = parseFloat(fileSizeStr) * 1024;
      } else if (fileSizeStr.includes('MB')) {
        fileSize = parseFloat(fileSizeStr) * 1024 * 1024;
      } else if (fileSizeStr.includes('B')) {
        fileSize = parseFloat(fileSizeStr);
      }

      attachedFiles.push({
        name: fileName,
        size: fileSize,
        type: '', // 历史记录中无法获取文件类型
        file: null as any // 历史记录中无法获取文件对象
      });
    }
  });

  // 移除文件信息标记，获取纯文本内容
  const cleanContent = messageContent.replace(fileInfoRegex, '').trim();

  return {
    content: cleanContent,
    attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined
  };
};

// 选择对话
const selectChat = async (dialogueId: string) => {
  currentChatId.value = dialogueId;
  const chat = chatList.value.find((c: Chat) => c.dialogue_id === dialogueId);

  // 确保对话状态存在
  getChatState(dialogueId);

  // 在这里调用 getAnswerCheck 接口 获取对话记录
  const res = await getAnswerCheck({ dialogue_id: dialogueId });
  console.log(res, 'res');

  if (res.code === 200) {
    // 处理返回的数据，转换为消息格式
    const messages: ChatMessage[] = [];
    const historyMessages: ChatMessage[] = [];
    const chatState = getChatState(dialogueId);
    if (!chatState) return;
    chatState.historyQuestion = null;

    // 初始化点赞点踩状态
    chatState.reactions = {};

    // 遍历返回的数组，转换为消息格式
    if (res.data && Array.isArray(res.data)) {
      res.data.forEach((item: ChatResponse) => {
        console.log('tool_name:', item.tool_name === 'AnalystAgent');

        // 同步服务器返回的点赞点踩状态
        if (item.id && item.reaction_type) {
          chatState.reactions[item.id.toString()] = parseInt(item.reaction_type);
        }

        // 添加用户消息
        if (item.query) {
          // 解析消息内容，提取文件信息
          const { content, attachedFiles } = parseMessageWithFiles(item.query);

          messages.push({
            role: 'user',
            content: content,
            attachedFiles: attachedFiles,
          });
          historyMessages.push({
            role: 'user',
            content: content,
          });
        }

        // 添加助手消息
        if (item.answer) {
          try {

            const answerData = isValidJSON(item.answer) ? JSON.parse(item.answer) : item.answer;
            if (answerData.final_answer) {
              messages.push({
                role: 'assistant',
                content: answerData.final_answer,
                steps: answerData.steps || [],
                status: item?.status || '',
                upload_path: item?.upload_path || '',
                download_path: item?.download_path || '',
                id: item.id,
                tool_name: item.tool_name,
                followUpQuestions: item.follow_up_questions ? (typeof item.follow_up_questions === 'string' ? JSON.parse(item.follow_up_questions) : item.follow_up_questions) : [],
                showFollowUpQuestions: true, // 历史消息默认显示后续问题
                showLog: false,
                instantMessage: false,
              });
              historyMessages.push({
                role: 'assistant',
                content: answerData.final_answer,
              });
            } else {
              if (item.tool_name === 'ChatAgents' || item.tool_name === 'ChatAgent') {
                messages.push({
                  role: 'assistant',
                  content: item.answer,
                  steps: [],
                  status: item?.status || '',
                  upload_path: item?.upload_path || '',
                  download_path: item?.download_path || '',
                  id: item.id,
                  tool_name: item.tool_name,
                  followUpQuestions: item.follow_up_questions ? (typeof item.follow_up_questions === 'string' ? JSON.parse(item.follow_up_questions) : item.follow_up_questions) : [],
                  showFollowUpQuestions: true, // 历史消息默认显示后续问题
                  showLog: false,
                  instantMessage: false,
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              } else if (item.tool_name === 'KnowledgeAgents' || item.tool_name === 'ReviewAgents' || item.tool_name === 'KnowledgeAgent' || item.tool_name === 'ReviewAgent') {
                const contentData = isValidJSON(item.answer) ? JSON.parse(item.answer) : item.answer;
                // 打印 doc_list 数据
                console.log('=== 历史消息 doc_list ===', {
                  tool_name: item.tool_name,
                  message_id: item.id,
                  doc_list: contentData.doc_list,
                  content: contentData.content
                });
                messages.push({
                  role: 'assistant',
                  content: contentData.content,
                  doc_list: contentData.doc_list,
                  status: item?.status || '',
                  upload_path: item?.upload_path || '',
                  download_path: item?.download_path || '',
                  id: item.id,
                  tool_name: item.tool_name,
                  followUpQuestions: item.follow_up_questions ? (typeof item.follow_up_questions === 'string' ? JSON.parse(item.follow_up_questions) : item.follow_up_questions) : [],
                  showFollowUpQuestions: true, // 历史消息默认显示后续问题
                  showLog: false,
                  instantMessage: false,
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              } else if (item.tool_name === 'DatabaseAgents' || item.tool_name === 'DataAgent') {
                const contentData = isValidJSON(item.answer) ? JSON.parse(item.answer) : item.answer;
                const tableData = convertToTableData(contentData);
                messages.push({
                  role: 'assistant',
                  content: tableData,
                  tableHeaders: contentData.headers.map((header: string) => ({
                    prop: header.replace(/\s+/g, '_').toLowerCase(),
                    label: header,
                  })),
                  status: item?.status || '',
                  upload_path: item?.upload_path || '',
                  download_path: item?.download_path || '',
                  original: item.answer,
                  id: item.id,
                  tool_name: item.tool_name,
                  followUpQuestions: item.follow_up_questions ? (typeof item.follow_up_questions === 'string' ? JSON.parse(item.follow_up_questions) : item.follow_up_questions) : [],
                  showFollowUpQuestions: true, // 历史消息默认显示后续问题
                  showLog: false,
                  instantMessage: false,
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              } else if (item.tool_name === 'AnalystAgent') {
                console.log(item, 'item.id');
                getAnalystAgentLog({ id: item.id || '' }).then((res: any) => {
                  console.log(res, 'res1111111111111111111');
                })
                messages.push({
                  role: 'assistant',
                  content: item.answer,
                  status: item?.status || '',
                  upload_path: item?.upload_path || '',
                  download_path: item?.download_path || '',
                  id: item.id,
                  task_id: item.task_id,
                  tool_name: item.tool_name,
                  followUpQuestions: item.follow_up_questions ? (typeof item.follow_up_questions === 'string' ? JSON.parse(item.follow_up_questions) : item.follow_up_questions) : [],
                  showFollowUpQuestions: true, // 历史消息默认显示后续问题
                  showLog: false,
                  instantMessage: false,
                  compute_resource: item?.compute_resource || '',
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
                  status: item?.status || '',
                  upload_path: item?.upload_path || '',
                  download_path: item?.download_path || '',
                  id: item.id,
                  task_id: item.task_id,
                  tool_name: item.tool_name,
                  followUpQuestions: item.follow_up_questions ? (typeof item.follow_up_questions === 'string' ? JSON.parse(item.follow_up_questions) : item.follow_up_questions) : [],
                  showFollowUpQuestions: true, // 历史消息默认显示后续问题
                  showLog: false,
                  instantMessage: false,
                });
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              } else if (item.tool_name === 'DeepGenomeAgent') {
                const contentData = isValidJSON(item.answer) ? JSON.parse(item.answer) : item.answer;
                
                // 创建消息对象
                const deepGenomeMessage = {
                  role: 'assistant',
                  content: contentData?.content || item.answer,
                  doc_list: contentData?.doc_list,
                  status: item?.status || '',
                  upload_path: item?.upload_path || '',
                  id: item.id,
                  task_id: item.task_id,
                  tool_name: item.tool_name,
                  followUpQuestions: item.follow_up_questions ? (typeof item.follow_up_questions === 'string' ? JSON.parse(item.follow_up_questions) : item.follow_up_questions) : [],
                  showFollowUpQuestions: true, // 历史消息默认显示后续问题
                  instantMessage: false,
                  server_file_path: item.server_file_path, // 添加服务器文件路径
                };

                // 如果有服务器文件路径，异步读取文件内容
                if (item.server_file_path) {
                  // 先显示加载状态
                  deepGenomeMessage.content = '正在加载文件内容...';
                  
                  readServerFile(item.server_file_path).then(fileContent => {
                    console.log(fileContent, 'fileContent');
                    
                    if (fileContent && fileContent.trim()) {
                      deepGenomeMessage.content = fileContent;
                    } else {
                      deepGenomeMessage.content = '文件内容为空或加载失败';
                    }
                    // 强制更新视图
                    nextTick(() => {
                      timestamp.value = Date.now();
                      scrollToBottom();
                    });
                  }).catch(error => {
                    console.error('读取DeepGenomeAgent文件失败:', error);
                    deepGenomeMessage.content = '文件加载失败，请稍后重试';
                    // 强制更新视图
                    nextTick(() => {
                      timestamp.value = Date.now();
                        scrollToBottom();
                    });
                  });
                }
                
                messages.push(deepGenomeMessage);
                historyMessages.push({
                  role: 'assistant',
                  content: item.answer,
                });
              } else {
                messages.push({
                  role: 'assistant',
                  content: item.answer,
                  status: item?.status || '',
                  upload_path: item?.upload_path || '',
                  download_path: item?.download_path || '',
                  id: item?.id || '',
                  task_id: item.task_id,
                  tool_name: item?.tool_name || '',
                  followUpQuestions: item.follow_up_questions ? (typeof item.follow_up_questions === 'string' ? JSON.parse(item.follow_up_questions) : item.follow_up_questions) : [],
                  showFollowUpQuestions: true, // 历史消息默认显示后续问题
                  instantMessage: false,
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
              status: item?.status || '',
              upload_path: item?.upload_path || '',
              download_path: item?.download_path || '',
              id: item?.id || '',
              task_id: item.task_id,
              tool_name: item.tool_name || '',
              followUpQuestions: item.follow_up_questions ? (typeof item.follow_up_questions === 'string' ? JSON.parse(item.follow_up_questions) : item.follow_up_questions) : [],
              showFollowUpQuestions: true, // 历史消息默认显示后续问题
              showLog: false,
              instantMessage: false,
            });
            historyMessages.push({
              role: 'assistant',
              content: item.answer,
            });
            timestamp.value = Date.now();
          }
        }
      });
    }

    chatState.historyQuestion = historyMessages;
    // 更新当前对话的消息
    currentChat.value = {
      ...chat,
      messages: messages,
    };

    // 自动滚动到最新对话
    if (messages.length > 0) {
      await scrollToBottom();
    }
  }
  updateUrlWithChatId(dialogueId);
};

// 输入框内容 - 现在基于当前对话
const messageInput = computed({
  get: () => {
    if (!currentChatId.value) return '';
    const chatState = getChatState(currentChatId.value);
    return chatState ? chatState.messageInput : '';
  },
  set: (value: string) => {
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (chatState) {
      chatState.messageInput = value;
    }
  }
});

// 发送消息的加载状态 - 现在基于当前对话
const isSending = computed({
  get: () => {
    if (!currentChatId.value) return false;
    const chatState = getChatState(currentChatId.value);
    return chatState ? chatState.isSending : false;
  },
  set: (value: boolean) => {
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (chatState) {
      chatState.isSending = value;
    }
  }
});

// 文件列表 - 现在基于当前对话
const fileList = computed({
  get: () => {
    if (!currentChatId.value) return [];
    const chatState = getChatState(currentChatId.value);
    return chatState ? chatState.fileList : [];
  },
  set: (value: UploadFile[]) => {
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (chatState) {
      chatState.fileList = value;
    }
  }
});

// 监听文件列表 控制列表显示
watch(() => fileList.value, (newVal, oldVal) => {
  console.log('文件列表变化:', { newVal, oldVal, senderRef: !!senderRef.value });
  if (newVal?.length > 0 && senderRef.value) {
    console.log('打开header，文件数量:', newVal.length);
    senderRef.value.openHeader();
  } else if (senderRef.value) {
    console.log('关闭header');
    senderRef.value.closeHeader();
  }
});

// 复制状态 - 现在基于当前对话
const copyVisible = computed({
  get: () => {
    if (!currentChatId.value) return 0;
    const chatState = getChatState(currentChatId.value);
    return chatState ? chatState.copyVisible : 0;
  },
  set: (value: number) => {
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (chatState) {
      chatState.copyVisible = value;
    }
  }
});

const copyTimeRef = computed({
  get: () => {
    if (!currentChatId.value) return undefined;
    const chatState = getChatState(currentChatId.value);
    return chatState ? chatState.copyTimeRef : undefined;
  },
  set: (value: ReturnType<typeof setTimeout> | undefined) => {
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (chatState) {
      chatState.copyTimeRef = value;
    }
  }
});

// 日志状态管理 - 现在基于当前对话
const logData = computed({
  get: () => {
    if (!currentChatId.value) return {};
    const chatState = getChatState(currentChatId.value);
    return chatState ? chatState.logData : {};
  },
  set: (value: Record<string, any>) => {
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (chatState) {
      chatState.logData = value;
    }
  }
});

const loadingLog = computed({
  get: () => {
    if (!currentChatId.value) return {};
    const chatState = getChatState(currentChatId.value);
    return chatState ? chatState.loadingLog : {};
  },
  set: (value: Record<string, boolean>) => {
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (chatState) {
      chatState.loadingLog = value;
    }
  }
});

// 刷新状态管理 - 现在基于当前对话
const refreshingMessages = computed({
  get: () => {
    if (!currentChatId.value) return {};
    const chatState = getChatState(currentChatId.value);
    return chatState ? chatState.refreshingMessages : {};
  },
  set: (value: Record<string, boolean>) => {
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (chatState) {
      chatState.refreshingMessages = value;
    }
  }
});

// 历史问题 - 现在基于当前对话
const historyQuestion = computed({
  get: () => {
    if (!currentChatId.value) return null;
    const chatState = getChatState(currentChatId.value);
    return chatState ? chatState.historyQuestion : null;
  },
  set: (value: any) => {
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (chatState) {
      chatState.historyQuestion = value;
    }
  }
});

// 消息容器引用，用于自动滚动
const messageContainer = ref<HTMLElement | null>(null);

// 自动滚动到最新消息
const scrollToBottom = async () => {
  await nextTick();
  if (messageContainer.value) {
    messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
  }
};

// 监听输入内容
watch(messageInput, newVal => {
  if (activeButton.value && currentChatId.value) {
    const command = '@' + activeButton.value + ',';
    const newMessageValue = extractAtValues(newVal);
    const contains = newVal.includes(command);
    if (!contains) {
      activeButton.value = ''
    } else {
      messageInput.value = `${command}${newMessageValue.cleanedText}`;
    }
  }
});

// 发送消息
const sendMessage = async () => {
  if (!currentChatId.value) return;

  const chatState = getChatState(currentChatId.value);
  if (!chatState || !chatState.messageInput.trim() || chatState.isSending) return;

  const newMessageValue = extractAtValues(chatState.messageInput);
  const currentMessage = newMessageValue.cleanedText;
  if (!currentMessage.trim()) return;

  chatState.isSending = true;
  chatState.messageInput = '';

  const isNewChat = !currentChat.value?.messages || currentChat.value.messages.length === 0;
  if (isNewChat) currentChat.value = { messages: [] };

  // 创建用户消息，包含附件文件信息
  const userMessage = {
    role: 'user',
    content: currentMessage,
    attachedFiles: chatState.fileList.length > 0 ? [...chatState.fileList] : undefined
  };

  // 将文件信息添加到消息内容中，确保能保存在历史记录中
  let messageContent = currentMessage;
  if (chatState.fileList.length > 0) {
    const fileInfo = chatState.fileList.map(file => `[附件: ${file.name} (${formatFileSize(file.size)})]`).join('\n');
    messageContent = `${currentMessage}\n\n${fileInfo}`;
  }

  // 更新用户消息内容，包含文件信息
  userMessage.content = messageContent;

  currentChat.value.messages.push(userMessage);

  await scrollToBottom();

  try {
    const urlChatId = getDialogueIdFromChatId();
    const queryData = new FormData();
    queryData.append('query', messageContent); // 使用包含文件信息的消息内容
    queryData.append('id', (urlChatId ? Number(urlChatId) : 0).toString());
    queryData.append('tool', newMessageValue.matches.length > 0 ? newMessageValue.matches.join(',') : '');
    if (chatState.historyQuestion) {
      queryData.append('history', JSON.stringify(chatState.historyQuestion));
    }
    if (chatState.fileList.length > 0) {
      chatState.fileList.forEach(fileItem => {
        queryData.append('files', fileItem.file);
      });
    }

    // 生成请求ID
    currentRequestId.value = Date.now().toString();
    
    const response = await getQueryAbortable(queryData as any, currentRequestId.value);
    console.log('response', response.data);

          if (response.data) {
        let assistantMessage: ChatMessage | undefined;
        if (response.data.final_answer) {
        assistantMessage = {
          role: 'assistant',
          content: response.data.final_answer || '抱歉，我无法回答这个问题。',
          steps: response.data.steps || [],
          status: response.data?.status || '',
          upload_path: response.data?.upload_path || '',
          instantMessage: true,
          id: response.data.id,
          followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
          showFollowUpQuestions: false,
          showLog: false,
        };

        // 同步新消息的点赞状态
        if (response.data.id && response.data.reaction_type) {
          chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
        }
      } else {
        if (response.data.tool_name) {
          if (response.data.tool_name === 'ChatAgents' || response.data === 'ChatAgent') {
            assistantMessage = {
              role: 'assistant',
              content: response.data.answer,
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
            };

            // 同步新消息的点赞状态
            if (response.data.id && response.data.reaction_type) {
              chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
            }
          } else if (response.data.tool_name === 'DeepGenomeAgent') {
            const contentData = isValidJSON(response.data.answer) ? JSON.parse(response.data.answer) : response.data.answer;
            assistantMessage = {
              role: 'assistant',
              content: contentData?.content || response.data.answer,
              doc_list: contentData?.doc_list,
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
              server_file_path: response.data.server_file_path, // 添加服务器文件路径
            };

            // 如果有服务器文件路径，异步读取文件内容
            if (response.data.server_file_path) {
              // 先显示加载状态
              if (assistantMessage) {
                assistantMessage.content = '正在加载文件内容...';
              }
              
              readServerFile(response.data.server_file_path).then(fileContent => {
                if (fileContent && fileContent.trim() && assistantMessage) {
                  assistantMessage.content = fileContent;
                } else if (assistantMessage) {
                  assistantMessage.content = '文件内容为空或加载失败';
                }
                // 强制更新视图
                nextTick(() => {
                  timestamp.value = Date.now();
                  scrollToBottom();
                });
              }).catch(error => {
                console.error('读取DeepGenomeAgent文件失败:', error);
                if (assistantMessage) {
                  assistantMessage.content = '文件加载失败，请稍后重试';
                }
                // 强制更新视图
                nextTick(() => {
                  timestamp.value = Date.now();
                  scrollToBottom();
                });
              });
            }

            // 同步新消息的点赞状态
            if (response.data.id && response.data.reaction_type) {
              chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
            }
          } else if (response.data.tool_name === 'KnowledgeAgents' || response.data.tool_name === 'ReviewAgents' || response.data.tool_name === 'KnowledgeAgent' || response.data.tool_name === 'ReviewAgent') {
            const contentData = isValidJSON(response.data.answer) ? JSON.parse(response.data.answer) : response.data.answer;
            // 打印新消息的 doc_list 数据
            console.log('=== 新消息 doc_list ===', {
              tool_name: response.data.tool_name,
              message_id: response.data.id,
              doc_list: contentData.doc_list,
              content: contentData.content
            });
            assistantMessage = {
              role: 'assistant',
              content: contentData.content,
              doc_list: contentData.doc_list,
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
            };

            // 同步新消息的点赞状态
            if (response.data.id && response.data.reaction_type) {
              chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
            }
          } else if (response.data.tool_name === 'DatabaseAgents' || response.data.tool_name === 'DataAgent') {
            const contentData = isValidJSON(response.data.answer) ? JSON.parse(response.data.answer) : response.data.answer;
            const tableData = convertToTableData(contentData);
            assistantMessage = {
              role: 'assistant',
              content: tableData,
              tableHeaders: contentData.headers.map((header: string) => ({
                prop: header.replace(/\s+/g, '_').toLowerCase(),
                label: header,
              })),
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              original: response.data.answer,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
            };

            // 同步新消息的点赞状态
            if (response.data.id && response.data.reaction_type) {
              chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
            }
          } else if (response.data.tool_name === 'AnalysisAgents') {
            const contentData = isValidJSON(response.data.answer) ? JSON.parse(response.data.answer) : response.data.answer;
            const tableData = convertToTableData(contentData);
            assistantMessage = {
              role: 'assistant',
              content: '任务执行中，请等待',
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
            };

            // 同步新消息的点赞状态
            if (response.data.id && response.data.reaction_type) {
              chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
            }
          } else if (response.data.tool_name === 'AnalystAgent') {
            getAnalystAgentLog({ id: response.data.id }).then((res: any) => {
              console.log(res, 'res1111111111111111111');
            })
            assistantMessage = {
              role: 'assistant',
              content: response.data.answer,
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
              compute_resource: response.data?.compute_resource || '',
            };

            // 同步新消息的点赞状态
            if (response.data.id && response.data.reaction_type) {
              chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
            }
          }
        } else {
          assistantMessage = {
            role: 'assistant',
            content: response.data.answer,
            status: response.data?.status || '',
            upload_path: response.data?.upload_path || '',
            download_path: response.data?.download_path || '',
            instantMessage: true,
            tool_name: response.data?.tool_name || '',
            id: response.data.id,
            followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
            showFollowUpQuestions: false,
            showLog: false,
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
        upload_path: '',
        download_path: '',
        instantMessage: true,
        tool_name: response.data?.tool_name || '',
        followUpQuestions: [],
        showFollowUpQuestions: false,
        showLog: false,
      });
    }
  } catch (error: any) {
    console.error(t('chat.logs.sendMessageFailed'), error);
    
    // 检查是否是请求被中止
    if (error.name === 'AbortError' || error.code === 'ERR_CANCELED' || isAborted.value) {
      console.log('请求已被中止');
      return; // 中止请求时不显示错误消息
    }
    
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
              document.cookie.split(";").forEach(function (c) {
                document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
              });
              location.href = '/login';
            });
          }
        }
      );
      return;
    }
    
    // 只有在未被中止的情况下才添加错误消息
    if (!isAborted.value) {
      console.log(isAborted.value,'添加错误消息');
      
      currentChat.value.messages.push({
        role: 'assistant',
        content: t('chat.sendFailed'),
        steps: [],
        status: '',
        upload_path: '',
        download_path: '',
        instantMessage: true,
        tool_name: '',
        followUpQuestions: [],
        showFollowUpQuestions: false,
        showLog: false,
      });
    }
  } finally {
    // 清理请求ID
    currentRequestId.value = '';
    
    // 无论是否是新对话，都刷新侧边栏历史记录数据
    await getHistoryQuestionData();

    if (isNewChat) {
      // 如果是新对话，选择新创建的对话
      if (chatList.value.length > 0) {
        const newChat = chatList.value[0];
        currentChatId.value = newChat.dialogue_id;
        updateUrlWithChatId(newChat.dialogue_id);
      }
    } else {
      // 如果是已存在的对话，更新当前对话的标题（如果发生了变化）
      if (currentChat.value?.messages && currentChat.value.messages.length > 0) {
        const userMessage = currentChat.value.messages[currentChat.value.messages.length - 2]; // 倒数第二条是用户消息
        if (userMessage && userMessage.role === 'user') {
          // 查找当前对话在列表中的位置并更新标题
          const currentChatIndex = chatList.value.findIndex(chat => chat.dialogue_id === currentChatId.value);
          if (currentChatIndex !== -1) {
            // 截取用户消息内容作为标题（限制长度）
            const newTitle = userMessage.content.length > 50
              ? userMessage.content.substring(0, 50) + '...'
              : userMessage.content;
            chatList.value[currentChatIndex].title = newTitle;
          }
        }
      }
    }

    // 清空文件列表
    if (chatState.fileList.length > 0) {
      chatState.fileList = [];
      // 确保文件列表清空后关闭header
      nextTick(() => {
        if (senderRef.value) {
          senderRef.value.closeHeader();
        }
      });
    }

    chatState.isSending = false;

    await scrollToBottom();
  }
};

// 中止当前请求
const abortCurrentRequest = async () => {
  if (!currentRequestId.value) return;
  
  try {
    // 导入中止请求的方法
    const requestModule = await import('@/utils/request') as any;
    const success = requestModule.abortRequest(currentRequestId.value);
    console.log(success,'success11111111111111');
    if (success) {
      isAborted.value = true;
      
      // 添加中止消息
      if (currentChat.value?.messages) {
        const abortMessage: ChatMessage = {
          role: 'assistant',
          content: t('chat.generationStopped'),
          instantMessage: true,
          id: Date.now().toString(),
        };
        currentChat.value.messages.push(abortMessage);
      }
      
      // 重置状态
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.isSending = false;
      }
      
      currentRequestId.value = '';
      // isAborted.value = false;
      
      await scrollToBottom();
    }
  } catch (error) {
    console.error('中止请求失败:', error);
  }
};

// 使用预设问题
const usePrompt = (prompt: string) => {
  if (isSending.value) return;
  messageInput.value = prompt;

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });

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
  console.log('文件上传事件:', file);

  if (!currentChatId.value) {
    console.log('当前对话ID不存在');
    return;
  }

  const chatState = getChatState(currentChatId.value);
  if (!chatState) {
    console.log('聊天状态不存在');
    return;
  }

  const newFile: UploadFile = {
    name: file.name,
    size: file.size,
    type: file.type,
    file: file.raw
  };

  console.log('添加新文件:', newFile);
  console.log('更新前文件列表:', chatState.fileList);

  // 使用响应式更新方式
  chatState.fileList = [...chatState.fileList, newFile];

  console.log('更新后文件列表:', chatState.fileList);
  console.log('计算属性fileList.value:', fileList.value);

  // 确保文件列表更新后立即显示
  nextTick(() => {
    console.log('nextTick中的状态:', {
      senderRef: !!senderRef.value,
      fileListLength: chatState.fileList.length,
      computedFileListLength: fileList.value.length
    });

    if (senderRef.value && chatState.fileList.length > 0) {
      console.log('调用openHeader');
      senderRef.value.openHeader();
    }

    // 确保滚动到底部
    scrollToBottom();
  });
};

const removeFile = (index: number) => {
  if (!currentChatId.value) return;

  const chatState = getChatState(currentChatId.value);
  if (!chatState) return;

  // 使用响应式更新方式
  const newFileList = [...chatState.fileList];
  newFileList.splice(index, 1);
  chatState.fileList = newFileList;

  // 如果文件列表为空，关闭header
  nextTick(() => {
    if (senderRef.value && chatState.fileList.length === 0) {
      senderRef.value.closeHeader();
    }

    // 确保滚动到底部
    scrollToBottom();
  });
};

const clearFiles = () => {
  if (!currentChatId.value) return;

  const chatState = getChatState(currentChatId.value);
  if (!chatState) return;

  chatState.fileList = [];

  // 确保文件列表清空后关闭header
  nextTick(() => {
    if (senderRef.value) {
      senderRef.value.closeHeader();
    }

    // 确保滚动到底部
    scrollToBottom();
  });
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
    name: 'Knowledge Agent',
    icon: 'Search',
    route: '/knowledge-agent'
  },
  {
    id: 3,
    name: 'Data Agent',
    icon: 'DataLine',
    route: '/data-agent'
  },
  {
    id: 4,
    name: 'Analyst Agent',
    icon: 'Edit',
    route: '/analyst-agent'
  },
  {
    id: 5,
    name: 'Brief Review Agent',
    icon: 'Edit',
    route: '/brief-review-agent'
  },
  {
    id: 6,
    name: 'Gene Network Agent',
    icon: 'Edit',
    route: '/gene-network-agent'
  },
  {
    id: 7,
    name: 'Deep Genome Agent',
    icon: 'Edit',
    route: '/deep-genome-agent'
  },
  {
    id: 8,
    name: 'Digital Design Agent',
    icon: 'Edit',
    route: '/digital-design-agent'
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

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });
};

// 是否正在动画中
const isAnimating = ref(false);

// 处理agent点击
const handleAgentClick = (agent: any) => {
  // 如果正在发送或刷新，阻止操作
  if (isSending.value) return;

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });

  router.push(agent.route);
};

// 处理tool选择时更新全文
const handleCommand = (command: string) => {
  // 如果正在发送或刷新，阻止操作
  if (isSending.value) return;

  const regex = /@([^,]+),/;
  const match = command.match(regex);
  const extractedValue = match ? match[1] : '';
  activeButton.value = extractedValue;
  const newMessageValue = extractAtValues(messageInput.value);
  messageInput.value = `${command}${newMessageValue.cleanedText}`;

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });
}

const handleSelect = (option: MentionOption) => {
  activeButton.value = option.value;

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });
}
const handleSearch = (searchValue: string, prefix: string) => {
  // console.log(searchValue,'searchValue',prefix)

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });
}

// 处理Markdown打字效果完成事件
const handleMarkdownFinish = (messageIndex: number) => {
  if (currentChat.value?.messages && currentChat.value.messages[messageIndex]) {
    // 设置后续问题显示状态为true
    currentChat.value.messages[messageIndex].showFollowUpQuestions = true;

    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });
  }
}

// 处理后续问题点击事件
const handleFollowUpQuestionClick = (question: string) => {
  // 如果正在发送或刷新，阻止操作
  if (isSending.value) return;

  if (!currentChatId.value) return;

  const chatState = getChatState(currentChatId.value);
  if (!chatState) return;

  // 将点击的问题设置为输入内容
  chatState.messageInput = question;

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });

  // 自动发送消息
  nextTick(() => {
    sendMessage();
  });
}

// 切换日志视图
const toggleLogView = async (messageId: string) => {
  // 如果正在发送或刷新，阻止操作
  if (isSending.value) return;

  if (!currentChat.value?.messages || !messageId || !currentChatId.value) return;

  const message = currentChat.value.messages.find((msg: ChatMessage) => msg.id === messageId);
  if (!message) return;

  // 切换显示状态
  message.showLog = !message.showLog;

  const chatState = getChatState(currentChatId.value);
  if (!chatState) return;

  // 如果显示日志且还没有加载数据，则加载日志数据
  if (message.showLog && !chatState.logData[messageId] && !chatState.loadingLog[messageId]) {
    chatState.loadingLog[messageId] = true;
    try {
      const res = await getAnalystAgentLog({ id: messageId });
      if (res.code === 200 && res.data) {
        // 处理新的日志数据格式
        let parsedData;

        // 检查数据是否为字符串格式（新的日志格式）
        if (typeof res.data === 'string') {
          // 直接使用字符串数据，不需要JSON解析
          parsedData = res.data;
          console.log('日志数据加载成功（字符串格式）:', parsedData);
        } else {
          // 尝试解析JSON数据（向后兼容）
          try {
            parsedData = JSON.parse(res.data);
            console.log('日志数据加载成功（JSON格式）:', parsedData);
          } catch (parseError) {
            console.error('JSON解析失败:', parseError);
            parsedData = res.data;
          }
        }

        chatState.logData[messageId] = parsedData;

        // 确保滚动到底部
        nextTick(() => {
          scrollToBottom();
        });
      } else {
        console.error('获取日志失败:', res);
      }
    } catch (error) {
      console.error('获取日志失败:', error);
    } finally {
      chatState.loadingLog[messageId] = false;
    }
  }

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });
}

// 刷新消息
const refreshMessage = async (messageIndex: number) => {
  console.log('=== 开始刷新消息 ===', { messageIndex, currentChatId: currentChatId.value });

  if (!currentChat.value?.messages || messageIndex < 0 || messageIndex >= currentChat.value.messages.length || !currentChatId.value) {
    console.log('刷新消息参数验证失败');
    return;
  }

  const message = currentChat.value.messages[messageIndex];
  if (!message || message.role !== 'assistant') {
    console.log('消息验证失败', { message, role: message?.role });
    return;
  }

  // 获取对应的用户消息
  const userMessage = currentChat.value.messages[messageIndex - 1];
  if (!userMessage || userMessage.role !== 'user') {
    console.log('用户消息验证失败', { userMessage, role: userMessage?.role });
    return;
  }

  const messageId = message.id;
  if (!messageId) {
    console.log('消息ID不存在');
    return;
  }

  const chatState = getChatState(currentChatId.value);
  if (!chatState) {
    console.log('聊天状态不存在');
    return;
  }

  console.log('刷新状态管理:', {
    messageIndex,
    messageId,
    currentRefreshingState: chatState.refreshingMessages[messageId],
    allRefreshingStates: Object.keys(chatState.refreshingMessages)
  });

  // 设置刷新状态 - 同时使用messageIndex和messageId作为键值
  const refreshKey = `${messageIndex}_${messageId}`;
  chatState.refreshingMessages[refreshKey] = true;

  // 设置整体发送状态为true，显示加载状态
  chatState.isSending = true;

  try {
    const urlChatId = getDialogueIdFromChatId();
    const queryData = new FormData();
    queryData.append('query', userMessage.content);
    queryData.append('id', (urlChatId ? Number(urlChatId) : 0).toString());
    queryData.append('refresh_id', messageId);

    // 添加工具参数（如果有的话）
    if (message.tool_name) {
      queryData.append('tool', message.tool_name);
    }

    // 添加历史记录（如果有的话）
    if (chatState.historyQuestion) {
      queryData.append('history', JSON.stringify(chatState.historyQuestion));
    }

    // 添加文件（如果有的话）
    if (chatState.fileList.length > 0) {
      chatState.fileList.forEach(fileItem => {
        queryData.append('files', fileItem.file);
      });
    }

    const response = await getQuery(queryData as any);
    console.log('refresh response', response.data);

    if (response.data) {
      let newAssistantMessage: ChatMessage | undefined;
      if (response.data.final_answer) {
        newAssistantMessage = {
          role: 'assistant',
          content: response.data.final_answer || '抱歉，我无法回答这个问题。',
          steps: response.data.steps || [],
          status: response.data?.status || '',
          upload_path: response.data?.upload_path || '',
          instantMessage: true,
          id: response.data.id || messageId, // 如果没有新ID，保留原ID
          tool_name: response.data.tool_name,
          followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
          showFollowUpQuestions: false,
          showLog: false,
        };

        // 同步刷新后消息的点赞状态
        if (response.data.id && response.data.reaction_type) {
          chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
        }
      } else {
        if (response.data.tool_name) {
          if (response.data.tool_name === 'ChatAgents' || response.data.tool_name === 'ChatAgent') {
            newAssistantMessage = {
              role: 'assistant',
              content: response.data.answer,
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              tool_name: response.data.tool_name,
              id: response.data.id || messageId, // 如果没有新ID，保留原ID
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
            };
          } else if (response.data.tool_name === 'DeepGenomeAgent') {
            const contentData = isValidJSON(response.data.answer) ? JSON.parse(response.data.answer) : response.data.answer;
            newAssistantMessage = {
              role: 'assistant',
              content: contentData?.content || response.data.answer,
              doc_list: contentData?.doc_list,
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
              server_file_path: response.data.server_file_path, // 添加服务器文件路径
            };

            // 如果有服务器文件路径，异步读取文件内容
            if (response.data.server_file_path) {
              // 先显示加载状态
              if (newAssistantMessage) {
                newAssistantMessage.content = '正在加载文件内容...';
              }
              
              readServerFile(response.data.server_file_path).then(fileContent => {
                if (fileContent && fileContent.trim() && newAssistantMessage) {
                  newAssistantMessage.content = fileContent;
                } else if (newAssistantMessage) {
                  newAssistantMessage.content = '文件内容为空或加载失败';
                }
                // 强制更新视图
                nextTick(() => {
                  timestamp.value = Date.now();
                  scrollToBottom();
                });
              }).catch(error => {
                console.error('读取DeepGenomeAgent文件失败:', error);
                if (newAssistantMessage) {
                  newAssistantMessage.content = '文件加载失败，请稍后重试';
                }
                // 强制更新视图
                nextTick(() => {
                  timestamp.value = Date.now();
                  scrollToBottom();
                });
              });
            }
          } else if (response.data.tool_name === 'KnowledgeAgents' || response.data.tool_name === 'ReviewAgent' || response.data.tool_name === 'KnowledgeAgent' || response.data.tool_name === 'ReviewAgent') {
            const contentData = isValidJSON(response.data.answer) ? JSON.parse(response.data.answer) : response.data.answer;
            // 打印刷新消息的 doc_list 数据
            console.log('=== 刷新消息 doc_list ===', {
              tool_name: response.data.tool_name,
              message_id: response.data.id,
              doc_list: contentData.doc_list,
              content: contentData.content
            });
            newAssistantMessage = {
              role: 'assistant',
              content: contentData.content,
              doc_list: contentData.doc_list,
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
            };

            // 同步刷新后消息的点赞状态
            if (response.data.id && response.data.reaction_type) {
              chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
            }
          } else if (response.data.tool_name === 'DatabaseAgents' || response.data.tool_name === 'DataAgent') {
            const contentData = isValidJSON(response.data.answer) ? JSON.parse(response.data.answer) : response.data.answer;
            const tableData = convertToTableData(contentData);
            newAssistantMessage = {
              role: 'assistant',
              content: tableData,
              tableHeaders: contentData.headers.map((header: string) => ({
                prop: header.replace(/\s+/g, '_').toLowerCase(),
                label: header,
              })),
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              original: response.data.answer,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
            };

            // 同步刷新后消息的点赞状态
            if (response.data.id && response.data.reaction_type) {
              chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
            }
          } else if (response.data.tool_name === 'AnalysisAgents') {
            newAssistantMessage = {
              role: 'assistant',
              content: '任务执行中，请等待',
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
            };

            // 同步刷新后消息的点赞状态
            if (response.data.id && response.data.reaction_type) {
              chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
            }
          } else if (response.data.tool_name === 'AnalystAgent') {
            getAnalystAgentLog({ id: response.data.id }).then((res: any) => {
              console.log(res, 'res1111111111111111111');
            })
            newAssistantMessage = {
              role: 'assistant',
              content: response.data.answer,
              status: response.data?.status || '',
              upload_path: response.data?.upload_path || '',
              instantMessage: true,
              tool_name: response.data.tool_name,
              id: response.data.id,
              followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
              showFollowUpQuestions: false,
              showLog: false,
              compute_resource: response.data?.compute_resource || '',
            };

            // 同步刷新后消息的点赞状态
            if (response.data.id && response.data.reaction_type) {
              chatState.reactions[response.data.id.toString()] = parseInt(response.data.reaction_type);
            }
          }
        } else {
          newAssistantMessage = {
            role: 'assistant',
            content: response.data.answer,
            status: response.data?.status || '',
            upload_path: response.data?.upload_path || '',
            instantMessage: true,
            tool_name: response.data?.tool_name || '',
            id: response.data.id || messageId, // 如果没有新ID，保留原ID
            followUpQuestions: response.data.follow_up_questions ? (typeof response.data.follow_up_questions === 'string' ? JSON.parse(response.data.follow_up_questions) : response.data.follow_up_questions) : [],
            showFollowUpQuestions: false,
            showLog: false,
          };
        }
      }

      // 更新消息
      if (newAssistantMessage) {
        currentChat.value.messages[messageIndex] = newAssistantMessage;

        console.log('更新消息后的状态:', {
          oldMessageId: messageId,
          newMessageId: newAssistantMessage.id,
          oldRefreshingState: chatState.refreshingMessages[messageId]
        });

        // 清理旧的刷新状态
        if (chatState.refreshingMessages[refreshKey]) {
          delete chatState.refreshingMessages[refreshKey];
          console.log('清理旧刷新状态:', refreshKey);
        }

        // 为新消息设置刷新状态 - 使用新的键值
        const newRefreshKey = `${messageIndex}_${newAssistantMessage.id || 'temp'}`;
        chatState.refreshingMessages[newRefreshKey] = false;
        console.log('设置新刷新状态:', newRefreshKey);

        console.log('设置新刷新状态:', {
          newMessageId: newAssistantMessage.id,
          newRefreshingState: newAssistantMessage.id ? chatState.refreshingMessages[newAssistantMessage.id] : undefined,
          allRefreshingStates: Object.keys(chatState.refreshingMessages)
        });

        // 自动滚动到最新消息
        await scrollToBottom();
      }
    }
  } catch (error: any) {
    console.error('刷新消息失败:', error);
    ElMessage.error('刷新失败，请重试');
  } finally {
    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });
    console.log('finally块中的状态清理:', {
      messageIndex,
      messageId,
      refreshKey,
      currentRefreshingState: chatState.refreshingMessages[refreshKey],
      allRefreshingStates: Object.keys(chatState.refreshingMessages)
    });

    // 清理旧的刷新状态
    if (chatState.refreshingMessages[refreshKey]) {
      delete chatState.refreshingMessages[refreshKey];
      console.log('finally中清理旧刷新状态:', refreshKey);
    }

    // 重置整体发送状态
    chatState.isSending = false;

    // 刷新侧边栏历史记录数据，确保显示最新的对话信息
    try {
      await getHistoryQuestionData();
      console.log('刷新消息后，侧边栏数据已更新');
    } catch (error) {
      console.error('刷新侧边栏数据失败:', error);
    }
  }
}



const extractAtValues = (text: any) => {
  // 使用正则表达式匹配所有以@开头、以,结尾的子串
  const regex = /@[^,]+,/g;

  // 提取所有匹配项（用于返回）
  const matches = text.match(regex) || [];
  const uniqueAgents = [...new Set(matches)]
  // 从原字符串中去除所有匹配项
  const cleanedText = text.replace(regex, '');

  return {
    matches: uniqueAgents.length > 0 ? uniqueAgents.map((match: any) => match.slice(1, -1)) : [], // 去掉@和,
    cleanedText: cleanedText
  };
}

// 获取智能体提示信息
const getAgentTooltip = (agentName: string) => {
  //首字母小写
  const agentKey = agentName.charAt(0).toLowerCase() + agentName.slice(1);
  return t(`chat.agents.${agentKey}`) || agentName;
};

// 获取智能体能力列表
const getAgentCapabilities = (agentName: string) => {
  const capabilities: Record<string, string[]> = {
    'RAG': ['知识检索', '文献分析', '智能问答'],
    'BI': ['数据分析', '可视化', '报表生成'],
    'GA': ['基因分析', '序列比对', '功能预测'],
    '联网搜索': ['实时搜索', '信息更新', '多源整合'],
    'Chat Agent': ['自然语言处理', '多轮对话', '上下文理解'],
    'Knowledge Agent': ['知识库管理', '精准匹配', '权威信息'],
    'Data Agent': ['数据清洗', '格式转换', '质量优化'],
    'Analyst Agent': ['统计分析', '模式识别', '洞察生成'],
    'Review Agent': ['文献综述', '趋势分析', '研究总结'],
    'Deep Genome Agent': ['基因组解析', '变异检测', '功能注释'],
    'In Silico Research Agent': ['实验模拟', '预测分析', '成本优化'],
    'Gene Network Agent': ['网络构建', '通路分析', '调控机制'],
    'Digital Design Agent': ['序列设计', '结构预测', '功能验证']
  };

  const agentCapabilities = capabilities[agentName] || ['智能分析', '数据处理', '结果生成'];
  return agentCapabilities.map((cap: string) => `<li>${cap}</li>`).join('');
};

// 获取智能体使用说明
const getAgentUsage = (agentName: string) => {
  const usage: Record<string, string> = {
    'RAG': '直接输入您的问题，系统将自动检索相关知识库并生成答案。',
    'BI': '上传数据文件，系统将自动分析并生成可视化图表和报告。',
    'GA': '输入基因序列或名称，系统将提供详细的基因功能分析。',
    '联网搜索': '输入搜索关键词，系统将实时搜索网络信息并整合结果。',
    'Chat Agent': '用自然语言描述您的需求，系统将提供智能对话服务。',
    'Knowledge Agent': '输入专业问题，系统将从权威知识库中检索相关信息。',
    'Data Agent': '上传数据文件，系统将自动处理并优化数据格式。',
    'Analyst Agent': '提供数据或问题，系统将进行深度分析并生成洞察报告。',
    'Review Agent': '指定研究领域，系统将自动生成文献综述和研究趋势分析。',
    'Deep Genome Agent': '输入基因组数据，系统将进行深度解析和功能预测。',
    'In Silico Research Agent': '描述实验需求，系统将进行数字模拟和预测分析。',
    'Gene Network Agent': '提供基因列表，系统将构建调控网络并分析关键通路。',
    'Digital Design Agent': '描述设计需求，系统将生成基因序列和蛋白质结构。'
  };

  return usage[agentName] || '根据您的具体需求，系统将提供相应的智能服务。';
};

// 获取智能体对应的图片路径
const getAgentImage = (agentName: string) => {
  console.log(agentName, 'agentName');
  const imageMap: Record<string, string> = {
    'ChatAgent': '/src/assets/images/chat/ChatAgent.png',
    'KnowledgeAgent': '/src/assets/images/chat/KnowledgeAgent.png',
    'DataAgent': '/src/assets/images/chat/DataAgent.png',
    'AnalystAgent': '/src/assets/images/chat/AnalystAgent.png',
    'ReviewAgent': '/src/assets/images/chat/ReviewAgent.png',
    'BriefReviewAgent': '/src/assets/images/chat/BriefReviewAgent.png',
    'DeepGenomeAgent': '/src/assets/images/chat/DeepGenomeAgent.png',
    'InSilicoResearchAgent': '/src/assets/images/chat/InSilicoResearchAgent.png',
    'GeneNetworkAgent': '/src/assets/images/chat/GeneNetworkAgent.png',
    'DigitalDesignAgent': '/src/assets/images/chat/DigitalDesignAgent.png'
  };

  return imageMap[agentName] || '/src/assets/images/chat/Agents.png';
};

// 显示更多信息弹出窗口
const showMoreInfo = (agentName: string) => {
  const messageBox = ElMessageBox.alert(
    `<div class="agent-info-dialog">
      <div class="agent-detail">
        <div class="agent-description">
          <p>${getAgentTooltip(agentName)}</p>
        </div>
        <div class="agent-image">
          <img src="${getAgentImage(agentName)}" style="width: 100%; height: 300px;" alt="${agentName}">
        </div>
      </div>
    </div>`,
    agentName,
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: t('common.close'),
      customClass: 'agent-info-dialog'
    }
  );
  
  // 强制设置弹窗尺寸
  nextTick(() => {
    const messageBoxElement = document.querySelector('.el-message-box.agent-info-dialog');
    if (messageBoxElement) {
      (messageBoxElement as HTMLElement).style.setProperty('--el-messagebox-width', '800px');
      (messageBoxElement as HTMLElement).style.setProperty('width', '800px');
      (messageBoxElement as HTMLElement).style.setProperty('max-width', '800px');
      (messageBoxElement as HTMLElement).style.setProperty('min-width', '800px');
      
      const contentElement = messageBoxElement.querySelector('.el-message-box__content');
      if (contentElement) {
        (contentElement as HTMLElement).style.setProperty('max-height', '600px');
        (contentElement as HTMLElement).style.setProperty('height', '600px');
        (contentElement as HTMLElement).style.setProperty('min-height', '600px');
      }
    }
  });
};

// 教学引导功能状态管理
const showTutorial = ref(false);
const currentTutorialStep = ref(1);

// 开始教学引导
const startTutorial = () => {
  showTutorial.value = true;
  currentTutorialStep.value = 1;
};

// 下一步教学
const nextTutorialStep = () => {
  if (currentTutorialStep.value < 3) {
    currentTutorialStep.value++;
  }
};

// 上一步教学
const prevTutorialStep = () => {
  if (currentTutorialStep.value > 1) {
    currentTutorialStep.value--;
  }
};

// 完成教学
const completeTutorial = () => {
  showTutorial.value = false;
  currentTutorialStep.value = 1;
  // 更新用户登录状态为非首次登录
  userStore().SET_LOGIN_STATUS('1');
};

// 处理教学遮罩层点击
const handleTutorialOverlayClick = (event: Event) => {
  // 阻止事件冒泡，避免意外关闭教学
  event.stopPropagation();
};

// 处理键盘导航
const handleTutorialKeydown = (event: KeyboardEvent) => {
  if (!showTutorial.value) return;
  
  switch (event.key) {
    case 'ArrowRight':
    case ' ':
      event.preventDefault();
      if (currentTutorialStep.value < 3) {
        nextTutorialStep();
      }
      break;
    case 'ArrowLeft':
      event.preventDefault();
      if (currentTutorialStep.value > 1) {
        prevTutorialStep();
      }
      break;
    case 'Escape':
      event.preventDefault();
      completeTutorial();
      break;
  }
};

// 检查是否需要显示教学引导
const checkTutorialStatus = () => {
  // 从用户store中获取登录状态，0表示首次登录
  const isFirstLogin = userStore().login_status === '0';
  if (isFirstLogin) {
    // 首次登录时显示教学引导，确保页面完全加载
    setTimeout(() => {
      startTutorial();
    }, 1000);
  }
};

// 测试并行对话功能
const testParallelChats = () => {
  console.log('=== 测试并行对话功能 ===');

  // 创建两个测试对话
  const chat1Id = 'test_chat_1';
  const chat2Id = 'test_chat_2';

  // 初始化对话状态
  getChatState(chat1Id);
  getChatState(chat2Id);

  // 设置不同的输入内容
  chatStates.value[chat1Id].messageInput = '对话1的测试消息';
  chatStates.value[chat2Id].messageInput = '对话2的测试消息';

  // 设置不同的发送状态
  chatStates.value[chat1Id].isSending = true;
  chatStates.value[chat2Id].isSending = false;

  // 验证状态独立性
  console.log('对话1状态:', {
    messageInput: chatStates.value[chat1Id].messageInput,
    isSending: chatStates.value[chat1Id].isSending
  });

  console.log('对话2状态:', {
    messageInput: chatStates.value[chat2Id].messageInput,
    isSending: chatStates.value[chat2Id].isSending
  });

  console.log('状态独立性验证通过 ✅');
};

// 在开发环境下添加测试按钮
const isDevelopment = import.meta.env.DEV;

// 获取点赞点踩状态
const getReactionState = (messageId: string) => {
  if (!currentChatId.value) return 0;
  const chatState = getChatState(currentChatId.value);
  return chatState?.reactions?.[messageId] || 0;
};

// 处理点赞点踩
const handleReaction = async (messageId: string, reactionType: number) => {
  if (!currentChatId.value || !messageId) return;

  const chatState = getChatState(currentChatId.value);
  if (!chatState) return;

  const currentReaction = chatState.reactions?.[messageId] || 0;

  // 如果点击的是当前状态，则取消（传值0）
  // 如果点击的是不同状态，则切换到新状态
  const newReaction = currentReaction === reactionType ? 0 : reactionType;

  try {
    // 调用API
    const formData = new FormData();
    formData.append('id', messageId);
    formData.append('reaction_type', newReaction.toString());

    const response = await getReactionType(formData);

    if (response.code === 200) {
      // 更新本地状态
      chatState.reactions = {
        ...chatState.reactions,
        [messageId]: newReaction
      };

      // 显示成功提示
      if (newReaction === 0) {
        ElMessage.success('已取消');
      } else if (newReaction === 1) {
        ElMessage.success('已点赞');
      } else if (newReaction === 2) {
        ElMessage.success('已点踩');
      }

      // 确保滚动到底部
      nextTick(() => {
        scrollToBottom();
      });
    } else {
      ElMessage.error('操作失败，请重试');
    }
  } catch (error) {
    console.error('点赞点踩失败:', error);
    ElMessage.error('操作失败，请重试');
  }

  // 确保滚动到底部
  nextTick(() => {
    scrollToBottom();
  });
};

// 获取点赞点踩提示
const getReactionTooltip = (messageId: string, reactionType: number) => {
  const currentReaction = getReactionState(messageId);
  if (reactionType === 1) {
    return currentReaction === 1 ? '取消点赞' : '点赞';
  } else if (reactionType === 2) {
    return currentReaction === 2 ? '取消点踩' : '点踩';
  }
  return '';
};

// 更新日志状态管理 - 现在基于当前对话
const updatingLog = computed({
  get: () => {
    if (!currentChatId.value) return {};
    const chatState = getChatState(currentChatId.value);
    return chatState ? chatState.updatingLog : {};
  },
  set: (value: Record<string, boolean>) => {
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (chatState) {
      chatState.updatingLog = value;
    }
  }
});

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

  // 卷号、页码和年份组合
  let volumePageYear = '';
  if (doc.vl) {
    if (doc.bp && doc.ep) {
      volumePageYear = `${doc.vl}, ${doc.bp}-${doc.ep}`;
    } else if (doc.bp) {
      volumePageYear = `${doc.vl}, ${doc.bp}`;
    } else {
      volumePageYear = doc.vl;
    }
  } else if (doc.bp && doc.ep) {
    volumePageYear = `${doc.bp}-${doc.ep}`;
  }

  // 添加年份（用括号包围）
  if (doc.py) {
    if (volumePageYear) {
      volumePageYear += `, (${doc.py})`;
    } else {
      volumePageYear = `(${doc.py})`;
    }
  }

  // 如果有卷号页码年份信息，添加到parts中
  if (volumePageYear) {
    parts.push(volumePageYear);
  }

  return parts.join('. ');
};

// 格式化日志内容（保留ANSI颜色代码）
const formatLogContent = (logContent: string) => {
  if (!logContent) return '';

  // 处理特殊字符，但保留ANSI颜色代码
  const processedContent = logContent
    .replace(/\u0026\u0026/g, '&&') // 将 \u0026\u0026 转换为 &&
    .replace(/\n/g, '\n') // 保持换行符
    .trim();

  return processedContent;
};

// 格式化日志内容并转换ANSI颜色代码为HTML样式
const formatLogContentWithColors = (logContent: string) => {
  if (!logContent) return '';

  // 处理特殊字符
  let processedContent = logContent
    .replace(/\u0026\u0026/g, '&&') // 将 \u0026\u0026 转换为 &&
    .replace(/\n/g, '\n') // 保持换行符
    .trim();

  // ANSI ESC (\u001b) is a control char by design; this contiguous block
  // converts terminal escape sequences to HTML tags. no-control-regex is
  // meant to catch accidental control chars in human regex, not ANSI
  // parsing, so we disable it for the block only.
  /* eslint-disable no-control-regex */
  // 转换ANSI颜色代码为HTML样式
  // 红色文本
  processedContent = processedContent.replace(/\u001b\[31m/g, '<span style="color: #ff0000;">');
  // 绿色文本
  processedContent = processedContent.replace(/\u001b\[32m/g, '<span style="color: #00ff00;">');
  // 黄色文本
  processedContent = processedContent.replace(/\u001b\[33m/g, '<span style="color: #ffff00;">');
  // 蓝色文本
  processedContent = processedContent.replace(/\u001b\[34m/g, '<span style="color: #0000ff;">');
  // 洋红色文本
  processedContent = processedContent.replace(/\u001b\[35m/g, '<span style="color: #ff00ff;">');
  // 青色文本
  processedContent = processedContent.replace(/\u001b\[36m/g, '<span style="color: #00ffff;">');
  // 白色文本
  processedContent = processedContent.replace(/\u001b\[37m/g, '<span style="color: #ffffff;">');

  // 重置颜色
  processedContent = processedContent.replace(/\u001b\[0m/g, '</span>');

  // 处理其他常见的ANSI代码
  // 加粗
  processedContent = processedContent.replace(/\u001b\[1m/g, '<strong>');
  processedContent = processedContent.replace(/\u001b\[22m/g, '</strong>');

  // 下划线
  processedContent = processedContent.replace(/\u001b\[4m/g, '<u>');
  processedContent = processedContent.replace(/\u001b\[24m/g, '</u>');
  /* eslint-enable no-control-regex */

  return processedContent;
};

// 读取服务器文件内容的函数
const readServerFile = async (filePath: string): Promise<string> => {
  try {
    // 将绝对路径转换为相对于项目的路径
    let relativePath = filePath;
    if (filePath.includes('src\\assets\\agentOut\\') || filePath.includes('src/assets/agentOut/')) {
      // 提取相对路径部分
      const pathParts = filePath.split(/[\\/]/);
      const srcIndex = pathParts.findIndex(part => part === 'src');
      if (srcIndex !== -1) {
        relativePath = pathParts.slice(srcIndex).join('/');
      }
    }
    
    // 使用 fetch 读取文件内容
    const response = await fetch(`/${relativePath}`);
    if (response.ok) {
      let content = await response.text();
      
      // 处理 Markdown 文件中的图片路径
      content = processImagePaths(content, relativePath);
      
      return content;
    } else {
      console.error('读取文件失败:', response.status, response.statusText);
      return '';
    }
  } catch (error) {
    console.error('读取服务器文件失败:', error);
    return '';
  }
};

// 处理 Markdown 文件中的图片路径
const processImagePaths = (content: string, filePath: string): string => {
  // 获取文件所在目录
  const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
  console.log('文件目录:', fileDir);
  
  // 处理相对路径的图片引用
  // 匹配 ![alt text](./path/to/image.png) 格式
  const imageRegex = /!\[([^\]]*)\]\(\.\/([^)]+)\)/g;
  
  return content.replace(imageRegex, (match, altText, imagePath) => {
    // 构建完整的图片路径
    const fullImagePath = `/${fileDir}/${imagePath}`;
    console.log('处理图片路径:', { 
      original: match, 
      imagePath: imagePath,
      fileDir: fileDir,
      newPath: fullImagePath 
    });
    return `![${altText}](${fullImagePath})`;
  });
};

// 更新日志函数
const updateLog = async (messageId: string) => {
  if (!currentChatId.value || !messageId) return;

  const chatState = getChatState(currentChatId.value);
  if (!chatState) return;

  // 设置更新状态
  chatState.updatingLog[messageId] = true;

  try {
    // 从当前消息中获取 compute_resource 值
    let computeResource = 'analyst-agents-small'; // 默认值

    if (currentChat.value?.messages) {
      const message = currentChat.value.messages.find((msg: ChatMessage) => msg.id === messageId);
      if (message && message.compute_resource) {
        computeResource = message.compute_resource;
      }
    }

    const formData = new FormData();
    formData.append('task_id', messageId);
    formData.append('compute_resource', computeResource);

    const response = await updateAnalystAgentLog(formData);

    if (response.code === 200) {
      ElMessage.success('日志更新成功');

      // 重新加载日志数据
      if (currentChat.value?.messages) {
        const message = currentChat.value.messages.find((msg: ChatMessage) => msg.id === messageId);
        if (message && message.showLog) {
          // 重新获取日志数据
          chatState.loadingLog[messageId] = true;
          try {
            const logRes = await getAnalystAgentLog({ id: messageId });
            if (logRes.code === 200 && logRes.data) {
              let parsedData;

              // 检查数据是否为字符串格式（新的日志格式）
              if (typeof logRes.data === 'string') {
                // 直接使用字符串数据，不需要JSON解析
                parsedData = logRes.data;
              } else {
                // 尝试解析JSON数据（向后兼容）
                try {
                  parsedData = JSON.parse(logRes.data);
                } catch (parseError) {
                  console.error('JSON解析失败:', parseError);
                  parsedData = logRes.data;
                }
              }

              chatState.logData[messageId] = parsedData;

              // 确保滚动到底部
              nextTick(() => {
                scrollToBottom();
              });
            }
          } catch (error) {
            console.error('重新获取日志失败:', error);
          } finally {
            chatState.loadingLog[messageId] = false;
          }
        }
      }
    } else {
      ElMessage.error('日志更新失败');
    }
  } catch (error) {
    console.error('更新日志失败:', error);
    ElMessage.error('日志更新失败，请重试');
  } finally {
    chatState.updatingLog[messageId] = false;

    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });
  }
};

// 复制消息内容 + 引用的文档列表(从 inline @click 提取,绕开 vue-tsc
// 0.39.5 在模板多语句箭头函数内解析局部 const 时把它误映射到
// component instance 的 bug —— 详见 index.vue 中 2 处 @click 用法)
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

.chat-footer {
  position: relative;
  z-index: 1;
  color: #090909;
  font-size: 14px;
  text-align: center;
  background: var(--color-background) !important;
  line-height: 1;
  bottom: 4px;
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

  .header-controls {
    display: flex;
    align-items: center;
    gap: 10px;
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

    .has-user {
      background-color: #eff6ff;
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

    .message-text:hover .message-user {
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
  margin-bottom: 50px;

  .welcome-container {
    width: 80%;
    max-width: 800px;
    display: flex;
    flex-direction: column;
    align-items: center;

    h3 {
      text-align: center;
      margin-bottom: 24px;
      color: #333;
      margin-top: 100px;
    }

    &-text {
      height: 100%;
      width: 100%;
      text-align: center;
      color: #090909;
    }

    &-text1 {
      text-align: center;

      font-size: 22px;
      line-height: 1.5;

      .logo {
        width: 40px;
        height: 40px;
        margin-right: 10px;
      }
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
  background-color: #fff;

  .input-container-warpper {
    // padding: 8px 4px 8px 8px;
    // border-top: 1px solid #e6e6e6;
    position: relative;
    left: 50%;
    transform: translateX(-50%);
    width: 85%;
    border: 1px solid #e7e7e7;
    border-radius: 10px;
    box-shadow: 0 5px 16px -4px rgba(0, 0, 0, .17);
    
    &.show-tutorial {
      z-index: 1000 !important;
      background: #fff !important;
    }
  }

  .input-box {

    // display: flex;
    // gap: 12px;
    // align-items: flex-end;
    .header-self-wrap {
      padding: 3px 2px 2px 3px;
      box-sizing: border-box;
      width: 100%;
      display: flex;
      flex-direction: column;

      .file-list-container {
        // margin-bottom: 10px;

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
          gap: 3px;
          flex-wrap: wrap;
          padding: 4px;
        }

        .file-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0px 4px;
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
    }

    // .el-textarea {
    //   flex: 1;
    // }

    // .upload-btn {
    //   position: absolute;
    //   right: 70px;
    //   bottom: -3px;
    //   width: 20px;
    //   height: 20px;
    //   cursor: pointer;
    //   z-index: 1000;

    //   img {
    //     width: 100%;
    //     height: 100%;
    //   }
    // }

    .send-btn, .abort-btn {
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .abort-button-overlay {
      position: absolute;
      top: -50px;
      right: 20px;
      z-index: 1000;
      pointer-events: auto;
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
        border: 1px solid #d4d4d4;

        &:hover:not(.agent-button-disabled) {
          border-color: #3695c4;
          color: #2b738f;
        }

        &.agent-button-active {
          background-color: #3695c4;
          color: #fff;
          border-color: #1ea0ac;

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

.message-user {
  position: absolute;
  bottom: 0px;
  right: 1px;
  display: none;
}

.message-fotter {
  width: 100%;
  height: auto;
  display: flex;
  gap: 10px;
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  margin-top: 5px;

  &-item {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 22px;
    height: 22px;
    padding: 2px;
    box-sizing: border-box;
    border-radius: 4px;
    cursor: pointer;
  }

  &-item:hover {
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
    margin-left: 5px;

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

    .doc-link-inline {
      display: inline;
      margin-left: 8px;

      a {
        text-decoration: none;
        font-size: 13px;
        font-weight: 400;
        transition: color 0.2s ease;

        &.doi-link {
          color: #1890ff;

          &:hover {
            color: #40a9ff;
            text-decoration: underline;
          }
        }

        &.pmid-link {
          color: #1890ff;

          &:hover {
            color: #40a9ff;
            text-decoration: underline;
          }
        }
      }
    }
  }
}

// 消息中的文件显示样式
.message-files {
  margin-top: 12px;
  padding: 12px;
  background-color: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;

  .files-title {
    font-size: 14px;
    font-weight: 500;
    color: #495057;
    margin-bottom: 8px;
  }

  .files-list {
    display: flex;
    flex-direction: column;
    gap: 8px;

    .file-item-display {
      // 文件项样式继承自 FilesCard 组件
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
  overflow: hidden;
  box-sizing: border-box;
  position: absolute;
  left: 0;
  right: 0;
  bottom: 19px;
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 12px;
  // box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 998;
  
  &.show-tutorial {
    z-index: 1000 !important;
    background: #fff !important;
  }

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
    width:22%;
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

.show-tutorial{
  z-index: 1000 !important; 
  background: #fff !important;
}
// 为了确保容器可以覆盖其他内容
.input-container {
  position: relative;
}

.welcome-container-text1 {
  font-size: 40px !important;
}

.welcome-container-text2 {
  font-size: 18px !important;
}

// 日志按钮样式
.log-button-container {
  margin-top: 8px;
  margin-bottom: 8px;

  .el-button {
    &.active {
      background-color: #67c23a;
      border-color: #67c23a;
    }
  }
}

// 日志视图容器
.log-view-container {
  display: flex;
  gap: 20px;
  margin-top: 12px;

  .log-view-left,
  .log-view-right {
    flex: 1;
    min-width: 0;

    h4 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
      color: #333;
      border-bottom: 1px solid #e6e6e6;
      padding-bottom: 8px;
    }

    .log-actions {
      margin-bottom: 12px;
      display: flex;
      justify-content: flex-end;

      .el-button {
        font-size: 12px;
        padding: 6px 12px;

        .el-icon {
          margin-right: 4px;
        }
      }
    }
  }

  .log-view-right {
    border-left: 1px solid #e6e6e6;
    padding-left: 20px;

    .log-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #909399;
      font-size: 14px;

      .el-icon {
        font-size: 16px;
      }
    }

    .log-content {
      max-height: 400px;
      overflow-y: auto;
      border: 1px solid #e6e6e6;
      border-radius: 4px;
      padding: 12px;
      background-color: #fff;

      .log-text-content {
        .log-pre {
          margin: 0;
          padding: 0;
          font-family: 'Courier New', monospace;
          font-size: 12px;
          line-height: 1.4;
          color: #333;
          white-space: pre-wrap;
          word-break: break-word;
          background-color: #1e1e1e; // 深色背景，更适合显示彩色文本
          border-radius: 4px;
          padding: 8px;
          border: 1px solid #e9ecef;

          // 确保span标签内的颜色能够正确显示
          span {
            display: inline;

            &[style*="color: #ff0000"] {
              color: #ff6b6b !important; // 红色
            }

            &[style*="color: #00ff00"] {
              color: #51cf66 !important; // 绿色
            }

            &[style*="color: #ffff00"] {
              color: #ffd43b !important; // 黄色
            }

            &[style*="color: #0000ff"] {
              color: #74c0fc !important; // 蓝色
            }

            &[style*="color: #ff00ff"] {
              color: #f783ac !important; // 洋红色
            }

            &[style*="color: #00ffff"] {
              color: #63e6be !important; // 青色
            }

            &[style*="color: #ffffff"] {
              color: #f8f9fa !important; // 白色
            }
          }

          // 加粗文本样式
          strong {
            font-weight: bold;
            color: #f8f9fa;
          }

          // 下划线文本样式
          u {
            text-decoration: underline;
            color: #f8f9fa;
          }
        }
      }

      .el-table {
        font-size: 12px;

        .el-table__cell {
          padding: 8px;
          word-break: break-word;
          white-space: pre-wrap;
        }
      }
    }

    .log-error {
      color: #f56c6c;
      font-size: 14px;
      text-align: center;
      padding: 20px;
    }
  }
}

// 点赞点踩按钮样式
.reaction-buttons {
  display: flex;
  gap: 4px;
  margin-left: 8px;

  .reaction-btn {
    transition: all 0.2s ease;

    &:hover {
      color: #1890ff;
      background-color: #f0f9ff;
      transform: scale(1.1);
    }

    &.active {
      color: #1890ff;
      background-color: #e6f7ff;

      &:hover {
        background-color: #bae7ff;
      }
    }
  }
}

// 智能体项目包装器样式
.agent-item-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 12px;
}

// 更多按钮样式
.more-button {
  color: #909399;
  font-size: 12px;
  cursor: pointer;

  &:hover {
    color: #1890ff;
    text-decoration: underline;
  }

  &:disabled {
    color: #c0c4cc;
    cursor: not-allowed;
  }
}

// 权限加载状态样式
.roles-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #909399;
  font-size: 14px;
  padding: 20px;
  
  .el-icon {
    font-size: 16px;
  }
}

// 智能体信息弹出窗口样式
:deep(.agent-info-dialog) {
  .el-message-box__content {
    padding: 20px;

    .agent-info-dialog {
      h3 {
        margin: 0 0 20px 0;
        color: #303133;
        font-size: 18px;
        text-align: center;
        border-bottom: 1px solid #e4e7ed;
        padding-bottom: 10px;
      }

      .agent-detail {
        max-height: 400px;
        overflow-y: auto;

        .agent-description {
          margin-bottom: 20px;
          padding: 15px;
          background-color: #f8f9fa;
          border-radius: 8px;
          border-left: 3px solid #1890ff;

          p {
            margin: 0;
            color: #606266;
            font-size: 14px;
            line-height: 1.5;
          }
        }

        .agent-image {
          margin-bottom: 20px;
          padding: 15px;
          background-color: #f8f9fa;
          border-radius: 8px;
          border-left: 3px solid #1890ff;
          text-align: center;
          width: 300px !important;
          height: 200px !important;
          img {
            width: 100% !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            transition: transform 0.3s ease;

            &:hover {
              transform: scale(1.02);
            }
          }
        }
      }
    }
  }
}

/* 强制覆盖Element Plus弹窗样式 */
:deep(.el-message-box.agent-info-dialog) {
  --el-messagebox-width: 800px !important;
  max-width: 800px !important;
  width: 800px !important;
  min-width: 800px !important;
}

:deep(.el-message-box.agent-info-dialog .el-message-box__content) {
  max-height: 600px !important;
  height: 600px !important;
  min-height: 600px !important;
  overflow-y: auto !important;
}

:deep(.el-message-box.agent-info-dialog .el-message-box__container) {
  width: 800px !important;
  max-width: 800px !important;
}

:deep(.el-message-box.agent-info-dialog .el-message-box__main) {
  width: 800px !important;
  max-width: 800px !important;
}

/* 全局样式覆盖，确保优先级最高 */
:global(.el-message-box.agent-info-dialog) {
  --el-messagebox-width: 800px !important;
  max-width: 800px !important;
  width: 800px !important;
  min-width: 800px !important;
}

:global(.el-message-box.agent-info-dialog .el-message-box__content) {
  max-height: 600px !important;
  height: 600px !important;
  min-height: 600px !important;
}

:global(.el-message-box.agent-info-dialog .el-message-box__container) {
  width: 800px !important;
  max-width: 800px !important;
}

:global(.el-message-box.agent-info-dialog .el-message-box__main) {
  width: 800px !important;
  max-width: 800px !important;
}

/* 教学引导遮罩层样式 */
.tutorial-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  pointer-events: auto;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 第一步：左侧侧边栏高亮 */
.tutorial-step-1 {
  position: relative;
  width: 100%;
  height: 100%;
  
  // .sidebar-highlight-area {
  //   position: absolute;
  //   top: 0;
  //   left: 0;
  //   width: 250px;
  //   height: 100%;
  //   background: linear-gradient(90deg, rgba(64, 158, 255, 0.1), rgba(64, 158, 255, 0.05));
  //   border-right: 3px solid #409eff;
  //   box-shadow: 0 0 20px rgba(64, 158, 255, 0.3);
  //   z-index: 1001;
  // }
  
  .sidebar-tutorial {
    position: absolute;
    top: 50%;
    left: 300px;
    transform: translateY(-50%);
    z-index: 1002;
  }
}

/* 第二步：底部案例栏高亮 */
.tutorial-step-2 {
  position: relative;
  width: 100%;
  height: 100%;
  
  // .bottom-highlight-area {
  //   position: absolute;
  //   bottom: 0;
  //   left: 0;
  //   width: 100%;
  //   height: 200px;
  //   background: linear-gradient(0deg, rgba(103, 194, 58, 0.1), rgba(103, 194, 58, 0.05));
  //   border-top: 3px solid #67c23a;
  //   box-shadow: 0 -10px 20px rgba(103, 194, 58, 0.3);
  //   z-index: 1001;
  // }
  
  .bottom-tutorial {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1002;
  }
}

/* 第三步：对话输入区高亮 */
.tutorial-step-3 {
  position: relative;
  width: 100%;
  height: 100%;
  
  // .input-highlight-area {
  //   position: absolute;
  //   top: 50%;
  //   left: 50%;
  //   transform: translate(-50%, -50%);
  //   width: 600px;
  //   height: 300px;
  //   background: linear-gradient(45deg, rgba(255, 123, 114, 0.1), rgba(255, 123, 114, 0.05));
  //   border: 3px solid #ff7b72;
  //   border-radius: 15px;
  //   box-shadow: 0 0 30px rgba(255, 123, 114, 0.3);
  //   z-index: 1001;
  // }
  
  .input-tutorial {
    position: absolute;
    top: 5%;
    left: 50%;
    transform: translate(-50%, 5%);
    z-index: 1002;
  }
}



/* 响应式设计 */
@media (max-width: 768px) {
  .tutorial-indicator {
    bottom: 10px;
    padding: 8px 16px;
    min-width: 160px;
    
    .tutorial-progress {
      gap: 8px;
      
      .progress-bar {
        height: 3px;
      }
      
      .tutorial-steps {
        gap: 6px;
        
        .tutorial-step {
          width: 24px;
          height: 24px;
          
          .step-number {
            font-size: 11px;
          }
        }
      }
    }
  }
}

/* 通用教学内容样式 */
.tutorial-content {
  position: relative;
  width: 90%;
  max-width: 800px;
  background-color: #fff;
  border-radius: 15px;
  padding: 25px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  text-align: center;
  pointer-events: auto;
  border: 1px solid rgba(0, 0, 0, 0.05);
  animation: slideInUp 0.4s ease-out;

  h3 {
    margin-bottom: 15px;
    color: #333;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
  }

  p {
    margin-bottom: 25px;
    color: #666;
    line-height: 1.7;
    font-size: 15px;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }

  .tutorial-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;

    .el-button {
      padding: 12px 24px;
      font-size: 14px;
      border-radius: 8px;
      min-width: 90px;
      font-weight: 500;
      transition: all 0.3s ease;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
    }

    .tutorial-hint {
      text-align: center;
      color: #909399;
      font-size: 12px;
      line-height: 1.4;
      
      small {
        display: block;
        padding: 8px 12px;
        background: rgba(144, 147, 153, 0.1);
        border-radius: 6px;
        border: 1px solid rgba(144, 147, 153, 0.2);
      }
    }
  }
}

@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .tutorial-content {
    width: 95%;
    padding: 20px;
    margin: 10px;

    h3 {
      font-size: 18px;
      margin-bottom: 12px;
    }

    p {
      font-size: 14px;
      margin-bottom: 20px;
    }

    .tutorial-actions {
      gap: 15px;

      .el-button {
        padding: 10px 20px;
        min-width: 80px;
        font-size: 13px;
      }
    }
  }

  /* 移动端高亮区域调整 */
  .tutorial-step-1 {
    .sidebar-tutorial {
      left: 220px;
    }
  }

  .tutorial-step-2 {
    .bottom-tutorial {
      width: 90%;
    }
  }

  .tutorial-step-3 {
    .input-tutorial {
      top: 10%;
    }
  }
}

/* 小屏幕设备优化 */
@media (max-width: 480px) {
  .tutorial-content {
    width: 98%;
    padding: 15px;
    margin: 5px;

    h3 {
      font-size: 16px;
      margin-bottom: 10px;
    }

    p {
      font-size: 13px;
      margin-bottom: 15px;
    }

    .tutorial-actions {
      flex-direction: column;
      gap: 10px;

      .el-button {
        width: 100%;
        padding: 12px 20px;
        font-size: 14px;
      }
    }
  }

  /* 超小屏幕高亮区域调整 */
  .tutorial-step-1 {
    .sidebar-tutorial {
      left: 170px;
      width: 80%;
    }
  }

  .tutorial-step-2 {
    .bottom-tutorial {
      width: 90%;
    }
  }

  .tutorial-step-3 {
    .input-tutorial {
      width: 90%;
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
/* 通用动画定义 */
@keyframes tutorial-pulse {
  0%, 100% {
    opacity: 0.6;
  }
  50% {
    opacity: 0.3;
  }
}

@keyframes tutorial-bounce-left {
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(-50%) translateX(0);
  }
  40% {
    transform: translateY(-50%) translateX(-5px);
  }
  60% {
    transform: translateY(-50%) translateX(-3px);
  }
}

@keyframes tutorial-bounce-down {
  0%, 20%, 50%, 80%, 100% {
    transform: translateX(-50%) translateY(0);
  }
  40% {
    transform: translateX(-50%) translateY(5px);
  }
  60% {
    transform: translateX(-50%) translateY(3px);
  }
}

@keyframes tutorial-bounce-up {
  0%, 20%, 50%, 80%, 100% {
    transform: translateX(-50%) translateY(0);
  }
  40% {
    transform: translateX(-50%) translateY(-5px);
  }
  60% {
    transform: translateX(-50%) translateY(-3px);
  }
}

/* Agents架构图弹窗样式 */
.agents-view-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
}

.agents-view-image {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* 弹窗标题样式 */
:deep(.el-dialog__header) {
  text-align: center;
  padding: 20px 20px 10px;
  
  .el-dialog__title {
    font-size: 18px;
    font-weight: 600;
    color: #303133;
  }
}

/* 弹窗内容样式 */
:deep(.el-dialog__body) {
  padding: 10px 20px 30px;
}

/* 响应式设计 */
@media (max-width: 900px) {
  .agents-view-image {
    width: 100% !important;
    height: auto !important;
  }
  
  :deep(.el-dialog) {
    margin: 5vh auto;
    width: 95% !important;
  }
}




</style>
