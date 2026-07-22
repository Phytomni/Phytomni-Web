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

  it("does not invent stage labels from elapsed time in Chat or SendProgress", () => {
    // Chat never binds a fabricated stage; only pass stageLabel when a structured event exists.
    expect(LOADING_BUBBLE).not.toMatch(/:stage-label=/);
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
});
