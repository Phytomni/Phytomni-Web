import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
  "utf8"
);
const SIDEBAR_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/sidebar.vue"),
  "utf8"
);

describe("Chat right surface ownership", () => {
  it("does not mount the legacy right-sidebar detail surface", () => {
    expect(CHAT_SOURCE).not.toContain('class="right-sidebar"');
    expect(CHAT_SOURCE).not.toContain("drawerVisible");
    expect(CHAT_SOURCE).not.toContain("currentLinks");
    expect(CHAT_SOURCE).not.toContain("openChatAgent");
    expect(CHAT_SOURCE).not.toContain("@openKnowledgeBase");
    expect(CHAT_SOURCE).not.toContain("chat.detailInfo");
    expect(CHAT_SOURCE).not.toContain("chat.relatedLinks");
  });

  it("uses PhyAdaptiveShell as the sole artifact right-column owner", () => {
    expect(CHAT_SOURCE).toContain("<PhyAdaptiveShell");
    expect(CHAT_SOURCE).toContain(':artifact-open="artifactOpen"');
    expect(CHAT_SOURCE).toContain("<template #artifact>");
    expect(CHAT_SOURCE).toContain("<ResearchArtifactShell");
    expect(CHAT_SOURCE.match(/:artifact-open=/g)?.length).toBe(1);
  });

  it("keeps architecture dialog mounted separately from the right column", () => {
    expect(CHAT_SOURCE).toContain("agentsViewVisible");
    expect(CHAT_SOURCE).toContain("showAgentsView");
    expect(CHAT_SOURCE).toContain("AgentsViewImg");
    expect(CHAT_SOURCE).toContain("useImageZoomPan");
    expect(CHAT_SOURCE).toContain("<el-dialog");
    expect(CHAT_SOURCE).toContain('@showArchitecture="showAgentsView"');
  });

  it("routes Gene Display through sidebar navigation to /gene-display", () => {
    expect(SIDEBAR_SOURCE).toContain("@gene-display=");
    expect(SIDEBAR_SOURCE).toContain("openKnowledgeBase");
    expect(CHAT_SOURCE).not.toContain('@openKnowledgeBase="openKnowledgeBase"');
  });

  it("removes orphan detail-sidebar locale keys from both packs", () => {
    expect(enUS.chat).not.toHaveProperty("detailInfo");
    expect(enUS.chat).not.toHaveProperty("relatedLinks");
    expect(enUS.chat).not.toHaveProperty("links");
    expect(zhCN.chat).not.toHaveProperty("detailInfo");
    expect(zhCN.chat).not.toHaveProperty("relatedLinks");
    expect(zhCN.chat).not.toHaveProperty("links");
  });
});
