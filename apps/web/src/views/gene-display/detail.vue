<template>
  <div class="gene-detail-container" v-loading="loading">
    <!-- Display content using the DeepGenomeResultViewer component -->
    <DeepGenomeResultViewer
      v-if="MDContent"
      :markdown="processedContent"
      :references="references"
    />
    <el-empty
      v-else-if="!loading"
      :description="$t('gene.notFound')"
    ></el-empty>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { getGeneDetails } from "@/api/gene-display";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import { useI18n } from "vue-i18n";
import { buildDisplayContent } from "./gene-markdown";

const { t } = useI18n();

const route = useRoute();
const loading = ref(false);
const MDContent = ref("");
const references = ref<any[]>([]);

// Parse DOC TITLES into references
const parseDocTitles = (
  content: string
): { mainContent: string; refs: any[] } => {
  const separator = "--- DOC TITLES ---";
  const separatorIndex = content.indexOf(separator);

  if (separatorIndex === -1) {
    return { mainContent: content, refs: [] };
  }

  const mainContent = content.substring(0, separatorIndex).trim();
  const docTitlesSection = content
    .substring(separatorIndex + separator.length)
    .trim();

  // Parse the reference list (format: number. title)
  const refs = docTitlesSection
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      // Match the format: 1. title
      const match = line.match(/^\d+\.\s+(.+)$/);
      if (match) {
        return { title: match[1].trim() };
      }
      return null;
    })
    .filter(Boolean);

  return { mainContent, refs };
};

const processedContent = computed(() => buildDisplayContent(MDContent.value));

// Fetch gene details
const fetchGeneDetail = async (file_name: string) => {
  loading.value = true;
  try {
    const res = await getGeneDetails({ file_name });

    if (res.code === 200 && res.data) {
      MDContent.value = res.data.content;

      // Parse DOC TITLES into references
      const { refs } = parseDocTitles(res.data.content);
      references.value = refs;

      // If the API returned references, prefer them
      if (res.data.references && res.data.references.length > 0) {
        references.value = res.data.references;
      }
    } else {
      ElMessage.error(res.message || t("gene.getFailed"));
    }
  } catch (error) {
    console.error(t("gene.logs.fetchDetailFailed"), error);
    ElMessage.error(t("gene.getFailed"));
  } finally {
    loading.value = false;
  }
};

// Get route parameters
onMounted(() => {
  const id = route.query.file_name as string;
  if (id) {
    fetchGeneDetail(id);
  } else {
    ElMessage.warning(t("gene.notFound"));
  }
});
</script>

<style scoped lang="scss">
.gene-detail-container {
  height: 100%;
  width: 100%;
  overflow: hidden;
}
</style>
