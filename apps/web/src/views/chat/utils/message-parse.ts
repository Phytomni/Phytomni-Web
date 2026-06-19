import type { UploadFile } from "../types";

// 解析消息内容，提取文件信息
export const parseMessageWithFiles = (messageContent: string) => {
  // 检查是否包含文件信息标记
  const fileInfoRegex = /\[附件: ([^\]]+)\]/g;
  const fileMatches = messageContent.match(fileInfoRegex);

  if (!fileMatches || fileMatches.length === 0) {
    return {
      content: messageContent,
      attachedFiles: undefined,
    };
  }

  // 提取文件信息
  const attachedFiles: UploadFile[] = [];
  fileMatches.forEach((match) => {
    const fileInfo = match.match(/\[附件: ([^(]+) \(([^)]+)\)\]/);
    if (fileInfo) {
      const fileName = fileInfo[1].trim();
      const fileSizeStr = fileInfo[2].trim();

      // 解析文件大小
      let fileSize = 0;
      if (fileSizeStr.includes("KB")) {
        fileSize = parseFloat(fileSizeStr) * 1024;
      } else if (fileSizeStr.includes("MB")) {
        fileSize = parseFloat(fileSizeStr) * 1024 * 1024;
      } else if (fileSizeStr.includes("B")) {
        fileSize = parseFloat(fileSizeStr);
      }

      attachedFiles.push({
        name: fileName,
        size: fileSize,
        type: "", // 历史记录中无法获取文件类型
        file: null as any, // 历史记录中无法获取文件对象
      });
    }
  });

  // 移除文件信息标记，获取纯文本内容
  const cleanContent = messageContent.replace(fileInfoRegex, "").trim();

  return {
    content: cleanContent,
    attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
  };
};
