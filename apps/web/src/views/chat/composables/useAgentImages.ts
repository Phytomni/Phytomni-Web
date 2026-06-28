import { reactive, watch } from "vue";
import type { Ref } from "vue";
import { getObsImages } from "@/api/chat";

export function useAgentImages(currentChat: Ref<any>) {
  // GeneNetworkAgent / DigitalDesignAgent image download state (indexed by message id,
  // consistent with the frontend chat/index.vue)
  const geneNetworkImages = reactive<Record<string, string[]>>({});
  const geneNetworkImagesLoading = reactive<Record<string, boolean>>({});
  const digitalDesignImages = reactive<Record<string, string[]>>({});
  const digitalDesignImagesLoading = reactive<Record<string, boolean>>({});

  // fetch GeneNetworkAgent images (single download_path)
  const fetchGeneNetworkImages = async (
    messageId: string,
    downloadPath: string
  ) => {
    if (!messageId || !downloadPath || geneNetworkImages[messageId]) return;
    geneNetworkImagesLoading[messageId] = true;
    try {
      const res: any = await getObsImages({ obs_path: downloadPath });
      if (res.code === 200 && res.data) {
        const images = Array.isArray(res.data) ? res.data : [res.data];
        geneNetworkImages[messageId] = [...new Set(images)] as string[];
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
        const res: any = await getObsImages({ obs_path: path });
        if (res.code === 200 && res.data) {
          if (Array.isArray(res.data)) {
            allImages.push(...res.data);
          } else {
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
      messages.forEach((msg: any) => {
        if (
          msg.role === "assistant" &&
          msg.tool_name === "GeneNetworkAgent" &&
          msg.download_path &&
          msg.id &&
          !geneNetworkImages[msg.id]
        ) {
          fetchGeneNetworkImages(msg.id, msg.download_path);
        }
        if (
          msg.role === "assistant" &&
          msg.tool_name === "DigitalDesignAgent" &&
          msg.download_path &&
          msg.id &&
          !digitalDesignImages[msg.id]
        ) {
          let paths: string[] = [];
          if (Array.isArray(msg.download_path)) {
            paths = msg.download_path;
          } else if (typeof msg.download_path === "string") {
            try {
              const parsed = JSON.parse(msg.download_path);
              if (Array.isArray(parsed)) {
                paths = parsed;
              }
            } catch (e) {
              paths = [msg.download_path];
            }
          }
          if (paths.length > 0) {
            fetchDigitalDesignImages(msg.id, paths);
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
