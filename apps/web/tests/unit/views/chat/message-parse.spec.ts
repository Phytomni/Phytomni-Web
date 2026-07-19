import { describe, it, expect } from "vitest";
import { parseMessageWithFiles } from "@/views/chat/utils/message-parse";

describe("parseMessageWithFiles", () => {
  it("returns content unchanged and attachedFiles undefined when no marker is present", () => {
    const result = parseMessageWithFiles(
      "Plain text message without an attachment marker"
    );
    expect(result.content).toBe(
      "Plain text message without an attachment marker"
    );
    expect(result.attachedFiles).toBeUndefined();
  });

  it("KB unit: parses name and size and strips the marker from content", () => {
    const input =
      "Please analyze the following file: [Attachment: report.pdf (12.5 KB)]";
    const result = parseMessageWithFiles(input);
    expect(result.attachedFiles).toBeDefined();
    expect(result.attachedFiles!.length).toBe(1);
    expect(result.attachedFiles![0].name).toBe("report.pdf");
    // 12.5 KB = 12.5 * 1024 bytes
    expect(result.attachedFiles![0].size).toBeCloseTo(12.5 * 1024);
    expect(result.content).not.toContain("[Attachment:");
    expect(result.content).toBe("Please analyze the following file:");
  });

  // Backward-compatibility: chat history persisted before the marker was
  // renamed still embeds the legacy "[附件: ...]" form, so the parser must
  // keep recognizing it. The CJK here is intentional test data for that path.
  it("legacy 附件 marker: MB unit still parses size and name", () => {
    const input = "[附件: data.zip (3.2 MB)]";
    const result = parseMessageWithFiles(input);
    expect(result.attachedFiles).toBeDefined();
    expect(result.attachedFiles![0].size).toBeCloseTo(3.2 * 1024 * 1024);
    expect(result.attachedFiles![0].name).toBe("data.zip");
    expect(result.content).toBe("");
  });

  it("bare B unit: parses size as bytes", () => {
    const input = "[Attachment: tiny.txt (512 B)]";
    const result = parseMessageWithFiles(input);
    expect(result.attachedFiles).toBeDefined();
    expect(result.attachedFiles![0].size).toBeCloseTo(512);
    expect(result.attachedFiles![0].name).toBe("tiny.txt");
  });

  it("attachment type is empty string and file is null (not available from history)", () => {
    const input = "[Attachment: sample.csv (1.0 KB)]";
    const result = parseMessageWithFiles(input);
    expect(result.attachedFiles![0].type).toBe("");
    expect(result.attachedFiles![0].file).toBeNull();
  });
});
