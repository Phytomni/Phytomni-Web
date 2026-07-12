<template>
  <div
    class="chat-page-root"
    data-testid="chat-root"
    :data-chat-state="chatStateAttr"
    :data-sidebar-drawer-state="sidebarDrawerStateAttr"
  >
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
        data-testid="chat-transcript"
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
          <ChatMessageRow
            v-for="(message, index) in currentChat.messages"
            :key="index"
            :role="message.role === 'user' ? 'user' : 'assistant'"
            :message-id="message.id || undefined"
            :streaming="!!message.streaming"
          >
            <template #avatar>
              <el-avatar :size="36" :src="botAvatar" />
            </template>
              <!-- Log view - two-column layout (replaces content when showLog) -->
              <div
                v-if="
                  (message.role === 'user' ||
                    (!message.steps && !message.tableHeaders)) &&
                  message.role === 'assistant' &&
                  message.tool_name === 'AnalystAgent' &&
                  message.showLog
                "
                :class="['message-text', 'phy-bubble-assistant']"
              >
                <div class="log-view-container">
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

              </div>
              <ChatMessageContent
                v-else
                :message="message"
                :index="index"
                :is-last-message="currentChat.messages.length - 1 == index"
                :stream-run-id="getChatState(currentChatId).a2uiRunId"
                :stream-transport="getChatState(currentChatId).a2uiActionSender"
                :gene-network-images="geneNetworkImages"
                :gene-network-images-loading="geneNetworkImagesLoading"
                :digital-design-images="digitalDesignImages"
                :digital-design-images-loading="digitalDesignImagesLoading"
                @finish="() => handleMarkdownFinish(index)"
              />

              <!-- Bubble-branch chrome (visibility unchanged) -->
              <template
                v-if="
                  message.role === 'user' ||
                  (!message.steps && !message.tableHeaders)
                "
              >
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
              </template>

              <!-- Table-branch chrome (visibility unchanged) -->
              <template v-else-if="message.tableHeaders">

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
                            </template>

              <!-- Legacy-steps-branch chrome (visibility unchanged) -->
              <template v-else>
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
                            </template>

          </ChatMessageRow>
        </template>

        <!-- Loading message: fake ETA progress, suppressed while an AG-UI stream is in
             flight — the placeholder message already shows real streaming content, so
             showing both would double up the "is responding" indicator on screen. -->
        <ChatMessageRow
          v-if="isSending && !getChatState(currentChatId).isStreaming"
          role="assistant"
          loading
        >
          <template #avatar>
            <el-avatar :size="36" :src="botAvatar" />
          </template>
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
        </ChatMessageRow>
        </div>
      </div>
      <el-backtop target=".message-container" :right="40" :bottom="80" />

      <!-- Input area -->
      <div class="input-container">
        <ChatComposer
          ref="composerRef"
          v-model="displayMessageInput"
          :is-sending="isSending"
          v-model:chat-mode="chatMode"
          :expert-mode-enabled="expertModeEnabled"
          :show-mode-selector="!currentChat?.messages?.length"
          :file-list="fileList"
          :roles-tool="rolesTool"
          :roles-loading="rolesLoading"
          :has-messages="!!currentChat?.messages?.length"
          :selected-agent="selectedAgent"
          :picker-options="pickerOptions"
          :set-tour-input-target="setTourInputTarget"
          @submit="sendMessage"
          @stop="abortCurrentRequest"
          @select="handleSelect"
          @search="handleSearch"
          @command="handleCommand"
          @file-change="handleFileChange"
          @remove-file="removeFile"
          @clear-agent="clearSelectedAgent"
        />
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
  </div>
</template>
<script setup lang="ts">
import {
  onMounted,
  onUnmounted,
  provide,
  ref,
  nextTick,
  watch,
  computed,
} from "vue";
import Sidebar from "./sidebar.vue";
import { CHAT_SIDEBAR_DRAWER_OPEN_KEY } from "./components/ChatSidebarNav.vue";
import { SIDEBAR_MOBILE_BREAKPOINT } from "./composables/useSidebarResponsive";
import { Prompts } from "vue-element-plus-x";
import TransferProgress from "@/components/TransferProgress.vue";
import SendProgress from "./components/SendProgress.vue";
import ChatComposer from "./components/ChatComposer.vue";
import ChatMessageRow from "./components/ChatMessageRow.vue";
import ChatMessageContent from "./components/ChatMessageContent.vue";
import {
  PhyAdaptiveShell,
  PhyEmptyState,
} from "@/components/shell";
import {
  Document,
  CopyDocument,
  SuccessFilled,
  Download,
  Menu,
  Loading,
  Refresh,
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
import { useComposer } from "./composables/useComposer";
import { derivePickerOptions } from "@/constants/agents";
import { useSelectChat } from "./composables/useSelectChat";
import { useSendMessage } from "./composables/useSendMessage";
import { useRefreshMessage } from "./composables/useRefreshMessage";
import { useLogView } from "./composables/useLogView";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { abortRequest } from "@/utils/request";
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import FollowUpQuestions from "./FollowUpQuestions.vue";
import { FilesCard } from "vue-element-plus-x";
import {
  STARTER_PROMPTS,
  applyStarterPrompt,
  getStarterPromptItems,
} from "@/views/chat/utils/starterPrompts";
import AgentsViewImg from "@/assets/images/chat/AgentsView.png";
import {
  clearPendingChat,
  isLocalStorageChat,
  isValidPendingRecord,
  matchesChat,
  safeParse,
} from "@/utils/pending-chat";
import { formatDetailedCitation } from "@/utils/citation";
import { formatLogContentWithColors } from "./utils/agent-log";
import type {
  Chat,
  ChatMessage,
  ChatComposerHandle,
  DialogueReconciliationResult,
} from "./types";

const composerRef = ref<ChatComposerHandle | null>(null);

const timestamp = ref(Date.now());
const { t } = useI18n();

// Left sidebar state
const leftSidebarCollapsed = ref(false);
const leftSidebarDrawerOpen = ref(false);
provide(CHAT_SIDEBAR_DRAWER_OPEN_KEY, leftSidebarDrawerOpen);

const isMobileViewport = ref(
  typeof window !== "undefined"
    ? window.innerWidth < SIDEBAR_MOBILE_BREAKPOINT
    : false
);
const updateMobileViewport = () => {
  isMobileViewport.value = window.innerWidth < SIDEBAR_MOBILE_BREAKPOINT;
};

const chatStateAttr = computed(() =>
  currentChat.value?.messages?.length ? "populated" : "empty"
);
const sidebarDrawerStateAttr = computed(() => {
  if (!isMobileViewport.value) return "not-mobile";
  return leftSidebarDrawerOpen.value ? "open" : "closed";
});

// Agents architecture diagram dialog
const agentsViewVisible = ref(false);
const { scale, isDragging, imageOffset, containerRef, imageRef, imageStyle, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp } = useImageZoomPan(agentsViewVisible);

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
const pickerOptions = computed(() =>
  derivePickerOptions(rolesTool.value).map((option) => ({
    tool: option.tool,
    labelKey: option.labelKey,
    label: t(option.labelKey) || option.displayName,
  }))
);
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
  updateMobileViewport();
  window.addEventListener("resize", updateMobileViewport);

  // Load permission info first
  await loadUserTools();

  // Fetch the history question list
  getHistoryQuestionData().then(() => {
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

onUnmounted(() => {
  window.removeEventListener("resize", updateMobileViewport);
});

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
  rekeyChatState,
  currentChatId,
  currentChat,
  messageInput,
  isSending,
  chatMode,
  selectedAgent,
  fileList,
  copyVisible,
  copyTimeRef,
  logData,
  loadingLog,
  refreshingMessages,
  updatingLog,
} = useChatStates();

const reconcileMatchedDialogue = (
  tempId: string,
  serverId: string,
  pendingKey?: string
): DialogueReconciliationResult => {
  const wasCurrent = currentChatId.value === tempId;
  const rekey = rekeyChatState(tempId, serverId);
  const benign =
    rekey.outcome === "moved" ||
    rekey.outcome === "same-id" ||
    rekey.outcome === "source-absent";
  const reconciled = rekey.outcome === "moved" || rekey.outcome === "same-id";

  if (benign) {
    if (pendingKey !== undefined) {
      localStorage.removeItem(pendingKey);
    } else if (isLocalStorageChat(tempId)) {
      clearPendingChat(tempId);
    }
  } else if (rekey.outcome === "target-collision") {
    console.warn(
      `[chat] dialogue reconciliation collision (temp=${tempId}, server=${serverId})`
    );
    return { status: "retained", tempId, reason: "collision" };
  }

  if (reconciled && wasCurrent && currentChatId.value === tempId) {
    currentChatId.value = serverId;
    updateUrlWithChatId(serverId);
  }

  if (reconciled) {
    return { status: "reconciled", tempId, serverId, rekey };
  }

  return { status: "retained", tempId, reason: "unmatched" };
};

// Fetch history question data; optional sendingDialogueId drives post-send reconciliation.
const getHistoryQuestionData = (
  sendingDialogueId?: string,
  options?: { blockingDialogueId?: string }
): Promise<DialogueReconciliationResult | undefined> => {
  return new Promise((resolve) => {
    getHistoryQuestionList()
      .then((res: any) => {
        if (res.code === 200 && res.data) {
          const formattedData = res.data.map((item: any) => {
            return {
              id: item.id,
              dialogue_id: item.dialogue_id,
              title: item.title_query || item.query,
              date: item.created_at,
              isFavorite: false,
            };
          });

          chatList.value = formattedData;
          const skipRestoreTempIds =
            sendingDialogueId &&
            isLocalStorageChat(sendingDialogueId) &&
            options?.blockingDialogueId
              ? new Set([sendingDialogueId])
              : undefined;
          restorePendingChats(formattedData, skipRestoreTempIds);

          if (sendingDialogueId && isLocalStorageChat(sendingDialogueId)) {
            if (options?.blockingDialogueId) {
              resolve(
                reconcileMatchedDialogue(
                  sendingDialogueId,
                  options.blockingDialogueId
                )
              );
              return;
            }

            const pendingData = safeParse(
              localStorage.getItem(`pending_chat_${sendingDialogueId}`)
            );
            if (!isValidPendingRecord(pendingData)) {
              resolve({
                status: "retained",
                tempId: sendingDialogueId,
                reason: "unmatched",
              });
              return;
            }

            const candidates = formattedData.filter((chat: Chat) =>
              matchesChat(
                { dialogue_id: chat.dialogue_id, title: chat.title },
                pendingData,
                sendingDialogueId
              )
            );
            if (candidates.length === 1) {
              resolve(
                reconcileMatchedDialogue(
                  sendingDialogueId,
                  candidates[0].dialogue_id
                )
              );
              return;
            }

            const reason = candidates.length === 0 ? "no-match" : "ambiguous";
            console.warn(
              `[chat] dialogue reconciliation retained: ${reason} (temp=${sendingDialogueId})`
            );
            resolve({
              status: "retained",
              tempId: sendingDialogueId,
              reason,
            });
            return;
          }
        }
        resolve(undefined);
      })
      .catch((err: any) => {
        console.error("Failed to fetch history question data:", err);
        resolve(undefined);
      });
  });
};

// Scan pending localStorage records against the authoritative chat list; reconcile
// only when matchesChat yields exactly one candidate per temp key.
const restorePendingChats = (
  knownChats: Chat[],
  skipTempIds?: ReadonlySet<string>
) => {
  const pendingChatKeys = Object.keys(localStorage).filter((key) =>
    key.startsWith("pending_chat_")
  );

  pendingChatKeys.forEach((key) => {
    const tempChatId = key.replace("pending_chat_", "");
    if (skipTempIds?.has(tempChatId)) {
      return;
    }
    const pendingChatData = safeParse(localStorage.getItem(key));

    if (!isValidPendingRecord(pendingChatData)) {
      if (pendingChatData !== null) {
        localStorage.removeItem(key);
      }
      return;
    }

    const candidates = knownChats.filter((chat) =>
      matchesChat(
        { dialogue_id: chat.dialogue_id, title: chat.title },
        pendingChatData,
        tempChatId
      )
    );

    if (candidates.length === 1) {
      reconcileMatchedDialogue(tempChatId, candidates[0].dialogue_id, key);
    }
  });
};

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
  displayMessageInput,
  clearSelectedAgent,
  handleCommand,
  handleSelect,
  handleSearch,
} = useComposer({
  messageInput,
  isSending,
  currentChatId,
  selectedAgent,
  scrollToBottom,
  rolesTool,
});
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
  composerRef,
  scrollToBottom,
});

// Message upvote/downvote feature — state and logic extracted into the useReactions composable
const { getReactionState, handleReaction, getReactionTooltip } = useReactions({
  currentChatId,
  getChatState,
  scrollToBottom,
});

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

// Sidebar control function
const handleSidebarCollapse = (isCollapsed: boolean) => {
  leftSidebarCollapsed.value = isCollapsed;
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
  composerRef,
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
const setTourInputTarget = (el: HTMLElement | null) => {
  tourInputTarget.value = el;
};

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

.chat-page-root {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
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
    calc(
      var(--phy-control-height-primary) + var(--phy-space-32) +
        env(safe-area-inset-bottom, 0px)
    );
  display: flex;
  flex-direction: column;
  background: var(--phy-color-bg-page);
}

.transcript-content {
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
}

.message {
  // Row shell layout lives on ChatMessageRow; pierce for slotted content styles.
  &.user {
    :deep(.message-content) {
      .message-text,
      .has-user {
        box-shadow: none;
      }
    }
  }

  &.assistant {
    :deep(.message-content) {
      .message-text {
        box-shadow: none;
      }
    }
  }

  :deep(.message-content) {
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

    // Content extraction keeps footers as siblings of ChatMessageContent's
    // .message-text; hover the row content shell so user copy actions still appear.
    .message-text:hover .message-user,
    &:hover .message-user {
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
  justify-content: flex-end;
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
  padding: var(--phy-space-24) var(--phy-space-16) var(--phy-space-8);
  box-sizing: border-box;
  gap: var(--phy-space-16);

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
  flex-shrink: 0;
  position: relative;
  background-color: var(--phy-color-bg-page);
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
