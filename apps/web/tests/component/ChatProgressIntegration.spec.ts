import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/ChatView.vue"),
  "utf8"
);
const SEND_PROGRESS_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/SendProgress.vue"),
  "utf8"
);
const AGENT_PROGRESS_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/utils/agentProgress.ts"),
  "utf8"
);
const COMPOSER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatComposer.vue"),
  "utf8"
);
const UPLOAD_CARD_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatUploadCard.vue"),
  "utf8"
);

const loadingStart = CHAT_SOURCE.indexOf("<!-- Loading message:");
const loadingEnd = CHAT_SOURCE.indexOf("</ChatMessageRow>", loadingStart);
const LOADING_BUBBLE = CHAT_SOURCE.slice(loadingStart, loadingEnd);

const getMessage = (messages: unknown, path: string) =>
  path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object" && key in node) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, messages);

describe("Chat progress placement integration", () => {
  it("renders TransferProgress or SendProgress mutually exclusively in the loading bubble", () => {
    expect(LOADING_BUBBLE).toContain("<TransferProgress");
    expect(LOADING_BUBBLE).toContain("<SendProgress");
    expect(LOADING_BUBBLE).toMatch(
      /<TransferProgress[\s\S]*?v-if="uploadTransfer"/
    );
    expect(LOADING_BUBBLE).toMatch(/<SendProgress[\s\S]*?v-else/);
    // Both must not appear under a simultaneous v-if without exclusion.
    expect(LOADING_BUBBLE).not.toMatch(
      /<TransferProgress[\s\S]*?<SendProgress(?![\s\S]*v-else)/
    );
  });

  it("uses a routing-derived stage label without inferring one from elapsed time", () => {
    expect(LOADING_BUBBLE).toContain(':stage-label="t(progressLabelKey)"');
    expect(CHAT_SOURCE).toMatch(
      /const progressLabelKey = computed\(\(\) =>[\s\S]*?chatMode\.value === "expert"[\s\S]*?activeAgentName === ""[\s\S]*?"chat\.progress\.selectingAgent"[\s\S]*?: "chat\.progress\.processing"/
    );
    expect(SEND_PROGRESS_SOURCE).toContain("stageLabel?: string");
    expect(SEND_PROGRESS_SOURCE).toContain('t("chat.progress.processing")');
    expect(SEND_PROGRESS_SOURCE).not.toMatch(
      /stageLabel\s*=\s*(?:progressAt|elapsedMs|config)/
    );
    expect(AGENT_PROGRESS_SOURCE).not.toMatch(/etaKey|chat\.eta/);
  });

  it("locks progress locale keys and absence of chat.eta.*", () => {
    expect(getMessage(enUS, "chat.progress.processing")).toBe("Processing");
    expect(getMessage(zhCN, "chat.progress.processing")).toBe("处理中");
    expect(getMessage(enUS, "chat.progress.selectingAgent")).toBe(
      "Selecting an agent…"
    );
    expect(getMessage(zhCN, "chat.progress.selectingAgent")).toBe(
      "正在选择智能体…"
    );
    expect(getMessage(enUS, "chat.progress.valueText")).toBe(
      "Processing, {percent}%"
    );
    expect(getMessage(zhCN, "chat.progress.valueText")).toBe(
      "处理中，{percent}%"
    );
    expect(getMessage(enUS, "chat.eta")).toBeUndefined();
    expect(getMessage(zhCN, "chat.eta")).toBeUndefined();
    expect(getMessage(enUS, "chat.eta.fast")).toBeUndefined();
    expect(getMessage(zhCN, "chat.eta.fast")).toBeUndefined();
  });

  it("keeps aggregate transfer progress separate from per-file recovery controls", () => {
    expect(CHAT_SOURCE).toContain(':has-blocking-uploads="hasBlockingUploads"');
    expect(CHAT_SOURCE).toContain('@pause-upload="uploadQueue.pauseUpload"');
    expect(CHAT_SOURCE).toContain(
      '@reselect-upload="uploadQueue.reselectUpload"'
    );
    expect(CHAT_SOURCE).toContain(
      '@remove-upload="uploadQueue.removeUploadById"'
    );
    expect(COMPOSER_SOURCE).toContain("hasBlockingUploads: boolean");
    expect(COMPOSER_SOURCE).toContain("!props.hasBlockingUploads");
    expect(COMPOSER_SOURCE).toContain("<ChatUploadCard");
    expect(COMPOSER_SOURCE).not.toContain("CHAT_ATTACHMENT_ACCEPT");
    expect(UPLOAD_CARD_SOURCE).toContain('role="progressbar"');
    expect(UPLOAD_CARD_SOURCE).toContain('aria-live="polite"');
    expect(UPLOAD_CARD_SOURCE).toContain("speedText");
    expect(UPLOAD_CARD_SOURCE).toContain("etaText");
  });
});
