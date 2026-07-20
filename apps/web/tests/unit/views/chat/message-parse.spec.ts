import { describe, it, expect } from "vitest";
import { parseMessageWithFiles } from "@/views/chat/utils/message-parse";
import {
  chatContentToRows,
  chatContentToText,
  decodeChatContent,
  decodeStreamContentBlock,
} from "@/views/chat/messageTypes";

function firstAttachment(result: ReturnType<typeof parseMessageWithFiles>) {
  const attachment = result.attachedFiles?.[0];
  expect(attachment).toBeDefined();
  if (!attachment) throw new Error("expected one parsed attachment");
  return attachment;
}

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
    expect(result.attachedFiles).toHaveLength(1);
    const attachment = firstAttachment(result);
    expect(attachment.name).toBe("report.pdf");
    // 12.5 KB = 12.5 * 1024 bytes
    expect(attachment.size).toBeCloseTo(12.5 * 1024);
    expect(result.content).not.toContain("[Attachment:");
    expect(result.content).toBe("Please analyze the following file:");
  });

  // Backward-compatibility: chat history persisted before the marker was
  // renamed still embeds the legacy "[附件: ...]" form, so the parser must
  // keep recognizing it. The CJK here is intentional test data for that path.
  it("legacy 附件 marker: MB unit still parses size and name", () => {
    const input = "[附件: data.zip (3.2 MB)]";
    const result = parseMessageWithFiles(input);
    const attachment = firstAttachment(result);
    expect(attachment.size).toBeCloseTo(3.2 * 1024 * 1024);
    expect(attachment.name).toBe("data.zip");
    expect(result.content).toBe("");
  });

  it("bare B unit: parses size as bytes", () => {
    const input = "[Attachment: tiny.txt (512 B)]";
    const result = parseMessageWithFiles(input);
    const attachment = firstAttachment(result);
    expect(attachment.size).toBeCloseTo(512);
    expect(attachment.name).toBe("tiny.txt");
  });

  it("attachment type is empty string and file is null (not available from history)", () => {
    const input = "[Attachment: sample.csv (1.0 KB)]";
    const result = parseMessageWithFiles(input);
    const attachment = firstAttachment(result);
    expect(attachment.type).toBe("");
    expect(attachment.file).toBeNull();
  });
});

describe("chat message boundary decoders", () => {
  it("accepts blocking text and legacy object content without widening to any", () => {
    expect(decodeChatContent("blocking answer")).toBe("blocking answer");
    expect(
      decodeChatContent({
        final_answer: "legacy answer",
        steps: ["retrieve"],
      })
    ).toEqual({
      final_answer: "legacy answer",
      steps: ["retrieve"],
    });
    expect(chatContentToText({ final_answer: "legacy answer" })).toBe(
      "legacy answer"
    );
    expect(chatContentToRows([{ gene: "Os01g01010" }])).toEqual([
      { gene: "Os01g01010" },
    ]);
    expect(decodeChatContent(undefined)).toBeUndefined();
  });

  it("keeps known streamed blocks typed at the decoder boundary", () => {
    expect(
      decodeStreamContentBlock({
        type: "markdown",
        authority: "web",
        text: "partial answer",
      })
    ).toEqual({
      type: "markdown",
      authority: "web",
      text: "partial answer",
    });
  });

  it("rejects unknown streamed block types instead of creating an interactive surface", () => {
    expect(
      decodeStreamContentBlock({
        type: "future-widget",
        authority: "agent",
        interactive: true,
      })
    ).toBeUndefined();
  });
});
