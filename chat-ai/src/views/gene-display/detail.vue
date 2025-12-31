<!--
 * 组件注释
 * @Author: AI assistant
 * @Date: 2024-05-10
 * @Description: 基因详情页面
 * 既往不恋！当下不杂！！未来不迎！！！
-->
<template>
  <div class="gene-detail-container" v-loading="loading">
    <!-- 使用 DeepGenomeResultViewer 组件展示内容 -->
    <DeepGenomeResultViewer
      v-if="MDContent"
      :markdown="processedContent"
      :references="references"
    />
    <el-empty v-else-if="!loading" :description="$t('gene.notFound')"></el-empty>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getGeneDetails } from '@/api/gene-display';
import DeepGenomeResultViewer from '@/components/DeepGenomeResultViewer.vue';
import { useI18n } from 'vue-i18n';

// Import images
import treeImg from './images/tree.png';
import tissueImg from './images/LOC_Os01g08220_tissues.png';
import cultivarImg from './images/LOC_Os01g08220_cultivars.png';
import genotypeImg from './images/LOC_Os01g08220_genotypes.png';
import treatmentImg from './images/LOC_Os01g08220_treatments.png';
import motifImg from './images/motif.png';
import epicImg from './images/epic.png';
import promoterDesignImg from './images/promoter_design.png';
import structureImg from './images/OsD18_structure.png';
import ppiImg from './images/hap-ppi.png';
import mutationPpiImg from './images/mutation-ppi.png';
import psapScoresImg from './images/psap_scores.png';

const { t } = useI18n();

const route = useRoute();
const loading = ref(false);
const MDContent = ref("");
const references = ref<any[]>([]);

// 解析 DOC TITLES 为参考文献
const parseDocTitles = (content: string): { mainContent: string; refs: any[] } => {
  const separator = '--- DOC TITLES ---';
  const separatorIndex = content.indexOf(separator);

  if (separatorIndex === -1) {
    return { mainContent: content, refs: [] };
  }

  const mainContent = content.substring(0, separatorIndex).trim();
  const docTitlesSection = content.substring(separatorIndex + separator.length).trim();

  // 解析文献列表（格式：数字. 标题）
  const refs = docTitlesSection
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      // 匹配格式：1. 标题
      const match = line.match(/^\d+\.\s+(.+)$/);
      if (match) {
        return { title: match[1].trim() };
      }
      return null;
    })
    .filter(Boolean);

  return { mainContent, refs };
};

const processedContent = computed(() => {
  if (!MDContent.value) return '';

  // 先移除 DOC TITLES 部分
  const { mainContent } = parseDocTitles(MDContent.value);

  // 替换所有图片引用，并将实际换行符转换为字面 \n（DeepGenomeResultViewer 组件需要）
  return mainContent
    .replace(/!\[Tree Image\]\(.*?tree\.png/g, `![Tree Image](${treeImg}`)
    .replace(/!\[Tissue Image\]\(.*?tissues\.png/g, `![Tissue Image](${tissueImg}`)
    .replace(/!\[Cultivar Image\]\(.*?cultivars\.png/g, `![Cultivar Image](${cultivarImg}`)
    .replace(/!\[Genotype Image\]\(.*?genotypes\.png/g, `![Genotype Image](${genotypeImg}`)
    .replace(/!\[Treatment Image\]\(.*?treatments\.png/g, `![Treatment Image](${treatmentImg}`)
    .replace(/!\[Motif Image\]\(.*?motif\.png/g, `![Motif Image](${motifImg}`)
    .replace(/!\[Epic Image\]\(.*?epic\.png/g, `![Epic Image](${epicImg}`)
    .replace(/!\[PrompterDesign Image\]\(.*?promoter_design\.png/g, `![PrompterDesign Image](${promoterDesignImg}`)
    .replace(/!\[Sturcture Image\]\(.*?OsD18_structure\.png/g, `![Structure Image](${structureImg}`)
    .replace(/!\[PPI Image\]\(.*?hap-ppi\.png/g, `![PPI Image](${ppiImg}`)
    .replace(/!\[Mutation Image\]\(.*?psap_scores\.png/g, `![Mutation Image](${psapScoresImg}`)
    .replace(/\r\n/g, '\\n')  // 将 CRLF 转换为字面 \n
    .replace(/\n/g, '\\n');   // 将 LF 转换为字面 \n
});

// 获取基因详情
const fetchGeneDetail = async (file_name: string) => {
  loading.value = true;
  try {
    const res = await getGeneDetails({ file_name });

    if (res.code === 200 && res.data) {
      MDContent.value = res.data.content;

      // 解析 DOC TITLES 为参考文献
      const { refs } = parseDocTitles(res.data.content);
      references.value = refs;

      // 如果API返回了references，则优先使用它
      if (res.data.references && res.data.references.length > 0) {
        references.value = res.data.references;
      }
    } else {
      ElMessage.error(res.message || t('gene.getFailed'));
    }
  } catch (error) {
    console.error(t('gene.logs.fetchDetailFailed'), error);
    ElMessage.error(t('gene.getFailed'));
  } finally {
    loading.value = false;
  }
};

// 获取路由参数
onMounted(() => {
  const id = route.query.file_name as string;
  if (id) {
    fetchGeneDetail(id);
  } else {
    ElMessage.warning(t('gene.notFound'));
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
