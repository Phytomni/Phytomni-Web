<template>
  <div class="chat-container">
    <!-- Tutorial guide overlay -->
    <div
      v-if="showTutorial"
      class="tutorial-overlay"
      @click="handleTutorialOverlayClick"
    >
      <!-- Step 1: highlight the left sidebar -->
      <div v-if="currentTutorialStep === 1" class="tutorial-step-1">
        <!-- Left sidebar highlight area -->
        <div class="sidebar-highlight-area"></div>
        <!-- Tutorial content -->
        <div class="tutorial-content sidebar-tutorial">
          <h3>{{ $t("tutorial.step1.title") }}</h3>
          <p>{{ $t("tutorial.step1.content") }}</p>
          <div class="tutorial-actions">
            <el-button type="primary" @click="nextTutorialStep">{{
              $t("tutorial.nextStep")
            }}</el-button>
            <div class="tutorial-hint">
              <small>{{ $t("tutorial.navigationHint") }}</small>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 2: highlight the bottom case bar -->
      <div v-if="currentTutorialStep === 2" class="tutorial-step-2">
        <!-- Bottom case bar highlight area -->
        <div class="bottom-highlight-area"></div>
        <!-- Tutorial content -->
        <div class="tutorial-content bottom-tutorial">
          <h3>{{ $t("tutorial.step2.title") }}</h3>
          <p>{{ $t("tutorial.step2.content") }}</p>
          <div class="tutorial-actions">
            <el-button @click="prevTutorialStep">{{
              $t("tutorial.prevStep")
            }}</el-button>
            <el-button type="primary" @click="nextTutorialStep">{{
              $t("tutorial.nextStep")
            }}</el-button>
            <div class="tutorial-hint">
              <small>{{ $t("tutorial.navigationHint") }}</small>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 3: highlight the chat bar -->
      <div v-if="currentTutorialStep === 3" class="tutorial-step-3">
        <!-- Chat input area highlight area -->
        <div class="input-highlight-area"></div>
        <!-- Tutorial content -->
        <div class="tutorial-content input-tutorial">
          <h3>{{ $t("tutorial.step3.title") }}</h3>
          <p>{{ $t("tutorial.step3.content") }}</p>
          <div class="tutorial-actions">
            <el-button @click="prevTutorialStep">{{
              $t("tutorial.prevStep")
            }}</el-button>
            <el-button type="primary" @click="completeTutorial">{{
              $t("tutorial.complete")
            }}</el-button>
            <div class="tutorial-hint">
              <small>{{ $t("tutorial.navigationHint") }}</small>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Left sidebar -->
    <Sidebar
      :chatList="chatList"
      :currentChatId="currentChatId"
      :collapsed="leftSidebarCollapsed"
      :showTutorial="showTutorial && currentTutorialStep === 1"
      @selectChat="selectChat"
      @startNewChat="startNewChat"
      @openKnowledgeBase="openKnowledgeBase"
      @handleSidebarCollapse="handleSidebarCollapse"
      @startTutorial="startTutorial"
      @chatRenamed="handleChatRenamed"
      @chatDeleted="handleChatDeleted"
      @chatFavorited="handleChatFavorited"
    />
    <!-- Center chat area -->
    <div class="chat-main">
      <div class="chat-header">
        <router-link v-if="UserStore.permission !== 'guest'" to="/help">
          <h2>{{ $t("chat.title") }}</h2>
        </router-link>
        <div v-else></div>
        <div class="header-controls">
          <LangSwitch class="header-lang-switch" />
          <el-button
            v-if="isDevelopment"
            type="primary"
            size="small"
            @click="testParallelChats"
            style="margin-left: 10px"
          >
            测试并行对话
          </el-button>
        </div>
      </div>

      <!-- Message area -->
      <div class="message-container" ref="messageContainer" :key="timestamp">
        <template v-if="currentChat?.messages?.length">
          <div
            v-for="(message, index) in currentChat.messages"
            :key="index"
            class="message"
            :class="message.role"
          >
            <!-- Only assistant messages show an avatar -->
            <div v-if="message.role === 'assistant'" class="message-avatar">
              <el-avatar :size="36" :src="botAvatar" />
            </div>
            <div class="message-content">
              <!-- User message, or an answer without reasoning steps -->
              <div
                v-if="
                  message.role === 'user' ||
                  (!message.steps && !message.tableHeaders)
                "
                class="message-text"
                :class="{ 'has-user': message.role === 'user' }"
              >
                <!-- Log view - two-column layout -->
                <div
                  v-if="
                    message.role === 'assistant' &&
                    message.tool_name === 'AnalystAgent' &&
                    message.showLog
                  "
                  class="log-view-container"
                >
                  <div class="log-view-left">
                    <h4>回复内容</h4>
                    <MarkdownViewer
                      :instantMessage="
                        (message?.instantMessage &&
                          currentChat.messages.length - 1 == index) ||
                        false
                      "
                      :content="message.content"
                      @finish="() => handleMarkdownFinish(index)"
                    />
                  </div>
                  <div class="log-view-right">
                    <h4>执行日志 (ID: {{ message.id }})</h4>

                    <!-- Update log button -->
                    <div class="log-actions">
                      <el-button
                        type="primary"
                        size="small"
                        @click="updateLog(message.task_id)"
                        :loading="updatingLog[message.task_id || '']"
                        :disabled="!message.task_id"
                      >
                        <el-icon>
                          <Refresh />
                        </el-icon>
                        更新日志
                      </el-button>
                    </div>

                    <div
                      v-if="loadingLog[message.id || '']"
                      class="log-loading"
                    >
                      <el-icon class="is-loading">
                        <Loading />
                      </el-icon>
                      加载日志中...
                    </div>
                    <div
                      v-else-if="logData[message.id || '']"
                      class="log-content"
                    >
                      <!-- New log rendering logic -->
                      <div
                        v-if="typeof logData[message.id || ''] === 'string'"
                        class="log-text-content"
                      >
                        <pre
                          class="log-pre"
                          v-html="
                            formatLogContentWithColors(
                              logData[message.id || '']
                            )
                          "
                        ></pre>
                      </div>
                      <!-- Legacy table rendering logic (backward compatible) -->
                      <el-table
                        v-else-if="Array.isArray(logData[message.id || ''])"
                        :data="logData[message.id || '']"
                        border
                        style="width: 100%"
                      >
                        <el-table-column
                          prop="content"
                          label="日志内容"
                          align="left"
                        />
                      </el-table>
                    </div>
                    <div v-else class="log-error">
                      暂无日志数据 (loadingLog:
                      {{ loadingLog[message.id || ""] }}, logData:
                      {{ !!logData[message.id || ""] }})
                    </div>
                  </div>
                </div>

                <!-- Normal message content -->
                <div v-else>
                  <!-- GeneNetworkAgent image display -->
                  <div
                    v-if="
                      message.role === 'assistant' &&
                      message.tool_name === 'GeneNetworkAgent'
                    "
                    class="gene-network-images"
                  >
                    <div
                      v-if="geneNetworkImagesLoading[message.id || '']"
                      class="images-loading"
                    >
                      <el-icon class="is-loading"><Loading /></el-icon>
                      {{ $t("common.loading") }}
                    </div>
                    <div
                      v-else-if="
                        geneNetworkImages[message.id || '']?.length > 0
                      "
                      class="images-container"
                    >
                      <img
                        v-for="(imgUrl, imgIndex) in geneNetworkImages[
                          message.id || ''
                        ]"
                        :key="imgIndex"
                        :src="imgUrl"
                        :alt="'Result ' + (imgIndex + 1)"
                        class="result-image"
                      />
                    </div>
                    <div v-else class="no-images">
                      {{ $t("common.noData") }}
                    </div>
                  </div>
                  <!-- DigitalDesignAgent image display -->
                  <div
                    v-else-if="
                      message.role === 'assistant' &&
                      message.tool_name === 'DigitalDesignAgent'
                    "
                    class="gene-network-images"
                  >
                    <div
                      v-if="digitalDesignImagesLoading[message.id || '']"
                      class="images-loading"
                    >
                      <el-icon class="is-loading"><Loading /></el-icon>
                      {{ $t("common.loading") }}
                    </div>
                    <div
                      v-else-if="
                        digitalDesignImages[message.id || '']?.length > 0
                      "
                      class="images-container"
                    >
                      <img
                        v-for="(imgUrl, imgIndex) in digitalDesignImages[
                          message.id || ''
                        ]"
                        :key="imgIndex"
                        :src="imgUrl"
                        :alt="'Result ' + (imgIndex + 1)"
                        class="result-image"
                      />
                    </div>
                    <div v-else class="no-images">
                      {{ $t("common.noData") }}
                    </div>
                  </div>
                  <!-- DeepGenomeAgent responses use a dedicated viewer component with a references list;
                       other tool_name values fall back to the generic MarkdownViewer -->
                  <DeepGenomeResultViewer
                    v-else-if="
                      message.doc_list &&
                      message.doc_list.length > 0 &&
                      message.role === 'assistant' &&
                      message.tool_name === 'DeepGenomeAgent'
                    "
                    :markdown="message.content.replace(/\n/g, '\\n')"
                    :references="message.doc_list || []"
                  />
                  <MarkdownViewer
                    v-else
                    :instantMessage="
                      (message?.instantMessage &&
                        currentChat.messages.length - 1 == index) ||
                      false
                    "
                    :content="message.content"
                    @finish="() => handleMarkdownFinish(index)"
                  />
                </div>

                <!-- File list display for user messages -->
                <div
                  v-if="
                    message.role === 'user' &&
                    message.attachedFiles &&
                    message.attachedFiles.length > 0
                  "
                  class="message-files"
                >
                  <div class="files-list">
                    <div
                      v-for="(file, fileIndex) in message.attachedFiles"
                      :key="fileIndex"
                      class="file-item-display"
                    >
                      <FilesCard
                        :uid="fileIndex"
                        :name="file.name"
                        :file-size="file.size"
                        :show-del-icon="false"
                      />
                    </div>
                  </div>
                </div>
                <div
                  v-if="
                    message.tool_name !== 'DeepGenomeAgent' &&
                    message.doc_list &&
                    message.doc_list.length > 0
                  "
                >
                  <div class="doc-list-title">
                    {{ $t("chat.relatedDocuments") }}：
                  </div>
                  <div
                    class="doc-list-item"
                    v-for="(doc, docIndex) in message.doc_list"
                    :key="docIndex"
                  >
                    <div v-if="doc.title" class="doc-simple">
                      {{ docIndex + 1 + "、" }}{{ doc.title }}
                    </div>
                    <div v-else-if="doc.au || doc.ti" class="doc-detailed">
                      <div class="doc-citation">
                        {{ docIndex + 1 }}. {{ formatDetailedCitation(doc)
                        }}<span v-if="doc.dl || doc.pm"
                          >.
                          <span v-if="doc.dl" class="doc-link-inline"
                            >doi:<a
                              :href="doc.dl"
                              target="_blank"
                              class="doi-link"
                              >{{ doc.dl }}</a
                            ></span
                          ><span v-if="doc.dl && doc.pm">; </span
                          ><span v-if="doc.pm" class="doc-link-inline"
                            >pmid:<a
                              :href="`https://pubmed.ncbi.nlm.nih.gov/${doc.pm}`"
                              target="_blank"
                              class="pmid-link"
                              >{{ doc.pm }}</a
                            ></span
                          ></span
                        >
                      </div>
                    </div>
                  </div>
                  <!-- Debug info: shows the full doc_list data; hidden by default -->
                  <div
                    v-if="false"
                    class="debug-info"
                    style="
                      margin-top: 8px;
                      padding: 8px;
                      background-color: #f5f5f5;
                      border-radius: 4px;
                      font-size: 12px;
                      color: #666;
                    "
                  >
                    <strong>调试信息 (doc_list):</strong>
                    <pre
                      style="
                        margin: 4px 0;
                        white-space: pre-wrap;
                        word-break: break-word;
                      "
                      >{{ JSON.stringify(message.doc_list, null, 2) }}</pre
                    >
                  </div>
                </div>
                <el-button
                  @click="() => downloadFile(message?.upload_path)"
                  v-if="
                    message?.status &&
                    message?.status == 'SUCCEEDED' &&
                    message?.upload_path &&
                    message?.upload_path !== ''
                  "
                  type="primary"
                >
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{
                    $t("chat.downloadURL")
                  }}</span>
                </el-button>

                <!-- Download button based on download_path -->
                <el-button
                  @click="() => downloadFileDirect(message?.download_path)"
                  v-if="
                    message?.download_path &&
                    message?.download_path !== '' &&
                    message?.tool_name !== 'GeneNetworkAgent' &&
                    message?.tool_name !== 'DigitalDesignAgent'
                  "
                  type="primary"
                  style="margin-left: 8px"
                >
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{
                    $t("chat.downloadFile")
                  }}</span>
                </el-button>

                <!-- Log button - only shown for the AnalystAgent type -->
                <div
                  v-if="
                    message.role === 'assistant' &&
                    message.tool_name === 'AnalystAgent'
                  "
                  class="log-button-container"
                >
                  <el-button
                    type="primary"
                    size="small"
                    @click="toggleLogView(message.id)"
                    :class="{ active: message.showLog }"
                  >
                    <el-icon>
                      <Document />
                    </el-icon>
                    {{
                      message.showLog ? $t("chat.hideLog") : $t("chat.showLog")
                    }}
                  </el-button>
                </div>

                <!-- Follow-up questions display -->
                <FollowUpQuestions
                  v-if="
                    message.role === 'assistant' &&
                    message.followUpQuestions &&
                    message.followUpQuestions.length > 0 &&
                    message.showFollowUpQuestions &&
                    index == currentChat.messages.length - 1
                  "
                  :questions="message.followUpQuestions"
                  @question-click="handleFollowUpQuestionClick"
                />

                <div v-if="message.role === 'user'" class="message-user">
                  <div
                    class="message-fotter"
                    v-if="copyVisible == 0 || copyVisible !== index + 1"
                  >
                    <el-tooltip
                      effect="dark"
                      :content="$t('chat.copy')"
                      placement="top-start"
                    >
                      <div class="message-fotter-item">
                        <el-icon
                          @click="
                            () => {
                              fallbackCopyText(message.content, index + 1);
                            }
                          "
                        >
                          <CopyDocument />
                        </el-icon>
                      </div>
                    </el-tooltip>
                  </div>
                  <div
                    class="message-fotter"
                    v-else-if="copyVisible == index + 1"
                  >
                    <div class="message-fotter-item">
                      <el-icon>
                        <SuccessFilled />
                      </el-icon>
                    </div>
                  </div>
                </div>
                <div v-else>
                  <div class="message-fotter">
                    <el-tooltip
                      effect="dark"
                      :content="$t('chat.copy')"
                      placement="top-start"
                      v-if="copyVisible == 0 || copyVisible !== index + 1"
                    >
                      <div class="message-fotter-item">
                        <el-icon
                          @click="() => copyMessageWithDocs(message, index)"
                        >
                          <CopyDocument />
                        </el-icon>
                      </div>
                    </el-tooltip>
                    <div
                      class="message-fotter-item"
                      v-else-if="copyVisible == index + 1"
                    >
                      <el-icon>
                        <SuccessFilled />
                      </el-icon>
                    </div>
                    <el-tooltip
                      effect="dark"
                      content="刷新回复"
                      placement="top-start"
                    >
                      <div class="message-fotter-item">
                        <el-icon
                          @click="() => refreshMessage(index)"
                          :class="{
                            'is-loading':
                              refreshingMessages[
                                `${index}_${message.id || ''}`
                              ] || isSending,
                          }"
                        >
                          <Refresh />
                        </el-icon>
                      </div>
                    </el-tooltip>

                    <!-- Upvote / downvote buttons -->
                    <div
                      v-if="message.role === 'assistant' && message.id"
                      class="reaction-buttons"
                    >
                      <el-tooltip
                        effect="dark"
                        :content="getReactionTooltip(message.id, 1)"
                        placement="top"
                      >
                        <div
                          class="message-fotter-item reaction-btn"
                          :class="{
                            active: getReactionState(message.id) === 1,
                          }"
                          @click="handleReaction(message.id, 1)"
                        >
                          <el-icon>
                            <SuccessFilled
                              v-if="getReactionState(message.id) === 1"
                            />
                            <CircleCheck v-else />
                          </el-icon>
                        </div>
                      </el-tooltip>
                      <el-tooltip
                        effect="dark"
                        :content="getReactionTooltip(message.id, 2)"
                        placement="top"
                      >
                        <div
                          class="message-fotter-item reaction-btn"
                          :class="{
                            active: getReactionState(message.id) === 2,
                          }"
                          @click="handleReaction(message.id, 2)"
                        >
                          <el-icon>
                            <CircleCloseFilled
                              v-if="getReactionState(message.id) === 2"
                            />
                            <CircleClose v-else />
                          </el-icon>
                        </div>
                      </el-tooltip>
                    </div>

                    <el-dropdown
                      v-if="downloadWhiteList.includes(message.tool_name)"
                      placement="top-start"
                      trigger="click"
                      @command="(v) => getFileDownUrl(message.id, v)"
                    >
                      <div class="message-fotter-item">
                        <el-icon style="vertical-align: middle">
                          <Download />
                        </el-icon>
                      </div>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item
                            v-for="(item, index) in message?.tool_name ==
                            'DataAgent'
                              ? ['PDF', 'Markdown', 'Xlsx']
                              : ['PDF', 'Markdown', 'Word']"
                            :key="index"
                            :command="item"
                            >{{ item }}</el-dropdown-item
                          >
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
                <div v-if="message.role === 'assistant'" class="tip-text">
                  {{ $t("common.Tip") }}
                </div>
              </div>
              <!-- Table data display -->
              <div v-else-if="message.tableHeaders" class="table-response">
                <el-table :data="message.content" border style="width: 100%">
                  <el-table-column
                    v-for="header in message.tableHeaders"
                    :key="header.prop"
                    :prop="header.prop"
                    :label="header.label"
                    align="center"
                  />
                </el-table>
                <el-button
                  @click="() => downloadFile(message?.upload_path)"
                  v-if="
                    message?.status &&
                    message?.status == 'SUCCEEDED' &&
                    message?.upload_path &&
                    message?.upload_path !== ''
                  "
                  type="primary"
                >
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{
                    $t("chat.downloadURL")
                  }}</span>
                </el-button>

                <!-- Download button based on download_path -->
                <el-button
                  @click="() => downloadFileDirect(message?.download_path)"
                  v-if="
                    message?.download_path &&
                    message?.download_path !== '' &&
                    message?.tool_name !== 'GeneNetworkAgent' &&
                    message?.tool_name !== 'DigitalDesignAgent'
                  "
                  type="primary"
                  style="margin-left: 8px"
                >
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{
                    $t("chat.downloadFile")
                  }}</span>
                </el-button>

                <!-- Follow-up questions display -->
                <FollowUpQuestions
                  v-if="
                    message.followUpQuestions &&
                    message.followUpQuestions.length > 0 &&
                    message.showFollowUpQuestions &&
                    index == currentChat.messages.length - 1
                  "
                  :questions="message.followUpQuestions"
                  @question-click="handleFollowUpQuestionClick"
                />
                <div class="message-fotter">
                  <el-tooltip
                    effect="dark"
                    :content="$t('chat.copy')"
                    placement="top-start"
                    v-if="copyVisible == 0 || copyVisible !== index + 1"
                  >
                    <div class="message-fotter-item">
                      <el-icon
                        @click="fallbackCopyText(message.original, index + 1)"
                      >
                        <CopyDocument />
                      </el-icon>
                    </div>
                  </el-tooltip>
                  <div
                    class="message-fotter-item"
                    v-else-if="copyVisible == index + 1"
                  >
                    <el-icon>
                      <SuccessFilled />
                    </el-icon>
                  </div>
                  <el-tooltip
                    effect="dark"
                    content="刷新回复"
                    placement="top-start"
                  >
                    <div class="message-fotter-item">
                      <el-icon
                        @click="() => refreshMessage(index)"
                        :class="{
                          'is-loading':
                            refreshingMessages[
                              `${index}_${message.id || ''}`
                            ] || isSending,
                        }"
                      >
                        <Refresh />
                      </el-icon>
                    </div>
                  </el-tooltip>

                  <!-- Upvote / downvote buttons -->
                  <div
                    v-if="message.role === 'assistant' && message.id"
                    class="reaction-buttons"
                  >
                    <el-tooltip
                      effect="dark"
                      :content="getReactionTooltip(message.id, 1)"
                      placement="top"
                    >
                      <div
                        class="message-fotter-item reaction-btn"
                        :class="{ active: getReactionState(message.id) === 1 }"
                        @click="handleReaction(message.id, 1)"
                      >
                        <el-icon>
                          <SuccessFilled
                            v-if="getReactionState(message.id) === 1"
                          />
                          <CircleCheck v-else />
                        </el-icon>
                      </div>
                    </el-tooltip>
                    <el-tooltip
                      effect="dark"
                      :content="getReactionTooltip(message.id, 2)"
                      placement="top"
                    >
                      <div
                        class="message-fotter-item reaction-btn"
                        :class="{ active: getReactionState(message.id) === 2 }"
                        @click="handleReaction(message.id, 2)"
                      >
                        <el-icon>
                          <CircleCloseFilled
                            v-if="getReactionState(message.id) === 2"
                          />
                          <CircleClose v-else />
                        </el-icon>
                      </div>
                    </el-tooltip>
                  </div>

                  <el-dropdown
                    v-if="downloadWhiteList.includes(message.tool_name)"
                    placement="top-start"
                    trigger="click"
                    @command="(v) => getFileDownUrl(message.id, v)"
                  >
                    <div class="message-fotter-item">
                      <el-icon style="vertical-align: middle">
                        <Download />
                      </el-icon>
                    </div>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item
                          v-for="(item, index) in message?.tool_name ==
                          'DataAgent'
                            ? ['PDF', 'Markdown', 'Xlsx']
                            : ['PDF', 'Markdown', 'Word']"
                          :key="index"
                          :command="item"
                          >{{ item }}</el-dropdown-item
                        >
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
              <!-- Assistant answer with reasoning steps; currently unused 2025/07/21 -->
              <div v-else class="ai-response">
                <!-- Reasoning steps -->
                <div v-if="message.steps && message.steps.length > 0">
                  <div class="steps-title">{{ $t("chat.stepResult") }}：</div>
                  <div
                    v-for="(step, stepIndex) in message.steps"
                    :key="stepIndex"
                    class="step-item"
                  >
                    <div v-if="stepIndex === 0" class="step-label">
                      {{ $t("chat.useTool") }}
                    </div>
                    <div v-else class="step-label">
                      {{ $t("chat.stepResult") }}
                    </div>
                    <div class="step-text">{{ step }}</div>
                  </div>
                </div>
                <!-- Final answer -->
                <div class="final-answer">
                  <MarkdownViewer
                    :instantMessage="
                      (message?.instantMessage &&
                        currentChat.messages.length - 1 == index) ||
                      false
                    "
                    :content="message.content"
                    @finish="() => handleMarkdownFinish(index)"
                  />
                </div>
                <el-button
                  @click="() => downloadFile(message?.upload_path)"
                  v-if="
                    message?.status &&
                    message?.status == 'SUCCEEDED' &&
                    message?.upload_path &&
                    message?.upload_path !== ''
                  "
                  type="primary"
                >
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{
                    $t("chat.downloadURL")
                  }}</span>
                </el-button>

                <!-- Download button based on download_path -->
                <el-button
                  @click="() => downloadFileDirect(message?.download_path)"
                  v-if="
                    message?.download_path &&
                    message?.download_path !== '' &&
                    message?.tool_name !== 'GeneNetworkAgent' &&
                    message?.tool_name !== 'DigitalDesignAgent'
                  "
                  type="primary"
                  style="margin-left: 8px"
                >
                  <el-icon style="vertical-align: middle">
                    <Download />
                  </el-icon>
                  <span style="vertical-align: middle">{{
                    $t("chat.downloadFile")
                  }}</span>
                </el-button>

                <!-- Follow-up questions display -->
                <FollowUpQuestions
                  v-if="
                    message.followUpQuestions &&
                    message.followUpQuestions.length > 0 &&
                    message.showFollowUpQuestions &&
                    index == currentChat.messages.length - 1
                  "
                  :questions="message.followUpQuestions"
                  @question-click="handleFollowUpQuestionClick"
                />
                <div class="message-fotter">
                  <el-tooltip
                    effect="dark"
                    :content="$t('chat.copy')"
                    placement="top-start"
                    v-if="copyVisible == 0 || copyVisible !== index + 1"
                  >
                    <div class="message-fotter-item">
                      <el-icon
                        @click="() => copyMessageWithDocs(message, index)"
                      >
                        <CopyDocument />
                      </el-icon>
                    </div>
                  </el-tooltip>
                  <div
                    class="message-fotter-item"
                    v-else-if="copyVisible == index + 1"
                  >
                    <el-icon>
                      <SuccessFilled />
                    </el-icon>
                  </div>
                  <el-tooltip
                    effect="dark"
                    content="刷新回复"
                    placement="top-start"
                  >
                    <div class="message-fotter-item">
                      <el-icon
                        @click="() => refreshMessage(index)"
                        :class="{
                          'is-loading':
                            refreshingMessages[`${index}_${message.id || ''}`],
                        }"
                      >
                        <Refresh />
                      </el-icon>
                    </div>
                  </el-tooltip>

                  <!-- Upvote / downvote buttons -->
                  <div
                    v-if="message.role === 'assistant' && message.id"
                    class="reaction-buttons"
                  >
                    <el-tooltip
                      effect="dark"
                      :content="getReactionTooltip(message.id, 1)"
                      placement="top"
                    >
                      <div
                        class="message-fotter-item reaction-btn"
                        :class="{ active: getReactionState(message.id) === 1 }"
                        @click="handleReaction(message.id, 1)"
                      >
                        <el-icon>
                          <SuccessFilled
                            v-if="getReactionState(message.id) === 1"
                          />
                          <CircleCheck v-else />
                        </el-icon>
                      </div>
                    </el-tooltip>
                    <el-tooltip
                      effect="dark"
                      :content="getReactionTooltip(message.id, 2)"
                      placement="top"
                    >
                      <div
                        class="message-fotter-item reaction-btn"
                        :class="{ active: getReactionState(message.id) === 2 }"
                        @click="handleReaction(message.id, 2)"
                      >
                        <el-icon>
                          <CircleCloseFilled
                            v-if="getReactionState(message.id) === 2"
                          />
                          <CircleClose v-else />
                        </el-icon>
                      </div>
                    </el-tooltip>
                  </div>

                  <el-dropdown
                    v-if="downloadWhiteList.includes(message.tool_name)"
                    placement="top-start"
                    trigger="click"
                    @command="(v) => getFileDownUrl(message.id, v)"
                  >
                    <div class="message-fotter-item">
                      <el-icon style="vertical-align: middle">
                        <Download />
                      </el-icon>
                    </div>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item
                          v-for="(item, index) in message?.tool_name ==
                          'DataAgent'
                            ? ['PDF', 'Markdown', 'Xlsx']
                            : ['PDF', 'Markdown', 'Word']"
                          :key="index"
                          :command="item"
                          >{{ item }}</el-dropdown-item
                        >
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Loading message -->
        <div v-if="isSending" class="message assistant">
          <div class="message-avatar">
            <el-avatar :size="36" :src="botAvatar" />
          </div>
          <div class="message-content">
            <div class="message-text loading-message">
              {{ $t("chat.ladingInner") }}
              <div class="loading-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
              <SendProgress
                :started-at="getChatState(currentChatId).sendStartedAt"
                :agent-name="getChatState(currentChatId).activeAgentName"
                :completing="getChatState(currentChatId).completing"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Input area -->
      <div
        class="input-container"
        :style="{ bottom: currentChat?.messages?.length ? '2%' : '30%' }"
      >
        <div v-if="!currentChat?.messages?.length" class="empty-chat">
          <div class="welcome-container">
            <div class="welcome-container-text">
              <div class="welcome-container-text1">
                <img
                  src="../../assets/images/chat/logo.png"
                  class="logo"
                  alt="Logo"
                />{{ $t("chat.welcomeTitle") }}
              </div>
              <div class="welcome-container-text2">
                {{ $t("chat.welcomeSubtitle") }}
              </div>
            </div>
          </div>
          <ChatModeSelector
            v-model="chatMode"
            :expert-enabled="expertModeEnabled"
            class="empty-chat-mode"
          />
        </div>
        <div
          class="input-container-warpper"
          :class="{
            'show-tutorial': showTutorial && currentTutorialStep === 3,
          }"
        >
          <div class="input-box">
            <!-- Abort button - moved outside MentionSender so it stays clickable while sending -->
            <div v-if="isSending" class="abort-button-overlay">
              <el-tooltip content="中止回答" placement="top">
                <el-button round color="#f56c6c" :aria-label="$t('chat.abortAriaLabel')" @click="abortCurrentRequest">
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
              @keydown.enter.capture="onComposerEnterCapture"
            >
              <!-- Custom header feature list -->
              <template #header>
                <div class="header-self-wrap">
                  <!-- File list area - only shown before sending -->
                  <div
                    v-if="fileList.length > 0 && !isSending"
                    class="file-list-container"
                  >
                    <div class="file-list">
                      <div
                        v-for="(file, index) in fileList"
                        :key="index"
                        class="file-item"
                      >
                        <FilesCard
                          :uid="index"
                          :name="file.name"
                          :file-size="file.size"
                          :show-del-icon="true"
                          @delete="removeFile(index)"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </template>

              <!-- Custom bottom-left feature list -->
              <template #prefix>
                <div
                  style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-wrap: wrap;
                  "
                >
                  <el-upload
                    ref="uploadRef"
                    class="upload-demo"
                    :limit="10"
                    accept=".pdf,.doc,.xlsx,.ppt,.txt,.png"
                    :show-file-list="false"
                    :auto-upload="false"
                    :disabled="isSending"
                    :on-change="handleFileChange"
                    multiple
                    action="#"
                  >
                    <template #trigger>
                      <el-tooltip
                        :content="$t('chat.uploadFile')"
                        placement="top"
                      >
                        <el-button round plain color="#626aef" :aria-label="$t('chat.uploadFile')">
                          <el-icon>
                            <Paperclip />
                          </el-icon>
                        </el-button>
                      </el-tooltip>
                    </template>
                  </el-upload>
                  <el-dropdown
                    v-if="currentChat?.messages?.length"
                    placement="top-start"
                    trigger="click"
                    :disabled="isSending"
                    @command="handleCommand"
                  >
                    <el-button round plain color="#626aef">
                      <el-icon>
                        <Menu />
                      </el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu v-if="rolesTool.length > 0">
                        <el-dropdown-item
                          v-for="(item, index) in rolesTool"
                          :key="index"
                          :command="'@' + item + ','"
                          >{{ item }}</el-dropdown-item
                        >
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </template>

              <!-- Custom bottom-right feature list -->
              <template #action-list>
                <div style="display: flex; align-items: center; gap: 8px">
                  <!-- Send button -->
                  <div
                    v-if="!messageInput.trim() || isSending"
                    class="send-btn"
                  >
                    <el-tooltip
                      :content="$t('chat.inputPlaceholderTip')"
                      placement="top"
                    >
                      <el-button round color="#cbcdcd" :aria-label="$t('chat.sendAriaLabel')">
                        <el-icon>
                          <Promotion />
                        </el-icon>
                      </el-button>
                    </el-tooltip>
                  </div>
                  <div v-else class="send-btn" @click="sendMessage">
                    <el-button round color="#626aef" :aria-label="$t('chat.sendAriaLabel')">
                      <el-icon>
                        <Promotion />
                      </el-icon>
                    </el-button>
                  </div>
                </div>
              </template>

              <!-- Custom footer slot -->
              <template #footer>
                <div
                  v-if="!currentChat?.messages?.length"
                  style="
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 12px;
                  "
                >
                  <!-- Permission loading state -->
                  <div v-if="rolesLoading" class="roles-loading">
                    <el-icon class="is-loading">
                      <Loading />
                    </el-icon>
                    加载智能体权限中...
                  </div>

                  <!-- Agent button area -->
                  <template v-else-if="rolesTool.length > 0 && chatMode === 'instant'">
                    <div
                      style="
                        width: 100px;
                        height: 50px;
                        margin-right: 20px;
                        cursor: pointer;
                      "
                      @click="showAgentsView"
                    >
                      <img
                        src="/src/assets/images/chat/Agents.png"
                        alt="Agents"
                        style="width: 100%; height: 100%"
                      />
                    </div>
                    <div class="input-actions">
                      <div
                        v-for="(item, index) in rolesTool"
                        :key="index"
                        class="agent-item-wrapper"
                      >
                        <el-tooltip placement="top">
                          <template #content>
                            <div class="agent-tooltip-content">
                              <p>{{ getAgentTooltip(item) }}</p>
                            </div>
                            <a
                              class="more-button"
                              @click="showMoreInfo(item)"
                              :disabled="isSending"
                            >
                              {{ $t("chat.more") }}
                            </a>
                          </template>
                          <div
                            class="agent-button"
                            :class="{
                              'agent-button-active': activeButton === item,
                            }"
                            @click="handleButtonClick(item)"
                            :style="{
                              opacity: isSending ? 0.6 : 1,
                              cursor: isSending ? 'not-allowed' : 'pointer',
                            }"
                          >
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
      <div
        v-if="
          !currentChat?.messages?.length &&
          UserStore.permission !== 'guest' &&
          chatMode === 'instant'
        "
        class="input-container-bottom"
        :class="{ 'show-tutorial': showTutorial && currentTutorialStep === 2 }"
        @wheel.prevent="handleScroll"
        :style="containerStyle"
      >
        <div class="agent-list">
          <div class="agent-page">
            <div
              v-for="agent in presetAgents"
              :key="agent.id"
              class="input-container-bottom-item"
              @click="isSending ? null : handleAgentClick(agent)"
              :style="{
                opacity: isSending ? 0.6 : 1,
                cursor: isSending ? 'not-allowed' : 'pointer',
              }"
            >
              <span>{{ agent.name }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="chat-footer">
        {{ $t("chat.footer") }}
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          class="icp-link"
          :aria-label="$t('chat.icpAriaLabel')"
          >京ICP备07026971号-9</a
        >
      </div>
    </div>

    <!-- Right sidebar -->
    <div class="right-sidebar" :class="{ 'is-open': drawerVisible }">
      <div class="sidebar-header">
        <h3>{{ $t("chat.detailInfo") }}</h3>
        <el-button type="text" @click="drawerVisible = false" class="close-btn">
          <el-icon><icon-close /></el-icon>
        </el-button>
      </div>
      <div class="sidebar-content">
        <h3>{{ $t("chat.relatedLinks") }}</h3>
        <div class="links-container">
          <div
            v-for="(link, index) in currentLinks"
            :key="index"
            class="link-item"
          >
            <el-icon>
              <Link />
            </el-icon>
            <a :href="link.url" target="_blank">{{ link.title }}</a>
          </div>
        </div>
      </div>
    </div>

    <!-- Agents architecture diagram dialog -->
    <el-dialog
      v-model="agentsViewVisible"
      title="Phytomni智能体架构"
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      width="800px"
      center
    >
      <div
        class="agents-view-container"
        @wheel="handleWheel"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseUp"
        ref="containerRef"
        style="overflow: hidden; cursor: grab"
      >
        <img
          ref="imageRef"
          :src="AgentsViewImg"
          alt="Phytomni智能体架构图"
          class="agents-view-image"
          :style="imageStyle"
        />
      </div>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref, nextTick, watch, computed } from "vue";
import Sidebar from "./sidebar.vue";
import { MentionSender } from "vue-element-plus-x";
import SendProgress from "./components/SendProgress.vue";
import ChatModeSelector from "@/components/ChatModeSelector.vue";
import {
  Close as IconClose,
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
} from "@element-plus/icons-vue";
import { getHistoryQuestionList } from "@/api/chat";
import { userStore } from "@/stores";
import { useTutorial } from "./composables/useTutorial";
import { useImageZoomPan } from "./composables/useImageZoomPan";
import { useChatStates } from "./composables/useChatStates";
import { useAgentImages } from "./composables/useAgentImages";
import { useReactions } from "./composables/useReactions";
import { useCopyDownload } from "./composables/useCopyDownload";
import { useFileUpload } from "./composables/useFileUpload";
import { useAgentsPanel } from "./composables/useAgentsPanel";
import { useSelectChat } from "./composables/useSelectChat";
import { useSendMessage } from "./composables/useSendMessage";
import { useRefreshMessage } from "./composables/useRefreshMessage";
import { useLogView } from "./composables/useLogView";
import { useComposer } from "./composables/useComposer";
import LangSwitch from "@/components/LangSwitch.vue";
import { useI18n } from "vue-i18n";
import type { UploadInstance } from "element-plus";
import {
  Paperclip,
  Promotion,
  Close,
} from "@element-plus/icons-vue";
import { useRouter } from "vue-router";
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import FollowUpQuestions from "./FollowUpQuestions.vue";
import { FilesCard } from "vue-element-plus-x";
import AgentsViewImg from "@/assets/images/chat/AgentsView.png";
import { isValidPendingRecord, matchesChat, safeParse } from "@/utils/pending-chat";
import { formatDetailedCitation } from "@/utils/citation";
import { formatLogContentWithColors } from "./utils/agent-log";
import { guardEnterSubmit } from "./utils/guardEnterSubmit";
import type { Chat, ChatMessage } from "./types";

const uploadRef = ref<UploadInstance>();
const senderRef = ref();

// Capture-phase guard that swallows Enter while the mention dropdown is open,
// preventing MentionSender's internal handleKeyDown from triggering submit()
// while the dropdown is still visible.
// popoverVisible is a ComputedRef exposed by MentionSender via __expose.
const onComposerEnterCapture = (e: KeyboardEvent) => {
  guardEnterSubmit(e, senderRef.value?.popoverVisible);
};

const timestamp = ref(Date.now());

const submitUpload = () => {
  uploadRef.value!.submit();
};
const { t } = useI18n();
// Drawer state
const drawerVisible = ref(false);

// Left sidebar state
const leftSidebarCollapsed = ref(false);

// Agents architecture diagram dialog
const agentsViewVisible = ref(false);
const { scale, isDragging, imageOffset, containerRef, imageRef, imageStyle, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp } = useImageZoomPan(agentsViewVisible);

// Watch the right sidebar state; when the right side opens, ensure the left side is collapsed
watch(drawerVisible, (newValue) => {
  if (newValue === true && !leftSidebarCollapsed.value) {
    // Right side opened, so collapse the left side
    leftSidebarCollapsed.value = true;
  }
});

const botAvatar =
  "/avatars/bot.svg";

// Show the Agents architecture diagram dialog
const showAgentsView = () => {
  agentsViewVisible.value = true;
};

// Chat list
const chatList = ref<Chat[]>([]);

// Fix: changed a static reference to a computed property to ensure reactive updates
const rolesTool = computed(() => userStore().roles);
const UserStore = userStore();
const expertModeEnabled = computed(() => userStore().expertEnabled);

// Add permission loading state management
const rolesLoading = ref(false);

// Define the button permission mapping
const buttonPermissions = {
  RAG: "RAG",
  BI: "BI",
  GA: "GA",
  webSearch: "web search",
};
// Download display whitelist
const downloadWhiteList = [
  "ChatAgent",
  "KnowledgeAgent",
  "DataAgent",
  "ReviewAgent",
];

// Check button permission
const hasButtonPermission = (buttonType: string) => {
  const permission =
    buttonPermissions[buttonType as keyof typeof buttonPermissions];
  return rolesTool.value.includes(permission);
};

const router = useRouter();

// Optimize the permission loading logic
const loadUserTools = async () => {
  if (!userStore().roles.length) {
    rolesLoading.value = true;
    try {
      await userStore().getUserTools();
    } catch (error) {
      console.error("Failed to load user permissions:", error);
    } finally {
      rolesLoading.value = false;
    }
  }
};

onMounted(async () => {
  // Load permission info first
  await loadUserTools();

  // Fetch the history question list
  getHistoryQuestionData().then(() => {
    // Restore incomplete sessions
    restorePendingChats();

    // Get the chatId from the URL
    const urlChatId = getChatIdFromUrl();

    // If chatId is absent, default to a new chat
    if (urlChatId) {
      // First check whether it is an incomplete session
      if (loadPendingChat(urlChatId)) {
        currentChatId.value = urlChatId;
        return;
      }

      // Look up whether a corresponding chat exists
      const chatExists = chatList.value.find(
        (chat) => chat.dialogue_id === urlChatId
      );
      if (chatExists) {
        // If it exists, select that chat
        selectChat(urlChatId);
      } else if (chatList.value.length > 0) {
        // If it does not exist but there are chat records, update the URL to the first record's ID
        const firstChatId = chatList.value[0].dialogue_id;
        updateUrlWithChatId(firstChatId);
        selectChat(firstChatId);
      } else {
        // If there are no chat records, create a new chat state
        startNewChat();
      }
    } else {
      // If there are no chat records, create a new chat state
      startNewChat();
    }
  });

  // Check whether the tutorial guide needs to be shown
  checkTutorialStatus();

});

// Fetch history question data
const getHistoryQuestionData = () => {
  return new Promise<void>((resolve) => {
    getHistoryQuestionList()
      .then((res: any) => {
        if (res.code === 200 && res.data) {
          // Process the returned data while keeping the original structure
          const formattedData = res.data.map((item: any) => {
            return {
              id: item.id,
              dialogue_id: item.dialogue_id,
              title: item.title_query || item.query, // Prefer title_query, fall back to query
              date: item.created_at, // Keep the original time string
              isFavorite: false, // Not favorited by default
            };
          });

          // Check the temporary chat data in localStorage
          // Scan + clean temporary localStorage records via the shared helpers
          restorePendingChats();

          // Update chatList, preserving the order returned by the API
          chatList.value = formattedData;

          // If there is currently a new chat state, try to associate it with the API-returned data
          if (currentChatId.value && currentChatId.value.startsWith("new_")) {
            // Find whether there is a newly created chat (by comparing user message content)
            const currentUserMessage = currentChat.value?.messages?.find(
              (msg: ChatMessage) => msg.role === "user"
            );
            if (currentUserMessage) {
              const matchingChat = formattedData.find((chat: Chat) => {
                // Compare the chat title with the user message content
                return (
                  chat.title === currentUserMessage.content ||
                  chat.title.includes(
                    currentUserMessage.content.substring(0, 20)
                  ) ||
                  currentUserMessage.content.includes(
                    chat.title.substring(0, 20)
                  )
                );
              });

              if (matchingChat) {
                // Found a matching chat, update the current chat ID
                currentChatId.value = matchingChat.dialogue_id;
                updateUrlWithChatId(matchingChat.dialogue_id);
              }
            }
          }
        }
        resolve();
      })
      .catch((err: any) => {
        console.error("Failed to fetch history question data:", err);
        resolve();
      });
  });
};

// Check localStorage for all incomplete sessions and remove placeholders that
// already match an entry in chatList. Unlike the legacy frontend, the Web app
// does not push placeholder entries into chatList — here chatList is driven by
// backend fetches, and pending-chat URLs are handled by loadPendingChat, avoiding
// conflicts with the parallel chatStates model.
const restorePendingChats = () => {
  const pendingChatKeys = Object.keys(localStorage).filter((key) =>
    key.startsWith("pending_chat_")
  );

  pendingChatKeys.forEach((key) => {
    const tempChatId = key.replace("pending_chat_", "");
    const pendingChatData = safeParse(localStorage.getItem(key));

    if (!isValidPendingRecord(pendingChatData)) {
      // Records that violate the contract (corrupt / legacy / partial write) — silently clean
      if (pendingChatData !== null) {
        localStorage.removeItem(key);
      }
      return;
    }

    const matchingChat = chatList.value.find((chat) =>
      matchesChat(chat, pendingChatData, tempChatId)
    );

    if (matchingChat) {
      localStorage.removeItem(key);
      if (currentChatId.value === tempChatId) {
        currentChatId.value = matchingChat.dialogue_id;
        updateUrlWithChatId(matchingChat.dialogue_id);
      }
    }
    // No match → keep in localStorage so a later loadPendingChat can load it via the URL
  });
};

// Load a specific incomplete session from localStorage (used by onMounted keyed on the url chatId)
const loadPendingChat = (dialogueId: string) => {
  const key = `pending_chat_${dialogueId}`;
  const pendingChatData = safeParse(localStorage.getItem(key));

  if (!isValidPendingRecord(pendingChatData)) {
    if (pendingChatData !== null) {
      localStorage.removeItem(key); // corrupt / contract violation → clean
    }
    return false;
  }

  currentChat.value = { messages: pendingChatData.messages };
  return true;
};

// Parallel chat state (independent UI state per dialogueId) + current chat + 10 computed proxies
const {
  chatStates,
  getChatState,
  currentChatId,
  currentChat,
  messageInput,
  isSending,
  chatMode,
  fileList,
  copyVisible,
  copyTimeRef,
  logData,
  loadingLog,
  refreshingMessages,
  updatingLog,
} = useChatStates();

// Copy conversation + file download
const { fallbackCopyText, downloadFile, downloadFileDirect, getFileDownUrl } =
  useCopyDownload({
    copyVisible,
    copyTimeRef,
    t,
  });

// Agent image fetch state (GeneNetworkAgent / DigitalDesignAgent)
const {
  geneNetworkImages,
  geneNetworkImagesLoading,
  digitalDesignImages,
  digitalDesignImagesLoading,
} = useAgentImages(currentChat);

// Abort-request related
const currentRequestId = ref<string>("");
const isAborted = ref(false);

// Start a new chat
const startNewChat = () => {
  // Create the state for a new chat
  const newDialogueId = "new_" + Date.now();
  getChatState(newDialogueId);

  // Set the current chat ID to the newly created ID
  currentChatId.value = newDialogueId;
  currentChat.value = { messages: [] };

  // Remove the id parameter from the URL
  const url = new URL(window.location.href);
  url.searchParams.delete("dialogue_id");
  window.history.pushState({}, "", url.toString());

  // Ensure scrolling to the bottom
  nextTick(() => {
    scrollToBottom();
  });
};

// Open the chat agent
const openChatAgent = () => {
  // If the left sidebar is expanded, collapse it first
  if (!leftSidebarCollapsed.value) {
    leftSidebarCollapsed.value = true;
  }

  // Open the right sidebar
  drawerVisible.value = true;
};

// Knowledge agent
const openKnowledgeAgent = () => {
  // Implement the knowledge agent feature here
};

// Database agent
const openDataAgent = () => {
  // Implement the database agent feature here
};

// Analyst agent
const openAnalystAgent = () => {
  // Implement the analyst agent feature here
};

// Review agent
const openReviewAgent = () => {
  // Implement the review agent feature here
};

// Open the knowledge base
const openKnowledgeBase = () => {
  // If the left sidebar is expanded, collapse it first
  if (!leftSidebarCollapsed.value) {
    leftSidebarCollapsed.value = true;
  }

  // Open the right sidebar
  drawerVisible.value = true;
};

// Message container ref, used for auto-scrolling
const messageContainer = ref<HTMLElement | null>(null);

// Auto-scroll to the latest message
const scrollToBottom = async () => {
  await nextTick();
  if (messageContainer.value) {
    messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
  }
};

// Input toolbar buttons + mention-selection state machine — logic extracted into the useComposer composable
const {
  activeButton,
  handleButtonClick,
  handleCommand,
  handleSelect,
  handleSearch,
} = useComposer({ messageInput, isSending, currentChatId, scrollToBottom });

// Log panel toggle + log update — logic extracted into the useLogView composable
const { toggleLogView, updateLog } = useLogView({
  isSending,
  currentChat,
  currentChatId,
  getChatState,
  scrollToBottom,
});

// File upload handling — state and logic extracted into the useFileUpload composable
const { handleFileChange, removeFile } = useFileUpload({
  fileList,
  currentChatId,
  getChatState,
  senderRef,
  scrollToBottom,
});

// Message upvote/downvote feature — state and logic extracted into the useReactions composable
const { getReactionState, handleReaction, getReactionTooltip } = useReactions({
  currentChatId,
  getChatState,
  scrollToBottom,
});

// Agents panel — state and logic extracted into the useAgentsPanel composable
const {
  presetAgents,
  containerStyle,
  handleScroll,
  handleAgentClick,
  getAgentTooltip,
  showMoreInfo,
} = useAgentsPanel({ t, isSending, router, scrollToBottom });

// Abort the current request
const abortCurrentRequest = async () => {
  if (!currentRequestId.value) return;

  try {
    // Import the abort-request helper
    const requestModule = (await import("@/utils/request")) as any;
    const success = requestModule.abortRequest(currentRequestId.value);
    if (success) {
      isAborted.value = true;

      // Add an abort message
      if (currentChat.value?.messages) {
        const abortMessage: ChatMessage = {
          role: "assistant",
          content: t("chat.generationStopped"),
          instantMessage: true,
          id: Date.now().toString(),
        };
        currentChat.value.messages.push(abortMessage);
      }

      // Reset state
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.isSending = false;
      }

      currentRequestId.value = "";

      await scrollToBottom();
    }
  } catch (error) {
    console.error("Failed to abort request:", error);
  }
};

// Use a preset question
const usePrompt = (prompt: string) => {
  if (isSending.value) return;
  messageInput.value = prompt;

  // Ensure scrolling to the bottom
  nextTick(() => {
    scrollToBottom();
  });

  sendMessage();
};

// Related links
const currentLinks = ref([
  {
    title: t("chat.links.brca1"),
    url: "https://www.ncbi.nlm.nih.gov/gene/672",
  },
  {
    title: t("chat.links.mapk"),
    url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3135676/",
  },
  {
    title: t("chat.links.tp53"),
    url: "https://p53.iarc.fr/",
  },
]);

// Sidebar control function
const handleSidebarCollapse = (isCollapsed: boolean) => {
  // Update the left sidebar state
  leftSidebarCollapsed.value = isCollapsed;

  // If the left sidebar is expanded and the right sidebar is also open, close the right side
  if (!isCollapsed && drawerVisible.value) {
    drawerVisible.value = false;
  }
};

// After the sidebar renames a session, the parent updates the chatList it holds (the child emits instead of mutating the prop)
const handleChatRenamed = (updatedChat: Chat) => {
  const index = chatList.value.findIndex(
    (c) => c.dialogue_id === updatedChat.dialogue_id
  );
  if (index !== -1) {
    chatList.value[index] = updatedChat;
  }
};

// The parent holds chatList; deletion removes the item from the list here (the child only emits the chatDeleted event).
const handleChatDeleted = (deletedChat: Chat) => {
  chatList.value = chatList.value.filter(
    (c) => c.dialogue_id !== deletedChat.dialogue_id
  );
};

// The favorite state is likewise updated by the parent (the child only emits the chatFavorited event).
const handleChatFavorited = (updatedChat: Chat) => {
  const index = chatList.value.findIndex(
    (c) => c.dialogue_id === updatedChat.dialogue_id
  );
  if (index !== -1) {
    chatList.value[index] = updatedChat;
  }
};

// Update the chat ID in the URL
const updateUrlWithChatId = (dialogueId: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set("dialogue_id", dialogueId);
  window.history.pushState({}, "", url.toString());
};

// Select a chat — history-loading logic extracted into the useSelectChat composable
const { selectChat } = useSelectChat({
  getChatState,
  currentChatId,
  currentChat,
  scrollToBottom,
  updateUrlWithChatId,
  chatList,
  timestamp,
});

// Read the chat ID from the URL
const getChatIdFromUrl = () => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("dialogue_id");
};
// Read the dialogue ID based on the chat ID
const getDialogueIdFromChatId = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const dialogueId = urlParams.get("dialogue_id");
  const chatRealId = chatList.value.find(
    (c: Chat) => c.dialogue_id === dialogueId
  )?.id;
  return chatRealId;
};

// Send message — send logic extracted into the useSendMessage composable
const { sendMessage } = useSendMessage({
  getChatState,
  currentChatId,
  currentChat,
  senderRef,
  currentRequestId,
  isAborted,
  t,
  userStore,
  getHistoryQuestionData,
  updateUrlWithChatId,
  chatList,
  timestamp,
  selectChat,
  getDialogueIdFromChatId,
  getChatIdFromUrl,
  scrollToBottom,
});

// Handle the Markdown typing-effect completion event
const handleMarkdownFinish = (messageIndex: number) => {
  if (currentChat.value?.messages && currentChat.value.messages[messageIndex]) {
    // Set the follow-up question display state to true
    currentChat.value.messages[messageIndex].showFollowUpQuestions = true;

    // Ensure scrolling to the bottom
    nextTick(() => {
      scrollToBottom();
    });
  }
};

// Handle the follow-up question click event
const handleFollowUpQuestionClick = (question: string) => {
  // If sending or refreshing, block the action
  if (isSending.value) return;

  if (!currentChatId.value) return;

  const chatState = getChatState(currentChatId.value);
  if (!chatState) return;

  // Set the clicked question as the input content
  chatState.messageInput = question;

  // Ensure scrolling to the bottom
  nextTick(() => {
    scrollToBottom();
  });

  // Auto-send the message
  nextTick(() => {
    sendMessage();
  });
};

// Message refresh (regenerate the assistant answer) — logic extracted into the useRefreshMessage composable
const { refreshMessage } = useRefreshMessage({
  currentChat,
  currentChatId,
  getChatState,
  scrollToBottom,
  getHistoryQuestionData,
  getDialogueIdFromChatId,
  timestamp,
});

// Tutorial guide feature — state and logic extracted into the useTutorial composable
const {
  showTutorial,
  currentTutorialStep,
  startTutorial,
  nextTutorialStep,
  prevTutorialStep,
  completeTutorial,
  handleTutorialOverlayClick,
  checkTutorialStatus,
} = useTutorial();

// Test the parallel chat feature
const testParallelChats = () => {
  // Create two test chats
  const chat1Id = "test_chat_1";
  const chat2Id = "test_chat_2";

  // Initialize the chat state
  getChatState(chat1Id);
  getChatState(chat2Id);

  // Set different input contents
  chatStates.value[chat1Id].messageInput = "Test message for chat 1";
  chatStates.value[chat2Id].messageInput = "Test message for chat 2";

  // Set different sending states
  chatStates.value[chat1Id].isSending = true;
  chatStates.value[chat2Id].isSending = false;

  // Verify state independence
};

// Add a test button in the development environment
const isDevelopment = import.meta.env.DEV;

// Copy message content + cited document list (extracted from an inline @click to work around a
// vue-tsc 0.39.5 bug where it mis-maps a local const declared inside a multi-statement template
// arrow function onto the component instance — see the 2 @click usages in index.vue)
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
          .join("\n")
      : "";
  const text =
    message.content + (docs && docs !== "" ? "\nReferences:\n" : "") + docs;
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

// Chat main view
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

  .icp-link {
    color: #909399;
    text-decoration: none;
    transition: color 0.3s;
    font-size: 12px;

    &:hover {
      color: #409eff;
      text-decoration: underline;
    }

    &:visited {
      color: #909399;
    }
  }
}

.theme-dark .chat-footer {
  color: #fff;

  .icp-link {
    color: #909399;

    &:hover {
      color: #409eff;
    }

    &:visited {
      color: #909399;
    }
  }
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
      box-shadow: 0 0 10px 0 rgba(212, 210, 210, 0.35);
      width: 100%;
      padding: 12px;
      border-radius: 8px;

      // GeneNetworkAgent image styles
      .gene-network-images {
        .images-loading {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #909399;
          font-size: 14px;
          padding: 12px 0;
        }

        .images-container {
          display: flex;
          flex-direction: column;
          gap: 12px;

          .result-image {
            max-width: 100%;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          }
        }

        .no-images {
          color: #909399;
          font-size: 14px;
          padding: 12px 0;
        }
      }
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
    position: relative;
    left: 50%;
    transform: translateX(-50%);
    width: 85%;
    border: 1px solid #e7e7e7;
    border-radius: 10px;
    box-shadow: 0 5px 16px -4px rgba(0, 0, 0, 0.17);

    &.show-tutorial {
      z-index: 1000 !important;
      background: #fff !important;
      border: 2px solid #1890ff;
      box-shadow: 0 0 10px 0 rgba(24, 144, 255, 0.3);
    }
  }

  .input-box {
    .header-self-wrap {
      padding: 3px 2px 2px 3px;
      box-sizing: border-box;
      width: 100%;
      display: flex;
      flex-direction: column;

      .file-list-container {
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

    .send-btn,
    .abort-btn {
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

// Right sidebar styles
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

// Loading animation
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
    // Simple format (title only)
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

// File display styles within messages
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
      // File item styles are inherited from the FilesCard component
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
  z-index: 998;

  &.show-tutorial {
    z-index: 1000 !important;
    background: #fff !important;
  }

  &::before {
    content: "";
    position: absolute;
    top: -20px;
    left: 0;
    right: 0;
    height: 20px;
    background: linear-gradient(
      to bottom,
      transparent,
      rgba(255, 255, 255, 0.9)
    );
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  &::after {
    content: "";
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
    width: 22%;
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

.show-tutorial {
  z-index: 1000 !important;
  background: #fff !important;
}
// Ensure the container can overlay other content
.input-container {
  position: relative;
}

.welcome-container-text1 {
  font-size: 40px !important;
}

.welcome-container-text2 {
  font-size: 18px !important;
}

// Log button styles
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

// Log view container
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
          font-family: "Courier New", monospace;
          font-size: 12px;
          line-height: 1.4;
          color: #333;
          white-space: pre-wrap;
          word-break: break-word;
          background-color: #1e1e1e; // Dark background, better suited for showing colored text
          border-radius: 4px;
          padding: 8px;
          border: 1px solid #e9ecef;

          // Ensure colors inside span tags display correctly
          span {
            display: inline;

            &[style*="color: #ff0000"] {
              color: #ff6b6b !important; // Red
            }

            &[style*="color: #00ff00"] {
              color: #51cf66 !important; // Green
            }

            &[style*="color: #ffff00"] {
              color: #ffd43b !important; // Yellow
            }

            &[style*="color: #0000ff"] {
              color: #74c0fc !important; // Blue
            }

            &[style*="color: #ff00ff"] {
              color: #f783ac !important; // Magenta
            }

            &[style*="color: #00ffff"] {
              color: #63e6be !important; // Cyan
            }

            &[style*="color: #ffffff"] {
              color: #f8f9fa !important; // White
            }
          }

          // Bold text styles
          strong {
            font-weight: bold;
            color: #f8f9fa;
          }

          // Underline text styles
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

// Upvote / downvote button styles
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

// Agent item wrapper styles
.agent-item-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 12px;
}

// More button styles
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

// Permission loading state styles
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

// Agent info dialog styles
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

/* Force-override Element Plus dialog styles */
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

/* Global style override to ensure the highest priority */
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

/* Tutorial guide overlay styles */
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

/* Step 1: highlight the left sidebar */
.tutorial-step-1 {
  position: relative;
  width: 100%;
  height: 100%;

  .sidebar-tutorial {
    position: absolute;
    top: 50%;
    left: 300px;
    transform: translateY(-50%);
    z-index: 1002;
  }
}

/* Step 2: highlight the bottom case bar */
.tutorial-step-2 {
  position: relative;
  width: 100%;
  height: 100%;

  .bottom-tutorial {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1002;
  }
}

/* Step 3: highlight the chat input area */
.tutorial-step-3 {
  position: relative;
  width: 100%;
  height: 100%;

  .input-tutorial {
    position: absolute;
    top: 5%;
    left: 50%;
    transform: translate(-50%, 5%);
    z-index: 1002;
  }
}

/* Responsive design */
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

/* Common tutorial content styles */
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

/* Responsive design */
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

  /* Mobile highlight area adjustments */
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

/* Small-screen device optimizations */
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

  /* Extra-small screen highlight area adjustments */
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
/* Common animation definitions */
@keyframes tutorial-pulse {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 0.3;
  }
}

@keyframes tutorial-bounce-left {
  0%,
  20%,
  50%,
  80%,
  100% {
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
  0%,
  20%,
  50%,
  80%,
  100% {
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
  0%,
  20%,
  50%,
  80%,
  100% {
    transform: translateX(-50%) translateY(0);
  }
  40% {
    transform: translateX(-50%) translateY(-5px);
  }
  60% {
    transform: translateX(-50%) translateY(-3px);
  }
}

/* Agents architecture diagram dialog styles */
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

/* Dialog title styles */
:deep(.el-dialog__header) {
  text-align: center;
  padding: 20px 20px 10px;

  .el-dialog__title {
    font-size: 18px;
    font-weight: 600;
    color: #303133;
  }
}

/* Dialog content styles */
:deep(.el-dialog__body) {
  padding: 10px 20px 30px;
}

/* Responsive design */
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
