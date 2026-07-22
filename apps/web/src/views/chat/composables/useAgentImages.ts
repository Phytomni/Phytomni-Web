import { reactive, watch } from "vue";
import type { Ref } from "vue";
import { getObsImages } from "@/api/chat";
import type { ChatMessage, ChatView } from "../types";

const isChatMessage = (value: unknown): value is ChatMessage =>
  typeof value === "object" && value !== null;

const nonEmptyStrings = (values: readonly unknown[]): string[] =>
  values.filter(
    (value): value is string => typeof value === "string" && value.trim() !== ""
  );

export function useAgentImages(currentChat: Ref<ChatView | null>) {
  // GeneNetworkAgent / DigitalDesignAgent image download state (indexed by message id,
  // consistent with the frontend ChatView.vue)
  const geneNetworkImages = reactive<Record<string, string[]>>({});
  const geneNetworkImagesLoading = reactive<Record<string, boolean>>({});
  const digitalDesignImages = reactive<Record<string, string[]>>({});
  const digitalDesignImagesLoading = reactive<Record<string, boolean>>({});

  // fetch GeneNetworkAgent images (single download_path)
  const fetchGeneNetworkImages = async (
    messageId: string,
    downloadPath: string
  ) => {
    const normalizedPath = downloadPath.trim();
    if (!messageId || !normalizedPath || geneNetworkImages[messageId]) return;
    geneNetworkImagesLoading[messageId] = true;
    try {
      const res = await getObsImages({ obs_path: normalizedPath });
      if (res.code === 200 && res.data) {
        const images = Array.isArray(res.data) ? res.data : [res.data];
        geneNetworkImages[messageId] = [...new Set(nonEmptyStrings(images))];
      } else {
        geneNetworkImages[messageId] = [];
      }
    } catch (error) {
      console.error("Failed to fetch GeneNetworkAgent images:", error);
      geneNetworkImages[messageId] = [];
    } finally {
      geneNetworkImagesLoading[messageId] = false;
    }
  };

  // fetch DigitalDesignAgent images (download_path may be an array or a JSON string)
  const fetchDigitalDesignImages = async (
    messageId: string,
    downloadPaths: string[]
  ) => {
    if (
      !messageId ||
      !downloadPaths ||
      downloadPaths.length === 0 ||
      digitalDesignImages[messageId]
    )
      return;
    digitalDesignImagesLoading[messageId] = true;
    try {
      const allImages: string[] = [];
      for (const path of downloadPaths) {
        const normalizedPath = path.trim();
        if (!normalizedPath) continue;
        const res = await getObsImages({ obs_path: normalizedPath });
        if (res.code === 200 && res.data) {
          if (Array.isArray(res.data)) {
            allImages.push(...nonEmptyStrings(res.data));
          } else if (typeof res.data === "string" && res.data.trim() !== "") {
            allImages.push(res.data);
          }
        }
      }
      digitalDesignImages[messageId] = allImages;
    } catch (error) {
      console.error("Failed to fetch DigitalDesignAgent images:", error);
      digitalDesignImages[messageId] = [];
    } finally {
      digitalDesignImagesLoading[messageId] = false;
    }
  };

  // watch currentChat messages and auto-fetch obs images by tool_name
  watch(
    () => currentChat.value?.messages,
    (messages) => {
      if (!messages) return;
      messages.filter(isChatMessage).forEach((msg) => {
        const messageId = typeof msg.id === "string" ? msg.id : "";
        const rawDownloadPath: unknown = msg.download_path;
        if (
          msg.role === "assistant" &&
          msg.tool_name === "GeneNetworkAgent" &&
          typeof rawDownloadPath === "string" &&
          rawDownloadPath.trim() !== "" &&
          messageId &&
          !geneNetworkImages[messageId]
        ) {
          fetchGeneNetworkImages(messageId, rawDownloadPath).catch(
            () => undefined
          );
        }
        if (
          msg.role === "assistant" &&
          msg.tool_name === "DigitalDesignAgent" &&
          rawDownloadPath !== undefined &&
          messageId &&
          !digitalDesignImages[messageId]
        ) {
          let paths: string[] = [];
          if (Array.isArray(rawDownloadPath)) {
            paths = nonEmptyStrings(rawDownloadPath);
          } else if (typeof rawDownloadPath === "string") {
            try {
              const parsed: unknown = JSON.parse(rawDownloadPath);
              if (Array.isArray(parsed)) {
                paths = nonEmptyStrings(parsed);
              } else if (typeof parsed === "string") {
                paths = [parsed];
              }
            } catch {
              paths = [rawDownloadPath];
            }
          }
          if (paths.length > 0) {
            fetchDigitalDesignImages(messageId, paths).catch(() => undefined);
          }
        }
      });
    },
    { immediate: true, deep: true }
  );

  return {
    geneNetworkImages,
    geneNetworkImagesLoading,
    digitalDesignImages,
    digitalDesignImagesLoading,
  };
}
