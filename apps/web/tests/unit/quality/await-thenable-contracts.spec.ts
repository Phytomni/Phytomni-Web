import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string) =>
  readFileSync(resolve(__dirname, "../../../", relativePath), "utf8");

describe("await-thenable contracts", () => {
  it("declares the chat scroll owner as an asynchronous operation", () => {
    for (const path of [
      "src/views/chat/composables/useRefreshMessage.ts",
      "src/views/chat/composables/useSelectChat.ts",
      "src/views/chat/composables/useSendMessage.ts",
    ]) {
      expect(source(path)).toContain("scrollToBottom: () => Promise<void>;");
    }
  });

  it("keeps native window.print synchronous while retaining the error boundary", () => {
    const downloads = source("src/composables/useDeepGenomeDownloads.ts");
    expect(downloads).toContain("window.print();");
    expect(downloads).not.toContain("await window.print();");
  });
});
