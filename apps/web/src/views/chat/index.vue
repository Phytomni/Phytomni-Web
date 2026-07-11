<template>
  <PhyAdaptiveShell
    :sidebar-collapsed="leftSidebarCollapsed"
    :artifact-open="false"
    :artifact-fullscreen="false"
  >
    <template #sidebar>
      <!-- Left sidebar -->
      <div ref="tourSidebarTarget" class="tour-sidebar-wrap">
        <Sidebar
          :chatList="chatList"
          :currentChatId="currentChatId"
          :collapsed="leftSidebarCollapsed"
          :drawer-open="leftSidebarDrawerOpen"
          @selectChat="selectChat"
          @startNewChat="startNewChat"
          @openKnowledgeBase="openKnowledgeBase"
          @handleSidebarCollapse="handleSidebarCollapse"
          @drawerOpenChange="leftSidebarDrawerOpen = $event"
          @startTutorial="startTutorial"
          @showArchitecture="showAgentsView"
          @chatRenamed="handleChatRenamed"
          @chatDeleted="handleChatDeleted"
          @chatFavorited="handleChatFavorited"
        />
      </div>
    </template>

    <template #main>
      <el-tour
        v-model="showTutorial"
        :mask="true"
        :close-on-press-escape="true"
        @finish="completeTutorial"
        @close="completeTutorial"
      >
        <el-tour-step
          :target="tourSidebarTarget"
          :title="t('tutorial.step1.title')"
          :description="t('tutorial.step1.content')"
        />
        <el-tour-step
          :target="tourCasesTarget"
          :title="t('tutorial.step2.title')"
          :description="t('tutorial.step2.content')"
        />
        <el-tour-step
          :target="tourInputTarget"
          :title="t('tutorial.step3.title')"
          :description="t('tutorial.step3.content')"
        />
      </el-tour>

      <div class="chat-main-layout">
        <!-- Center chat area -->
        <div class="chat-main">
      <header class="chat-header">
        <div class="header-leading">
          <el-button
            class="mobile-sidebar-toggle"
            data-testid="chat-sidebar-trigger"
            :class="{ 'is-visible': leftSidebarCollapsed }"
            text
            circle
            :aria-label="$t('chat.newChat')"
            @click="toggleSidebarFromHeader"
          >
            <el-icon><Menu /></el-icon>
          </el-button>
          <h2 class="chat-header-title" :title="chatHeaderTitle">
            {{ chatHeaderTitle }}
          </h2>
          <span
            v-if="chatMode === 'expert'"
            class="chat-expert-indicator"
            data-test="chat-expert-indicator"
          >
            {{ $t("chat.mode.expert") }}
          </span>
        </div>
      </header>

      <!-- Message area -->
      <div
        class="message-container"
        data-test="chat-transcript-scroll-root"
        ref="messageContainer"
        :key="timestamp"
      >
        <div v-if="!currentChat?.messages?.length" class="empty-chat">
          <PhyEmptyState
            :title="$t('chat.welcomeTitle')"
            :subtitle="$t('chat.welcomeSubtitle')"
            class="empty-chat-starters-shell"
          >
            <template #mark>
              <img
                src="../../assets/images/chat/logo.png"
                class="empty-chat-mark"
                alt=""
              />
            </template>
            <div ref="tourCasesTarget">
              <Prompts
                class="empty-chat-starters"
                :items="starterItems"
                wrap
                @item-click="onStarterClick"
              />
            </div>
          </PhyEmptyState>
        </div>
        <div class="transcript-content">
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
                :class="[
                  'message-text',
                  message.role === 'user'
                    ? 'phy-bubble-user has-user'
                    : 'phy-bubble-assistant',
                ]"
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
                    <h4>{{ $t("chat.log.replyContent") }}</h4>
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
                    <h4>{{ $t("chat.log.execLog", { id: message.id }) }}</h4>

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
                        {{ $t("chat.log.updateLog") }}
                      </el-button>
                    </div>

                    <div
                      v-if="loadingLog[message.id || '']"
                      class="log-loading"
                    >
                      <el-icon class="is-loading">
                        <Loading />
                      </el-icon>
                      {{ $t("chat.log.loading") }}
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
                          :label="$t('chat.log.contentColumn')"
                          align="left"
                        />
                      </el-table>
                    </div>
                    <div v-else class="log-error">
                      {{ $t("chat.log.noData") }} (loadingLog:
                      {{ loadingLog[message.id || ""] }}, logData:
                      {{ !!logData[message.id || ""] }})
                    </div>
                  </div>
                </div>

                <!-- Normal message content -->
                <div v-else>
                  <!-- Streaming assistant messages (AG-UI content blocks) render via
                       StreamMessage; P0 mount passes no ns (no references yet, citation
                       gate keeps [N] literal, consistent with the no-ns MarkdownViewer
                       branch below). Non-streaming messages fall through unchanged. -->
                  <StreamMessage
                    v-if="
                      message.role === 'assistant' &&
                      (message.streaming ||
                        (message.blocks && message.blocks.length))
                    "
                    :blocks="message.blocks || []"
                    :run-id="getChatState(currentChatId).a2uiRunId"
                    :transport="getChatState(currentChatId).a2uiActionSender"
                  />
                  <!-- GeneNetworkAgent image display -->
                  <div
                    v-else-if="
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
                    :ns="'m' + index"
                  />
                  <CitedAnswer
                    v-else-if="
                      message.doc_list &&
                      message.doc_list.length > 0 &&
                      message.role === 'assistant'
                    "
                    :content="message.content"
                    :references="message.doc_list"
                    :ns="'m' + index"
                    :instant-message="
                      (message?.instantMessage &&
                        currentChat.messages.length - 1 == index) ||
                      false
                    "
                    @finish="() => handleMarkdownFinish(index)"
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
                  @click="() => downloadFile(message?.download_path)"
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
                      :content="$t('chat.refreshReply')"
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
                  @click="() => downloadFile(message?.download_path)"
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
                    :content="$t('chat.refreshReply')"
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
                  @click="() => downloadFile(message?.download_path)"
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
                    :content="$t('chat.refreshReply')"
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

        <!-- Loading message: fake ETA progress, suppressed while an AG-UI stream is in
             flight — the placeholder message already shows real streaming content, so
             showing both would double up the "is responding" indicator on screen. -->
        <div
          v-if="isSending && !getChatState(currentChatId).isStreaming"
          class="message assistant"
        >
          <div class="message-avatar">
            <el-avatar :size="36" :src="botAvatar" />
          </div>
          <div class="message-content">
            <div class="message-text loading-message phy-bubble-assistant">
              {{ $t("chat.ladingInner") }}
              <div class="loading-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
              <TransferProgress
                v-if="getChatState(currentChatId).uploadTransfer"
                :snapshot="getChatState(currentChatId).uploadTransfer!"
                @cancel="(id) => abortTransfer(id)"
              />
              <SendProgress
                v-else
                :started-at="getChatState(currentChatId).sendStartedAt"
                :agent-name="getChatState(currentChatId).activeAgentName"
                :completing="getChatState(currentChatId).completing"
              />
            </div>
          </div>
        </div>
        </div>
      </div>
      <el-backtop target=".message-container" :right="40" :bottom="80" />

      <!-- Input area -->
      <div class="input-container">
        <ChatModeSelector
          v-if="!currentChat?.messages?.length"
          v-model="chatMode"
          :expert-enabled="expertModeEnabled"
          class="empty-chat-mode"
        />
        <div ref="tourInputTarget" class="input-container-warpper">
          <PhyComposerFrame>
            <div class="input-box">
              <!-- Abort button - moved outside MentionSender so it stays clickable while sending -->
              <div v-if="isSending" class="abort-button-overlay">
                <el-tooltip :content="$t('chat.abortTooltip')" placement="top">
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
                        <el-button round plain class="phy-btn-primary" :aria-label="$t('chat.uploadFile')">
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
                    <el-button round plain class="phy-btn-primary">
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
                    <el-button round class="phy-btn-primary" :aria-label="$t('chat.sendAriaLabel')">
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
                    {{ $t("chat.loadingAgentPerms") }}
                  </div>

                  <!-- Agent button area -->
                  <template v-else-if="rolesTool.length > 0 && chatMode === 'instant'">
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
          </PhyComposerFrame>
        </div>
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
      </div>

    <!-- Agents architecture diagram dialog -->
    <el-dialog
      v-model="agentsViewVisible"
      :title="t('chat.agentsArchitectureTitle')"
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
          :alt="t('chat.agentsArchitectureAlt')"
          class="agents-view-image"
          :style="imageStyle"
        />
      </div>
    </el-dialog>
    </template>
  </PhyAdaptiveShell>
</template>
<script setup lang="ts">
import { onMounted, ref, nextTick, watch, computed } from "vue";
import Sidebar from "./sidebar.vue";
import { MentionSender, Prompts } from "vue-element-plus-x";
import TransferProgress from "@/components/TransferProgress.vue";
import SendProgress from "./components/SendProgress.vue";
import StreamMessage from "./components/StreamMessage.vue";
import ChatModeSelector from "@/components/ChatModeSelector.vue";
import {
  PhyAdaptiveShell,
  PhyComposerFrame,
  PhyEmptyState,
} from "@/components/shell";
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
import { useI18n } from "vue-i18n";
import type { UploadInstance } from "element-plus";
import {
  Paperclip,
  Promotion,
  Close,
} from "@element-plus/icons-vue";
import { useRouter } from "vue-router";
import { abortRequest } from "@/utils/request";
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import CitedAnswer from "@/components/CitedAnswer.vue";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import FollowUpQuestions from "./FollowUpQuestions.vue";
import { FilesCard } from "vue-element-plus-x";
import {
  STARTER_PROMPTS,
  applyStarterPrompt,
  getStarterPromptItems,
} from "@/views/chat/utils/starterPrompts";
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
const leftSidebarDrawerOpen = ref(false);

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

const chatHeaderTitle = computed(() => {
  const currentTitle =
    typeof currentChat.value?.title === "string"
      ? currentChat.value.title.trim()
      : "";
  if (currentTitle) return currentTitle;

  const listTitle = chatList.value.find(
    (chat) => chat.dialogue_id === currentChatId.value,
  )?.title;
  return listTitle?.trim() || t("chat.untitledConversation");
});

const toggleSidebarFromHeader = () => {
  if (leftSidebarCollapsed.value) {
    leftSidebarCollapsed.value = false;
  } else {
    leftSidebarDrawerOpen.value = true;
  }
};

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
  getChatState(dialogueId).mode =
    pendingChatData.mode === "expert" ? "expert" : "instant";
  return true;
};

// Parallel chat state (independent UI state per dialogueId) + current chat + 10 computed proxies
const {
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

// Starter prompt cards — computed so labels/descriptions react to locale changes
const starterItems = computed(() => getStarterPromptItems(t, isSending.value));

const onStarterClick = (item: { key: string | number }) => {
  const prompt = STARTER_PROMPTS.find((p) => p.key === item.key);
  if (!prompt) return;
  applyStarterPrompt(prompt, t, (text) => {
    messageInput.value = text;
  });
};

// Copy conversation + file download
const { fallbackCopyText, downloadFile, getFileDownUrl } =
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

// Agents panel — tooltip and info dialog for MentionSender footer agent buttons
const { getAgentTooltip, showMoreInfo } = useAgentsPanel({ t });

function abortTransfer(requestId: string) {
  if (currentChatId.value) {
    getChatState(currentChatId.value).uploadTransfer = null;
  }
  if (requestId === currentRequestId.value) {
    void abortCurrentRequest();
    return;
  }
  abortRequest(requestId);
}

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
    title: t("chat.links.riceStress"),
    url: "https://ricefrend.dna.affrc.go.jp/",
  },
  {
    title: t("chat.links.wheatYield"),
    url: "https://plants.ensembl.org/Triticum_aestivum/",
  },
  {
    title: t("chat.links.maizeQTL"),
    url: "https://www.maizegdb.org/",
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
  startTutorial,
  completeTutorial,
  checkTutorialStatus,
} = useTutorial();

const tourSidebarTarget = ref<HTMLElement | null>(null);
const tourCasesTarget = ref<HTMLElement | null>(null);
const tourInputTarget = ref<HTMLElement | null>(null);

// Copy message content + cited document list (extracted from an inline @click to work around a
// vue-tsc 0.39.5 bug where it mis-maps a local const declared inside a multi-statement template
// arrow function onto the component instance — see the 2 @click usages in index.vue)
const copyMessageWithDocs = (message: any, index: number) => {
  const docs =
    message.doc_list && message.doc_list.length > 0
      ? message.doc_list
          .map((item: any, idx: number) => {
            if (item.au || item.ti) {
              return `${idx + 1}. ${formatDetailedCitation(item)}`;
            } else if (item.title) {
              return `${idx + 1}. ${item.title}`;
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
.tour-sidebar-wrap {
  flex-shrink: 0;
  height: 100%;
}

.phy-btn-primary {
  --el-button-bg-color: var(--phy-color-primary);
  --el-button-border-color: var(--phy-color-primary);
  --el-button-hover-bg-color: var(--phy-color-primary-hover);
  --el-button-hover-border-color: var(--phy-color-primary-hover);
  --el-button-text-color: #fff;
}

.phy-btn-primary.is-plain {
  --el-button-bg-color: var(--phy-color-primary-soft);
  --el-button-text-color: var(--phy-color-primary);
  --el-button-border-color: var(--phy-color-primary-soft);
}

.chat-main-layout {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

// Chat main view
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.chat-header {
  flex-shrink: 0;
  padding: 0 var(--phy-space-16);
  border-bottom: 1px solid var(--phy-color-border);
  min-height: var(--phy-control-height-primary);
  height: var(--phy-control-height-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;

  .chat-header-title {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 18px;
    font-weight: 500;
  }

  .header-leading {
    display: flex;
    align-items: center;
    gap: var(--phy-space-8);
  }

  .mobile-sidebar-toggle {
    display: none;

    &.is-visible {
      display: inline-flex;
    }
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .chat-expert-indicator {
    flex-shrink: 0;
    margin-left: var(--phy-space-8);
    padding: 2px var(--phy-space-8);
    border: 1px solid var(--phy-color-accent-soft);
    border-radius: var(--phy-radius-pill);
    color: var(--phy-color-accent);
    font-size: 12px;
    line-height: 1.4;
  }
}

.message-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--phy-space-16) var(--phy-space-16)
    calc(var(--phy-control-height-primary) + var(--phy-space-32));
  display: flex;
  flex-direction: column;
  background: var(--phy-color-bg-page);
}

.transcript-content {
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
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

      .message-text,
      .has-user {
        box-shadow: none;
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

      .message-text {
        box-shadow: none;
      }
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
      box-shadow: none;
      width: 100%;
      padding: 12px;
      border-radius: var(--phy-radius-lg);

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
      box-shadow: none;

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
        border-left: 3px solid var(--el-color-primary);

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
  justify-content: center;
  width: min(760px, 100%);
  margin: 0 auto;
  padding: var(--phy-space-24) var(--phy-space-16) var(--phy-space-16);
  box-sizing: border-box;

  .empty-chat-starters-shell {
    width: 100%;
    padding: var(--phy-space-16) 0;
  }

  .empty-chat-mark {
    width: 48px;
    height: 48px;
    object-fit: contain;
  }

  .empty-chat-starters {
    width: 100%;

    :deep(.el-prompts-items) {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--phy-space-12);
      width: 100%;
    }

    :deep(.el-prompts-item) {
      min-width: 0;
      padding: var(--phy-space-16);
      border: 1px solid var(--phy-color-border-subtle);
      border-radius: var(--phy-radius-md);
      background: var(--phy-color-bg-elevated);
      text-align: left;
      transition: background-color var(--phy-motion-fast)
          var(--phy-motion-ease-out),
        border-color var(--phy-motion-fast) var(--phy-motion-ease-out);
    }

    :deep(.el-prompts-item:hover) {
      border-color: var(--phy-color-primary-soft);
      background: var(--phy-color-primary-soft);
    }

    :deep(.el-prompts-item-disabled) {
      cursor: not-allowed;
      opacity: 0.55;
    }

    :deep(.el-prompts-item-label) {
      overflow-wrap: anywhere;
      color: var(--phy-color-text);
      font-size: 0.95rem;
      font-weight: 600;
      line-height: 1.35;
    }

    :deep(.el-prompts-item-description) {
      margin-top: var(--phy-space-8);
      overflow-wrap: anywhere;
      color: var(--phy-color-text-secondary);
      font-size: 0.82rem;
      line-height: 1.45;
    }
  }

}

@media (max-width: 600px) {
  .empty-chat {
    padding: var(--phy-space-16) var(--phy-space-12);

    .empty-chat-starters {
      :deep(.el-prompts-items) {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  }
}

.input-container {
  width: 100%;
  position: relative;
  background-color: #fff;

  .empty-chat-mode {
    display: flex;
    justify-content: center;
    margin: 0 auto var(--phy-space-8);
  }

  .input-container-warpper {
    position: relative;
    left: 50%;
    transform: translateX(-50%);
    width: 85%;
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
        color: var(--phy-color-accent);
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
          color: var(--el-color-primary);
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
    color: var(--el-color-primary);
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
      background-color: var(--el-color-primary);
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
          color: var(--el-color-primary);

          &:hover {
            color: var(--phy-color-primary-hover);
            text-decoration: underline;
          }
        }

        &.pmid-link {
          color: var(--el-color-primary);

          &:hover {
            color: var(--phy-color-primary-hover);
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
      color: var(--el-color-primary);
      background-color: #f0f9ff;
      transform: scale(1.1);
    }

    &.active {
      color: var(--el-color-primary);
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
    color: var(--el-color-primary);
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
          border-left: 3px solid var(--el-color-primary);

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
          border-left: 3px solid var(--el-color-primary);
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

.tip-text {
  font-size: 12px;
  color: #909399;
  margin-top: 10px;
  width: 100%;
  text-align: right;
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
@media (max-width: 899px) {
  .mobile-sidebar-toggle {
    display: inline-flex !important;
  }

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
