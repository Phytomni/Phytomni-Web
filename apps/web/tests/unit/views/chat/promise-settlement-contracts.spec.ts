import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_ROOT = resolve(
  __dirname,
  "../../../../src/views/chat/composables"
);

function source(fileName: string): string {
  return readFileSync(resolve(SOURCE_ROOT, fileName), "utf8");
}

const sources = {
  agentImages: source("useAgentImages.ts"),
  chatHistoryActions: source("useChatHistoryActions.ts"),
  composer: source("useComposer.ts"),
  copyDownload: source("useCopyDownload.ts"),
  fileUpload: source("useFileUpload.ts"),
  logView: source("useLogView.ts"),
  reactions: source("useReactions.ts"),
  refreshMessage: source("useRefreshMessage.ts"),
  selectChat: source("useSelectChat.ts"),
  sendMessage: source("useSendMessage.ts"),
  sidebarNavigation: source("useSidebarNavigation.ts"),
};

describe("chat composable async-owner contracts", () => {
  it("settles watcher and action promises instead of discarding them", () => {
    expect(sources.agentImages).not.toMatch(/void fetch\w+\(/);
    expect(sources.agentImages).toMatch(
      /fetchGeneNetworkImages\(messageId, rawDownloadPath\)[\s\S]*\.catch\([\s\S]*?\(\) => undefined/
    );
    expect(sources.agentImages).toMatch(
      /fetchDigitalDesignImages\(messageId, paths\)[\s\S]*\.catch\([\s\S]*?\(\) => undefined/
    );
    expect(sources.chatHistoryActions).toContain(
      "toggleFavorite(chat).catch(() => undefined);"
    );
    expect(sources.logView).not.toContain("void fetchLogIfNeeded");
    expect(sources.logView).toContain(
      "fetchLogIfNeeded(rowId, chatState).catch(() => undefined);"
    );
  });

  it("settles Vue microtask callbacks in every chat owner", () => {
    for (const owner of [
      sources.composer,
      sources.fileUpload,
      sources.logView,
      sources.refreshMessage,
      sources.selectChat,
      sources.sendMessage,
    ]) {
      const nextTickCount = (owner.match(/\bnextTick\(/g) ?? []).length;
      const settledCount = (owner.match(/\.catch\(\(\) => undefined\)/g) ?? [])
        .length;
      expect(settledCount).toBeGreaterThanOrEqual(nextTickCount);
    }
    expect(sources.reactions).not.toContain("nextTick(scrollToBottom)");
    expect(sources.reactions).toContain(
      "scrollToBottom().catch(() => undefined);"
    );
  });

  it("settles clipboard, session-expiry, and sidebar navigation outcomes", () => {
    expect(sources.copyDownload).toMatch(
      /navigator\.clipboard\s*\.writeText\(text\)[\s\S]*\.catch\(\(\) => \{/
    );
    expect(sources.sendMessage).toMatch(
      /ElMessageBox\.alert\([\s\S]*\.catch\(\(\) => undefined\)/
    );
    expect(sources.sidebarNavigation).not.toMatch(/^\s*opts\.router\.push\(/m);
    expect(sources.sidebarNavigation).toContain(".catch(() => undefined)");
  });
});
