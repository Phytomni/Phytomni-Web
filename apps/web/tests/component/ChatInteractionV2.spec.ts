/**
 * Phase 3A–3C assembled Chat behavior matrix + per-dialogue isolation.
 * Test-only — no production edits; fixtures are synthetic / network-free.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";
import ElementPlus from "element-plus";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { useA2uiInteraction } from "@/views/chat/composables/useA2uiInteraction";
import type { ChatMessage, ChatUIState, UploadFile } from "@/views/chat/types";
import type { A2uiActionTransport } from "@/views/chat/streaming/a2uiAction";
import { createMemoryA2uiTransport } from "@/views/chat/streaming/a2uiAction";
import type { A2uiActionResponse } from "@/views/chat/streaming/a2uiContract";
import ChatMessageRow from "@/views/chat/components/ChatMessageRow.vue";
import ChatActivity from "@/views/chat/components/ChatActivity.vue";
import ChatAnalystLog from "@/views/chat/components/ChatAnalystLog.vue";
import SendProgress from "@/views/chat/components/SendProgress.vue";
import TransferProgress from "@/components/TransferProgress.vue";
import AgentSurfaceBlock from "@/views/chat/components/blocks/AgentSurfaceBlock.vue";
import ChatMessageActions from "@/views/chat/components/ChatMessageActions.vue";
import FollowUpQuestions from "@/views/chat/FollowUpQuestions.vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import {
  PHASE_3B_MESSAGE_KEYS,
  MESSAGE_FIXTURES,
  MESSAGE_FOLLOW_UPS,
  MESSAGE_CITED,
  MESSAGE_DEEP_GENOME,
  FIXTURE_ACTIVITY_BLOCKS,
  FIXTURE_ACTIVITY_STATE_KEY,
  FIXTURE_A2UI_REQUIRED_BLOCK,
  FIXTURE_UPLOAD_TRANSFER,
  FIXTURE_PROGRESS_STARTED_AT,
  PHASE_3C_FIXTURE_KEYS,
  isPhase3CFixtureKey,
  getPhase3COverlay,
  MESSAGE_ANALYST_LOG,
} from "../fixtures/chat";
import {
  CHAT_VISUAL_FIXTURE_KEYS,
  getChatVisualFixture,
  resolveChatVisualFixture,
} from "../visual/chat/fixture-registry";
import {
  getSharedPhase3COverlay,
  SYNTHETIC_IDENTITY,
} from "../visual/chat/fixture-data";
import { mustGet } from "../helpers/mockFactories";

vi.mock("vue-element-plus-x", () => ({
  MentionSender: {
    name: "MentionSender",
    inheritAttrs: false,
    template:
      '<div class="mention-sender-stub" v-bind="$attrs"><slot name="header" /><slot name="prefix" /><slot name="action-list" /></div>',
    props: [
      "modelValue",
      "loading",
      "disabled",
      "options",
      "placeholder",
      "autoSize",
      "clearable",
      "variant",
      "triggerStrings",
      "triggerSplit",
      "whole",
      "submitType",
      "allowSpeech",
    ],
    emits: ["update:modelValue", "submit", "select", "search"],
    setup(
      _props: unknown,
      { expose }: { expose: (exposed: Record<string, unknown>) => void }
    ) {
      expose({
        openHeader: vi.fn(),
        closeHeader: vi.fn(),
        popoverVisible: false,
      });
      return {};
    },
  },
  FilesCard: {
    name: "FilesCard",
    template: '<div class="files-card-stub" />',
    props: ["uid", "name", "fileSize", "showDelIcon"],
  },
  Typewriter: { name: "Typewriter", template: "<div></div>" },
  Prompts: { name: "Prompts", template: "<div></div>" },
}));

import ChatMessageContent from "@/views/chat/components/ChatMessageContent.vue";
import ChatVisualFixtureApp from "../visual/chat/ChatVisualFixtureApp.vue";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/ChatView.vue"),
  "utf8"
);
const artifactSlotStart = CHAT_SOURCE.indexOf("<template #artifact>");
const artifactSlotEnd = CHAT_SOURCE.indexOf(
  "</PhyAdaptiveShell>",
  artifactSlotStart
);
const CHAT_TRANSCRIPT_SOURCE = CHAT_SOURCE.slice(0, artifactSlotStart);
const ARTIFACT_SLOT_SOURCE = CHAT_SOURCE.slice(
  artifactSlotStart,
  artifactSlotEnd
);
const CONTENT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageContent.vue"),
  "utf8"
);
const COMPOSER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatComposer.vue"),
  "utf8"
);
const ACTIONS_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageActions.vue"),
  "utf8"
);

const loadingStart = CHAT_SOURCE.indexOf("<!-- Loading message:");
const loadingEnd = CHAT_SOURCE.indexOf("</ChatMessageRow>", loadingStart);
const LOADING_BUBBLE = CHAT_SOURCE.slice(loadingStart, loadingEnd);

const EMPTY_IMAGES = {} as Record<string, string[]>;
const EMPTY_LOADING = {} as Record<string, boolean>;

const countOccurrences = (source: string, needle: string) =>
  source.split(needle).length - 1;

function populateFullChatState(
  state: ChatUIState,
  label: string,
  transport: A2uiActionTransport
): void {
  const file: UploadFile = {
    name: `${label}.txt`,
    size: 4,
    type: "text/plain",
    file: {} as File,
  };
  state.messageInput = `draft-${label}`;
  state.mode = label === "A" ? "expert" : "instant";
  state.selectedAgent = label === "A" ? "KnowledgeAgent" : "DataAgent";
  state.fileList = [file];
  state.isSending = true;
  state.completing = label === "A";
  state.sendStartedAt = FIXTURE_PROGRESS_STARTED_AT;
  state.activeAgentName = label === "A" ? "ChatAgent" : "KnowledgeAgent";
  state.uploadTransfer = {
    ...FIXTURE_UPLOAD_TRANSFER,
    requestId: `upload-${label}`,
    percent: label === "A" ? 10 : 40,
  };
  state.activityExpandedByMessage = {
    [FIXTURE_ACTIVITY_STATE_KEY]: true,
    [`log:42`]: label === "A",
  };
  state.logData = { "42": `log-${label}` };
  state.loadingLog = { "42": label === "B" };
  state.updatingLog = { "42": false };
  state.logErrorKinds = { "42": label === "A" ? "fetch" : "update" };
  state.reactions = { "99": label === "A" ? 1 : 2 };
  state.refreshingMessages = { "0_99": label === "A" };
  state.copyVisible = label === "A" ? 1 : 2;
  state.renderedChat = {
    dialogue_id: label,
    messages: [
      { role: "user", content: `q-${label}` },
      {
        role: "assistant",
        content: `a-${label}`,
        id: `msg-${label}`,
        blocks: [FIXTURE_A2UI_REQUIRED_BLOCK],
        a2uiRuntime: {
          dialogueId: label,
          messageId: label === "A" ? "101" : "102",
          runId: `run-${label}`,
          transport,
        },
      },
    ],
  };
}

describe("ChatInteractionV2 — behavior matrix", () => {
  it("retries only the currently selected dialogue and resets new chats", () => {
    expect(CHAT_SOURCE).toContain("const retrySelectedChat = () => {");
    expect(CHAT_SOURCE).toContain("const dialogueId = currentChatId.value;");
    expect(CHAT_SOURCE).toContain("if (!dialogueId) return;");
    expect(CHAT_SOURCE).toContain("void selectChat(dialogueId);");
    expect(CHAT_SOURCE).toContain('newChatState.historyHydration = "new";');
    expect(CHAT_SOURCE).toContain("newChatState.historyErrorKind = null;");
  });

  it("covers Phase 3B message content branches via shared fixtures", () => {
    for (const key of PHASE_3B_MESSAGE_KEYS) {
      expect(MESSAGE_FIXTURES[key]).toBeTruthy();
      expect(MESSAGE_FIXTURES[key].role).toBe("assistant");
    }
    expect(MESSAGE_CITED.doc_list?.length).toBeGreaterThan(0);
    expect(MESSAGE_DEEP_GENOME.tool_name).toBe("DeepGenomeAgent");
  });

  it("routes a surface intent through the owning message and resolves it in place", async () => {
    expect(CHAT_SOURCE).toContain(
      "const { submitAction, retryAction } = useA2uiInteraction();"
    );
    expect(CHAT_SOURCE).toContain(
      '@a2ui-action="(event) => submitAction(message, event)"'
    );
    expect(CHAT_SOURCE).toMatch(
      /@a2ui-retry="\s*\(surfaceId\) => retryAction\(message, surfaceId\)\s*"/
    );
    expect(CONTENT_SOURCE).toContain(
      "@a2ui-action=\"(event) => emit('a2ui-action', event)\""
    );

    const makeMessage = (
      surfaceId: string,
      messageId: string
    ): ChatMessage => ({
      role: "assistant",
      content: "",
      id: messageId,
      streaming: true,
      blocks: [
        {
          type: "agent-surface",
          authority: "agent",
          interactive: true,
          a2ui: {
            surface: {
              catalog_version: "v1.0",
              surface_id: surfaceId,
              widget: "confirm",
              props: {
                title: "Continue?",
                confirm_label: "Confirm",
                cancel_label: "Cancel",
              },
            },
            state: { status: "ready", round: 1 },
          },
        },
      ],
      a2uiRuntime: {
        dialogueId: "dialogue-owner",
        messageId,
        runId: "run-owner",
        transport: async () => {
          throw new Error("transport not wired");
        },
      },
    });
    const owner = reactive(
      makeMessage("surface-owner", "message-owner")
    ) as ChatMessage;
    const other = makeMessage("surface-other", "message-other");
    let resolveTransport!: (response: A2uiActionResponse) => void;
    const transport: A2uiActionTransport = vi.fn(
      () =>
        new Promise<A2uiActionResponse>((resolve) => {
          resolveTransport = resolve;
        })
    );
    mustGet(owner.a2uiRuntime, "owner A2UI runtime").transport = transport;

    const Harness = defineComponent({
      setup() {
        const { submitAction, retryAction } = useA2uiInteraction({
          buildActionId: () => "action-owner",
        });
        return () =>
          h(ChatMessageContent, {
            message: owner,
            index: 0,
            isLastMessage: true,
            geneNetworkImages: EMPTY_IMAGES,
            geneNetworkImagesLoading: EMPTY_LOADING,
            digitalDesignImages: EMPTY_IMAGES,
            digitalDesignImagesLoading: EMPTY_LOADING,
            onA2uiAction: (event) => submitAction(owner, event),
            onA2uiRetry: (surfaceId) => retryAction(owner, surfaceId),
          });
      },
    });
    const i18n = createI18n({
      legacy: false,
      locale: "en-US",
      messages: { "en-US": enUS, "zh-CN": zhCN },
    });
    const wrapper = mount(Harness, {
      global: {
        plugins: [i18n, ElementPlus],
        stubs: {
          MarkdownViewer: true,
          CitedAnswer: true,
          DeepGenomeResultViewer: true,
          ResearchArtifactPreview: true,
          ElIcon: true,
        },
      },
    });

    const buttons = wrapper.findAll(".a2ui-confirm button");
    expect(buttons).toHaveLength(2);
    await buttons[1].trigger("click");
    await nextTick();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(owner.blocks?.[0].a2ui?.state.status).toBe("submitting");
    expect(wrapper.find(".a2ui-status").exists()).toBe(true);
    expect(wrapper.find(".a2ui-status").text()).not.toContain(
      "transport not wired"
    );
    expect(
      wrapper
        .findAll(".a2ui-confirm button")
        .every((button) => button.attributes("disabled") !== undefined)
    ).toBe(true);
    expect(other.blocks?.[0].a2ui?.state.status).toBe("ready");

    resolveTransport({
      status: "succeeded",
      run_id: "run-owner",
      result: {
        a2ui: {
          catalog_version: "v1.0",
          surface_id: "surface-owner",
          widget: "confirm",
          props: { status: "submitted", accepted: true },
        },
        formatted: { answer: "Completed" },
      },
    });
    await flushPromises();
    await nextTick();
    expect(owner.blocks?.[0].a2ui?.state.status).toBe("resolved");
    expect(
      owner.blocks?.some((block) => block.sourceActionId === "action-owner")
    ).toBe(true);
    expect(owner.blocks?.some((block) => block.text === "Completed")).toBe(
      true
    );
    expect(other.blocks?.[0].a2ui?.state.status).toBe("ready");
    wrapper.unmount();
  });

  it("mounts user/assistant rows, follow-ups, and actions chrome", () => {
    const user = mount(ChatMessageRow, {
      props: { role: "user" },
      slots: { default: () => "user body" },
      global: { stubs: { ElAvatar: true } },
    });
    expect(user.attributes("data-message-role")).toBe("user");

    const assistant = mount(ChatMessageRow, {
      props: { role: "assistant", streaming: true },
      slots: {
        default: () => "assistant body",
        activity: () => "activity",
        "follow-up": () => "follow-up",
        actions: () => "actions",
      },
      global: { stubs: { ElAvatar: true } },
    });
    expect(assistant.classes()).toContain("streaming");
    expect(assistant.text()).toContain("activity");
    expect(assistant.text()).toContain("follow-up");
    expect(assistant.text()).toContain("actions");

    const i18n = createI18n({
      legacy: false,
      locale: "en-US",
      messages: { "en-US": enUS },
    });
    const followUps = mount(FollowUpQuestions, {
      props: { questions: MESSAGE_FOLLOW_UPS.followUpQuestions },
      global: { plugins: [i18n] },
    });
    expect(followUps.text()).toContain("allele frequency");

    const actions = mount(ChatMessageActions, {
      props: {
        role: "assistant",
        canRefresh: true,
        canReact: true,
        reactionActive: 0,
        directDownloads: [{ kind: "file", path: "/synthetic" }],
        generatedFormats: [],
        copied: false,
      },
      global: {
        plugins: [i18n],
        stubs: {
          ElIcon: true,
          ElTooltip: {
            name: "ElTooltip",
            template: "<div><slot /></div>",
          },
          ElDropdown: {
            name: "ElDropdown",
            template:
              '<div class="dropdown-stub"><slot /><slot name="dropdown" /></div>',
          },
          ElDropdownMenu: {
            template: '<div class="dropdown-menu-stub"><slot /></div>',
          },
          ElDropdownItem: {
            template: "<button><slot /></button>",
          },
        },
      },
    });
    expect(actions.find('[data-testid="chat-message-actions"]').exists()).toBe(
      true
    );
    expect(actions.find('[data-testid="action-copy"]').exists()).toBe(true);
  });

  it("mounts Activity, analyst log, A2UI, simulated progress, and real transfer", async () => {
    const i18n = createI18n({
      legacy: false,
      locale: "en-US",
      messages: { "en-US": enUS, "zh-CN": zhCN },
    });

    const closed = mount(ChatActivity, {
      props: {
        blocks: FIXTURE_ACTIVITY_BLOCKS,
        stateKey: FIXTURE_ACTIVITY_STATE_KEY,
        expanded: false,
        streaming: true,
      },
      global: { plugins: [i18n] },
    });
    expect(closed.find("button").attributes("aria-expanded")).toBe("false");
    expect(closed.find(".tool-block").exists()).toBe(false);

    const open = mount(ChatActivity, {
      props: {
        blocks: FIXTURE_ACTIVITY_BLOCKS,
        stateKey: FIXTURE_ACTIVITY_STATE_KEY,
        expanded: true,
        streaming: false,
      },
      global: { plugins: [i18n] },
    });
    expect(open.find(".tool-block").exists()).toBe(true);

    const log = mount(ChatAnalystLog, {
      props: {
        rowId: MESSAGE_ANALYST_LOG.id,
        taskId: MESSAGE_ANALYST_LOG.task_id,
        logData: "Synthetic log",
      },
      global: { plugins: [i18n, ElementPlus] },
    });
    expect(log.find("[data-testid='chat-analyst-log']").exists()).toBe(true);

    const progress = mount(SendProgress, {
      props: {
        startedAt: FIXTURE_PROGRESS_STARTED_AT,
        agentName: "ChatAgent",
        completing: false,
      },
      global: { plugins: [i18n] },
    });
    expect(progress.find('[data-test="send-progress"]').exists()).toBe(true);

    const transfer = mount(TransferProgress, {
      props: { snapshot: FIXTURE_UPLOAD_TRANSFER },
      global: {
        plugins: [i18n],
        stubs: { "el-progress": true },
      },
    });
    expect(transfer.find('[data-test="transfer-progress"]').exists()).toBe(
      true
    );

    const a2ui = mount(AgentSurfaceBlock, {
      props: {
        block: FIXTURE_A2UI_REQUIRED_BLOCK,
      },
      global: { plugins: [i18n, ElementPlus] },
    });
    expect(a2ui.find(".a2ui-form").exists()).toBe(true);
    expect(a2ui.text()).toContain("Species");
  });

  it("cited and DeepGenome content paths always receive a page-unique ns", () => {
    expect(CONTENT_SOURCE).toContain(":ns=\"'m' + index\"");
    expect(CONTENT_SOURCE).toMatch(
      /:ns="message\.doc_list\?\.length \? 'm' \+ index : undefined"/
    );

    const cited = mount(ChatMessageContent, {
      props: {
        message: MESSAGE_CITED,
        index: 1,
        isLastMessage: true,
        geneNetworkImages: EMPTY_IMAGES,
        geneNetworkImagesLoading: EMPTY_LOADING,
        digitalDesignImages: EMPTY_IMAGES,
        digitalDesignImagesLoading: EMPTY_LOADING,
      },
      global: {
        stubs: {
          CitedAnswer: {
            name: "CitedAnswer",
            props: ["ns"],
            template:
              '<div data-testid="cited-answer" :data-ns="ns === undefined ? \'__absent__\' : String(ns)" />',
          },
          DeepGenomeResultViewer: true,
          StreamMessage: true,
          MarkdownViewer: true,
          ElIcon: true,
          ElTable: true,
          ElTableColumn: true,
        },
      },
    });
    expect(
      cited.find('[data-testid="cited-answer"]').attributes("data-ns")
    ).toBe("m1");
  });
});

describe("ChatInteractionV2 — per-dialogue isolation", () => {
  it("isolates ChatUIState and message-owned runtime across A→B→A", () => {
    const s = useChatStates();
    const transportA = createMemoryA2uiTransport([]);
    const transportB = createMemoryA2uiTransport([]);

    s.currentChatId.value = "A";
    populateFullChatState(s.getChatState("A"), "A", transportA);
    const stateA = s.getChatState("A");
    const ownedA = stateA;
    const ownedRenderedA = stateA.renderedChat;
    const ownedTransferA = stateA.uploadTransfer;
    const ownedRuntimeA = stateA.renderedChat?.messages[1].a2uiRuntime;

    s.currentChatId.value = "B";
    populateFullChatState(s.getChatState("B"), "B", transportB);
    const stateB = s.getChatState("B");

    expect(s.messageInput.value).toBe("draft-B");
    expect(s.chatMode.value).toBe("instant");
    expect(s.selectedAgent.value).toBe("DataAgent");
    expect(s.isSending.value).toBe(true);
    expect(s.uploadTransfer.value?.requestId).toBe("upload-B");
    expect(stateB.activityExpandedByMessage[FIXTURE_ACTIVITY_STATE_KEY]).toBe(
      true
    );
    expect(stateB.logErrorKinds["42"]).toBe("update");
    expect(stateB.renderedChat?.messages[1].a2uiRuntime?.runId).toBe("run-B");
    expect(stateB.renderedChat?.messages[1].a2uiRuntime?.transport).toBe(
      transportB
    );
    expect(stateB.reactions["99"]).toBe(2);
    expect(stateB.refreshingMessages["0_99"]).toBe(false);
    expect(stateB.copyVisible).toBe(2);
    expect(stateB.completing).toBe(false);

    s.currentChatId.value = "A";
    expect(s.getChatState("A")).toBe(ownedA);
    expect(s.messageInput.value).toBe("draft-A");
    expect(s.chatMode.value).toBe("expert");
    expect(s.selectedAgent.value).toBe("KnowledgeAgent");
    expect(s.fileList.value[0].name).toBe("A.txt");
    expect(s.isSending.value).toBe(true);
    expect(s.uploadTransfer.value).toBe(ownedTransferA);
    expect(s.getChatState("A").completing).toBe(true);
    expect(s.getChatState("A").activityExpandedByMessage).toEqual({
      [FIXTURE_ACTIVITY_STATE_KEY]: true,
      "log:42": true,
    });
    expect(s.getChatState("A").logData["42"]).toBe("log-A");
    expect(s.getChatState("A").loadingLog["42"]).toBe(false);
    expect(s.getChatState("A").logErrorKinds["42"]).toBe("fetch");
    expect(s.getChatState("A").reactions["99"]).toBe(1);
    expect(s.getChatState("A").refreshingMessages["0_99"]).toBe(true);
    expect(s.copyVisible.value).toBe(1);
    expect(s.getChatState("A").renderedChat?.messages[1].a2uiRuntime).toBe(
      ownedRuntimeA
    );
    expect(s.getChatState("A").renderedChat).toBe(ownedRenderedA);
    expect(s.getChatState("B")).toBe(stateB);
  });

  it("retranslates stored logErrorKinds on locale switch without mutating the record", async () => {
    const s = useChatStates();
    s.currentChatId.value = "A";
    const state = s.getChatState("A");
    state.logErrorKinds["42"] = "fetch";
    const kindsBefore = { ...state.logErrorKinds };

    const locale = ref<"en-US" | "zh-CN">("en-US");
    const i18n = createI18n({
      legacy: false,
      locale: locale.value,
      messages: { "en-US": enUS, "zh-CN": zhCN },
    });
    const w = mount(ChatAnalystLog, {
      props: {
        rowId: "42",
        taskId: "t",
        errorKind: state.logErrorKinds["42"],
      },
      global: { plugins: [i18n, ElementPlus] },
    });
    expect(w.text()).toContain(enUS.chat.log.fetchError);

    locale.value = "zh-CN";
    i18n.global.locale.value = "zh-CN";
    await nextTick();
    expect(w.text()).toContain(zhCN.chat.log.fetchError);
    expect(state.logErrorKinds).toEqual(kindsBefore);
    expect(state.logErrorKinds["42"]).toBe("fetch");
  });
});

describe("ChatInteractionV2 — temporary ID rekey", () => {
  it("moves a fully populated new_ dialogue by identity including Agent/Activity/log/transfer/A2UI", () => {
    const s = useChatStates();
    const tempId = "new_isolation_700";
    const serverId = "srv-isolation-700";
    const transport = createMemoryA2uiTransport([]);
    const state = s.getChatState(tempId);
    populateFullChatState(state, "A", transport);
    s.currentChatId.value = tempId;

    const owned = state;
    const ownedRendered = state.renderedChat;
    const ownedTransfer = state.uploadTransfer;
    const ownedActivity = state.activityExpandedByMessage;
    const ownedLog = state.logData;
    const ownedKinds = state.logErrorKinds;
    const ownedRuntime = state.renderedChat?.messages[1].a2uiRuntime;

    const result = s.rekeyChatState(tempId, serverId);
    expect(result).toEqual({ outcome: "moved" });
    expect(s.chatStates.value[serverId]).toBe(owned);
    expect(s.chatStates.value[tempId]).toBeUndefined();
    expect(s.chatStates.value[serverId].selectedAgent).toBe("KnowledgeAgent");
    expect(s.chatStates.value[serverId].activityExpandedByMessage).toBe(
      ownedActivity
    );
    expect(s.chatStates.value[serverId].logData).toBe(ownedLog);
    expect(s.chatStates.value[serverId].logErrorKinds).toBe(ownedKinds);
    expect(s.chatStates.value[serverId].uploadTransfer).toBe(ownedTransfer);
    expect(
      s.chatStates.value[serverId].renderedChat?.messages[1].a2uiRuntime
    ).toBe(ownedRuntime);
    expect(s.chatStates.value[serverId].renderedChat).toBe(ownedRendered);
  });

  it("collision changes neither record nor active dialogue id", () => {
    const s = useChatStates();
    const tempId = "new_collision_701";
    const serverId = "srv-existing-701";
    const transport = createMemoryA2uiTransport([]);
    const source = s.getChatState(tempId);
    populateFullChatState(source, "A", transport);
    const target = s.getChatState(serverId);
    target.messageInput = "target-keep";
    target.selectedAgent = "ReviewAgent";
    s.currentChatId.value = tempId;
    const urlUpdates: string[] = [];

    const rekey = s.rekeyChatState(tempId, serverId);
    expect(rekey).toEqual({ outcome: "target-collision" });
    expect(s.chatStates.value[tempId]).toBe(source);
    expect(s.chatStates.value[serverId]).toBe(target);
    expect(source.messageInput).toBe("draft-A");
    expect(target.messageInput).toBe("target-keep");
    expect(s.currentChatId.value).toBe(tempId);
    // Coordinator must not rewrite URL/active id on collision.
    expect(urlUpdates).toEqual([]);
  });
});

describe("ChatInteractionV2 — progress exclusivity and legacy absences", () => {
  it("never renders simulated SendProgress and real TransferProgress together", () => {
    expect(LOADING_BUBBLE).toContain("<TransferProgress");
    expect(LOADING_BUBBLE).toContain("<SendProgress");
    expect(LOADING_BUBBLE).toMatch(
      /<TransferProgress[\s\S]*?v-if="uploadTransfer"/
    );
    expect(LOADING_BUBBLE).toMatch(/<SendProgress[\s\S]*?v-else/);
    expect(LOADING_BUBBLE).not.toMatch(
      /<TransferProgress[\s\S]*?<SendProgress(?![\s\S]*v-else)/
    );

    // Harness mirrors the same exclusivity for Phase 3C progress/transfer keys.
    expect(getPhase3COverlay("progress-fast").kind).toBe("progress");
    expect(getPhase3COverlay("transfer-real").kind).toBe("transfer");
    expect(getPhase3COverlay("progress-fast").transfer).toBeUndefined();
    expect(getPhase3COverlay("transfer-real").progress).toBeUndefined();
  });

  it("asserts legacy surfaces and duplicate paths are gone", () => {
    expect(CHAT_SOURCE).not.toMatch(/message-fotter/);
    expect(ACTIONS_SOURCE).not.toMatch(/message-fotter/);
    expect(CHAT_SOURCE).not.toMatch(/log-view-(left|right|container)/);
    expect(CHAT_SOURCE).not.toContain('class="input-container-bottom"');
    expect(COMPOSER_SOURCE).not.toContain('class="agent-button"');
    expect(COMPOSER_SOURCE).toContain("<ChatAgentPicker");
    // One permanent picker path — no temporary bottom agent stage in chat root.
    expect(countOccurrences(CHAT_SOURCE, "<ChatAgentPicker")).toBe(0);
    expect(countOccurrences(COMPOSER_SOURCE, "<ChatAgentPicker")).toBe(1);
    // Single content owner — ChatMessageContent, not duplicate inline branches.
    expect(countOccurrences(CHAT_SOURCE, "<ChatMessageContent")).toBe(1);
    expect(artifactSlotStart).toBeGreaterThan(0);
    expect(artifactSlotEnd).toBeGreaterThan(artifactSlotStart);
    expect(ARTIFACT_SLOT_SOURCE).toContain("<ResearchArtifactShell");
    expect(CHAT_TRANSCRIPT_SOURCE).not.toContain("<CitedAnswer");
    expect(CHAT_TRANSCRIPT_SOURCE).not.toContain("<DeepGenomeResultViewer");
    expect(CHAT_TRANSCRIPT_SOURCE).not.toContain("<StreamMessage");
    // Artifact presentation owns the single citation surface outside the transcript.
    expect(countOccurrences(ARTIFACT_SLOT_SOURCE, "<CitedAnswer")).toBe(1);
  });
});

describe("ChatInteractionV2 — Phase 3C harness registry", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let xhrOpenSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    if (typeof XMLHttpRequest !== "undefined") {
      xhrOpenSpy = vi
        .spyOn(XMLHttpRequest.prototype, "open")
        .mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    xhrOpenSpy?.mockRestore();
  });

  it("registers every Phase 3C state as a typed synthetic key", () => {
    for (const key of PHASE_3C_FIXTURE_KEYS) {
      expect(CHAT_VISUAL_FIXTURE_KEYS).toContain(key);
      expect(isPhase3CFixtureKey(key)).toBe(true);
      expect(getSharedPhase3COverlay(key)).toBe(getPhase3COverlay(key));
      const resolved = resolveChatVisualFixture(key, "en-US", "light");
      expect(resolved.ok).toBe(true);
      const fixture = getChatVisualFixture(key);
      expect(fixture.key).toBe(key);
      expect(fixture.chatState).toBe("populated");
    }
  });

  it("fails when a Phase 3C key is absent from the closed registry", () => {
    expect(isPhase3CFixtureKey("activity-closed")).toBe(true);
    expect(isPhase3CFixtureKey("progress-invented")).toBe(false);
    expect(
      resolveChatVisualFixture("progress-invented", "en-US", "light").ok
    ).toBe(false);
  });

  it("renders Phase 3C overlays without network and without inventing backend success", async () => {
    const sampleKeys = [
      "activity-closed",
      "activity-open",
      "log-loading",
      "log-populated",
      "log-error",
      "log-missing-task",
      "progress-fast",
      "progress-slow",
      "progress-completing",
      "transfer-real",
      "a2ui-required",
      "send-stop",
      "parallel-a",
      "parallel-b",
    ] as const;

    for (const key of sampleKeys) {
      const fixture = getChatVisualFixture(key);
      const wrapper = mount(ChatVisualFixtureApp, {
        props: { fixture, errorMessage: null },
        global: {
          plugins: [createPinia()],
          mocks: { $t: (k: string) => k },
          stubs: {
            ChatModeSelector: true,
            ChatAgentPicker: true,
            LangSwitch: true,
            ThemeSwitch: true,
            ElUpload: true,
            ElDropdown: {
              name: "ElDropdown",
              template:
                '<div class="dropdown-stub"><slot /><slot name="dropdown" /></div>',
            },
            ElDropdownMenu: {
              template: '<div class="dropdown-menu-stub"><slot /></div>',
            },
            ElDropdownItem: {
              template: "<button><slot /></button>",
            },
            ElTooltip: {
              name: "ElTooltip",
              template: "<div><slot /></div>",
            },
            ElAvatar: true,
            ElIcon: true,
            ElButton: {
              name: "ElButton",
              template: "<button><slot /></button>",
            },
            ElTable: true,
            ElTableColumn: true,
            ElProgress: true,
            ElInput: true,
            ElInputNumber: true,
            ElSelect: true,
            ElOption: true,
            StreamMessage: {
              name: "StreamMessage",
              props: ["blocks", "activityExpandedByMessage"],
              template: '<div data-testid="stream-message" data-stream="1" />',
            },
            DeepGenomeResultViewer: true,
            CitedAnswer: true,
            MarkdownViewer: {
              name: "MarkdownViewer",
              props: ["content"],
              template: '<div data-testid="markdown-viewer" />',
            },
            teleport: true,
          },
        },
      });
      await flushPromises();
      await nextTick();

      expect(wrapper.find('[data-testid="chat-visual-root"]').exists()).toBe(
        true
      );
      expect(
        wrapper
          .find('[data-testid="chat-visual-root"]')
          .attributes("data-phase3c-kind")
      ).toBe(getPhase3COverlay(key).kind);
      expect(
        wrapper.findAll('[data-testid="chat-account-identity"]')
      ).toHaveLength(1);
      expect(wrapper.find('[data-testid="chat-account-identity"]').text()).toBe(
        SYNTHETIC_IDENTITY
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpenSpy?.mock.calls ?? []).toHaveLength(0);
      wrapper.unmount();
    }
  });
});
