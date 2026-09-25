import type { ChatAttachment, HistoricalUploadFile } from "../types";

export interface ParsedMessageWithFiles {
  content: string;
  attachedFiles?: readonly ChatAttachment[];
}

// Parse marker metadata only when hydrating rows written before structured
// asset references existed. New sends must keep literal user text unchanged.
export const parseMessageWithFiles = (
  messageContent: string
): ParsedMessageWithFiles => {
  // check whether file-info markers are present; accept both the current
  // "Attachment" marker and the legacy "附件" marker still embedded in
  // already-persisted chat history
  const fileInfoRegex = /\[(?:Attachment|附件): ([^\]]+)\]/g;
  const fileMatches = messageContent.match(fileInfoRegex);

  if (!fileMatches || fileMatches.length === 0) {
    return {
      content: messageContent,
      attachedFiles: undefined,
    };
  }

  // extract file info
  const attachedFiles: HistoricalUploadFile[] = [];
  fileMatches.forEach((match) => {
    const fileInfo = match.match(
      /\[(?:Attachment|附件): ([^(]+) \(([^)]+)\)\]/
    );
    if (fileInfo) {
      const fileName = fileInfo[1].trim();
      const fileSizeStr = fileInfo[2].trim();

      // parse the file size
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
        type: "", // file type is unavailable from history
        file: null, // file object is unavailable from history
      });
    }
  });

  // remove file-info markers to get the plain text content
  const cleanContent = messageContent.replace(fileInfoRegex, "").trim();

  return {
    content: cleanContent,
    attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
  };
};
