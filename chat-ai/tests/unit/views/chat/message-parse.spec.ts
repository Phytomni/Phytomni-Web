import { describe, it, expect } from "vitest";
import { parseMessageWithFiles } from "@/views/chat/utils/message-parse";

describe("parseMessageWithFiles", () => {
  it("无附件标记时原样返回 content，attachedFiles 为 undefined", () => {
    const result = parseMessageWithFiles("普通文本消息，不含附件标记");
    expect(result.content).toBe("普通文本消息，不含附件标记");
    expect(result.attachedFiles).toBeUndefined();
  });

  it("KB 单位：解析名称和大小，并从 content 中剥除标记", () => {
    const input = "请分析以下文件：[附件: report.pdf (12.5 KB)]";
    const result = parseMessageWithFiles(input);
    expect(result.attachedFiles).toBeDefined();
    expect(result.attachedFiles!.length).toBe(1);
    expect(result.attachedFiles![0].name).toBe("report.pdf");
    // 12.5 KB = 12.5 * 1024 bytes
    expect(result.attachedFiles![0].size).toBeCloseTo(12.5 * 1024);
    expect(result.content).not.toContain("[附件:");
    expect(result.content).toBe("请分析以下文件：");
  });

  it("MB 单位：大小解析为正确字节数", () => {
    const input = "[附件: data.zip (3.2 MB)]";
    const result = parseMessageWithFiles(input);
    expect(result.attachedFiles).toBeDefined();
    expect(result.attachedFiles![0].size).toBeCloseTo(3.2 * 1024 * 1024);
    expect(result.attachedFiles![0].name).toBe("data.zip");
    expect(result.content).toBe("");
  });

  it("裸 B 单位：大小解析为字节", () => {
    const input = "[附件: tiny.txt (512 B)]";
    const result = parseMessageWithFiles(input);
    expect(result.attachedFiles).toBeDefined();
    expect(result.attachedFiles![0].size).toBeCloseTo(512);
    expect(result.attachedFiles![0].name).toBe("tiny.txt");
  });

  it("附件 type 为空字符串，file 为 null（历史记录无法获取）", () => {
    const input = "[附件: sample.csv (1.0 KB)]";
    const result = parseMessageWithFiles(input);
    expect(result.attachedFiles![0].type).toBe("");
    expect(result.attachedFiles![0].file).toBeNull();
  });
});
