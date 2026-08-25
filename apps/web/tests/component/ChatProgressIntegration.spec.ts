import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/ChatView.vue"),
  "utf8"
);
const EXECUTION_ACTIVITY_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/views/chat/components/ExecutionActivityPanel.vue"
  ),
  "utf8"
);
const COMPOSER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatComposer.vue"),
  "utf8"
);
const ANALYSIS_WORKSPACE_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/views/analysis-agent/RemoteAnalysisAgentWorkspace.vue"
  ),
  "utf8"
);
const DIGITAL_DESIGN_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/views/digital-design-agent/DigitalDesignAgentView.vue"
  ),
  "utf8"
);
const ATTACHMENT_STRIP_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/AttachmentChipStrip.vue"),
  "utf8"
);

const loadingStart = CHAT_SOURCE.indexOf("<!-- Loading message:");
const loadingEnd = CHAT_SOURCE.indexOf("</ChatMessageRow>", loadingStart);
const LOADING_BUBBLE = CHAT_SOURCE.slice(loadingStart, loadingEnd);

describe("Chat progress placement integration", () => {
  it("renders upload progress or the same canonical execution activity in the loading bubble", () => {
    expect(LOADING_BUBBLE).toContain("<TransferProgress");
    expect(LOADING_BUBBLE).toContain("<ExecutionActivityPanel");
    expect(LOADING_BUBBLE).toMatch(
      /<TransferProgress[\s\S]*?v-if="uploadTransfer"/
    );
    expect(LOADING_BUBBLE).toMatch(/<ExecutionActivityPanel[\s\S]*?v-else/);
    expect(LOADING_BUBBLE).not.toContain("<SendProgress");
    expect(CHAT_SOURCE).not.toContain("PendingExecutionActivity");
    expect(CHAT_SOURCE).not.toContain("PendingExecutionRail");
  });

  it("keeps one Todo and Results rail for admission and execution", () => {
    expect(CHAT_SOURCE).toContain("<ExecutionRail");
    expect(CHAT_SOURCE).not.toContain("pendingBlockingExecution");
  });

  it("derives activity only from the canonical execution state", () => {
    expect(EXECUTION_ACTIVITY_SOURCE).toContain("<ExecutionTimeline");
    expect(EXECUTION_ACTIVITY_SOURCE).toContain("executionActivityIsStreaming");
    expect(CHAT_SOURCE).not.toContain("progressLabelKey");
    expect(CHAT_SOURCE).not.toContain("activeAgentName");
    expect(EXECUTION_ACTIVITY_SOURCE).not.toContain('role="progressbar"');
    expect(CHAT_SOURCE).not.toContain("SendProgress");
    expect(CHAT_SOURCE).not.toContain("agentProgress");
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
    expect(COMPOSER_SOURCE).toContain("<AttachmentChipStrip");
    expect(COMPOSER_SOURCE).not.toContain("<ChatUploadCard");
    for (const source of [
      COMPOSER_SOURCE,
      ANALYSIS_WORKSPACE_SOURCE,
      DIGITAL_DESIGN_SOURCE,
    ]) {
      expect(source).toContain("AttachmentChipStrip");
      expect(source).not.toContain("ChatUploadCard");
    }
    expect(COMPOSER_SOURCE).toContain(':announcement="attachmentAnnouncement"');
    expect(COMPOSER_SOURCE).not.toContain('v-if="fileList.length > 0"');
    expect(CHAT_SOURCE).not.toContain(
      'data-testid="chat-attachment-announcement"'
    );
    expect(CHAT_SOURCE).toContain(
      ':attachment-announcement-nonce="attachmentAnnouncementNonce"'
    );
    expect(CHAT_SOURCE).toContain(
      "MAX_ATTACHMENT_ANNOUNCEMENT_FILENAME_LENGTH"
    );
    expect(CHAT_SOURCE).not.toContain("attachmentAnnouncementNonces");
    expect(CHAT_SOURCE).toContain(
      "ownerState.attachmentAnnouncementNonce += 1"
    );
    expect(COMPOSER_SOURCE).not.toContain("CHAT_ATTACHMENT_ACCEPT");
    expect(ATTACHMENT_STRIP_SOURCE).toContain(
      'data-testid="attachment-chip-detail-progress"'
    );
    expect(ATTACHMENT_STRIP_SOURCE).toContain('role="progressbar"');
    expect(ATTACHMENT_STRIP_SOURCE).toContain('aria-live="polite"');
    expect(ATTACHMENT_STRIP_SOURCE).toContain(
      'data-testid="attachment-chip-detail-speed"'
    );
    expect(ATTACHMENT_STRIP_SOURCE).toContain(
      'data-testid="attachment-chip-detail-eta"'
    );
    expect(ATTACHMENT_STRIP_SOURCE).toContain("showsTransferMetrics");
  });
});
