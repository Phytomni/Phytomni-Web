import { ElMessage } from "element-plus";
import { saveAs } from "file-saver";
import {
  getConversationArtifactDownloadURL,
  getConversationArtifactFile,
  retryConversationResultArchive,
} from "@/api/chat";
import {
  decodeAgentResultDelivery,
  type AgentResultDelivery,
  type ConversationArtifactLink,
} from "@/api/types";
import i18n from "@/locales";
import {
  removeDownloadTransfer,
  upsertDownloadTransfer,
} from "@/utils/download-transfers";
import { asBinaryResponse } from "@/utils/request";
import { createTransferTracker } from "@/utils/transfer-progress";
import type { ChatUIState } from "../types";

let resultArchiveDownloadSequence = 0;

const SAFE_DIALOGUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const SAFE_MESSAGE_ID = /^[1-9]\d{0,18}$/u;
const SAFE_ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function isPositiveMessageId(value: string): boolean {
  if (!SAFE_MESSAGE_ID.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function isCanceledRequest(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  return record.code === "ERR_CANCELED" || record.name === "CanceledError";
}

export function useResultArchiveDelivery(options: {
  getChatState: (dialogueId: string) => ChatUIState;
}) {
  const retryResultArchive = async (input: {
    dialogueId: string;
    messageId: string;
    onPending: (delivery: AgentResultDelivery) => void;
  }): Promise<void> => {
    const { dialogueId, messageId, onPending } = input;
    if (!SAFE_DIALOGUE_ID.test(dialogueId) || !isPositiveMessageId(messageId)) {
      return;
    }

    const state = options.getChatState(dialogueId);
    if (state.archiveRetryingByMessageId[messageId]) return;

    state.archiveRetryingByMessageId[messageId] = true;
    try {
      const response = await retryConversationResultArchive({
        dialogue_id: dialogueId,
        message_id: messageId,
      });
      const delivery = decodeAgentResultDelivery(response.data);
      if (response.code !== 200 || delivery.status !== "pending") {
        throw new Error("Archive retry did not become pending");
      }
      onPending(delivery);
    } catch {
      ElMessage.error(i18n.global.t("chat.resultArchive.retryFailed"));
    } finally {
      delete state.archiveRetryingByMessageId[messageId];
    }
  };

  const downloadResultArchive = async (input: {
    dialogueId: string;
    messageId: string;
    artifact: ConversationArtifactLink;
  }): Promise<void> => {
    const { dialogueId, messageId, artifact } = input;
    if (
      !SAFE_DIALOGUE_ID.test(dialogueId) ||
      !isPositiveMessageId(messageId) ||
      artifact.kind !== "archive" ||
      !SAFE_ARTIFACT_ID.test(artifact.id)
    ) {
      return;
    }

    const requestId = `result-archive-${Date.now()}-${++resultArchiveDownloadSequence}`;
    const tracker = createTransferTracker({ phase: "download", requestId });
    try {
      const signed = await getConversationArtifactDownloadURL({
        dialogue_id: dialogueId,
        message_id: messageId,
        artifact_id: artifact.id,
      });
      if (signed.code !== 200 || !signed.data) {
        throw new Error("Archive signing failed");
      }
      const response = asBinaryResponse(
        await getConversationArtifactFile(signed.data, {
          requestId,
          onDownloadProgress: (event) => {
            upsertDownloadTransfer(tracker.update(event));
          },
        })
      );
      saveAs(response.data, artifact.name);
    } catch (error) {
      if (isCanceledRequest(error)) {
        ElMessage.info(i18n.global.t("chat.downloadCancelled"));
        return;
      }
      ElMessage.error(i18n.global.t("chat.resultArchive.downloadFailed"));
    } finally {
      removeDownloadTransfer(requestId);
    }
  };

  return { retryResultArchive, downloadResultArchive };
}
