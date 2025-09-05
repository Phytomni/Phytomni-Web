<!--
 * 组件注释
 * @Author: AI assistant
 * @Date: 2024-05-10
 * @Description: 基因详情页面
 * 既往不恋！当下不杂！！未来不迎！！！
-->
<template>
  <div class="gene-detail-container">
    <!-- 内容区域 -->
    <div class="page-content" v-loading="loading">
      <!-- <div v-if="geneDetail" class="detail-card">
        <div class="detail-header">
          <h1 class="detail-title">{{ geneDetail.title }}</h1>
          <div class="detail-id">{{ $t('gene.id') }}: {{ geneDetail.id }}</div>
        </div>

        <div class="detail-body">
          <div class="detail-image">
            <el-image
              :src="geneDetail.picture"
              fit="cover"
              :preview-src-list="[geneDetail.picture]">
              <template #error>
                <div class="image-error">
                  <el-icon><Picture /></el-icon>
                  <span>{{ $t('gene.loadFailed') }}</span>
                </div>
              </template>
</el-image>
</div>

<div class="detail-section">
  <h3 class="section-title">{{ $t('gene.summary') }}</h3>
  <p class="section-content">{{ geneDetail.synopsis }}</p>
</div>

<div class="detail-section">
  <h3 class="section-title">{{ $t('gene.details') }}</h3>
  <div class="section-content content-formatted" v-html="formattedContent"></div>
</div>
</div>
</div> -->
      <div v-if="MDContent" class="detail-card">
        <Protein3DViewer v-for="item in viewerList" :pdbName="item.pdbName" />
        <MarkdownViewer :content="processedContent" />
      </div>
      <el-empty v-else-if="!loading" :description="$t('gene.notFound')"></el-empty>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Picture } from '@element-plus/icons-vue';
import { getGeneDetails } from '@/api/gene-display';
import MarkdownViewer from '@/components/MarkdownViewer.vue'
import Protein3DViewer from '@/components/Protein3DViewer.vue'
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

// 定义基因详情数据接口
interface GeneDetail {
  id: number;
  title: string;
  synopsis: string;
  picture: string;
  content: string;
}
const viewerList = ref([
  {
    pdbName: "1ycr",
  }
]);
const route = useRoute();
const geneDetail = ref<GeneDetail | null>(null);
const loading = ref(false);
const MDContent = ref("");
// 格式化内容，将\n转换为<br>
const formattedContent = computed(() => {
  if (!geneDetail.value?.content) return '';
  return geneDetail.value.content
    .replace(/\\\\n\\\\n/g, '<br><br>')
    .replace(/\\\\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
});

const processedContent = computed(() => {
  if (!MDContent.value) return '';

  // 替换所有图片引用
  return MDContent.value
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
    .replace(/!\[Mutation Image\]\(.*?psap_scores\.png/g, `![Mutation Image](${psapScoresImg}`);
});

// 获取基因详情
const fetchGeneDetail = async (id: string) => {
  loading.value = true;
  try {
    const res = await getGeneDetails({ id });

    if (res.code === 200 && res.data) {
      // geneDetail.value = res.data;
      MDContent.value = res.data.content;
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
  const id = route.query.id as string;
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
  display: flex;
  flex-direction: column;
  background-color: #f5f7fa;
  overflow: hidden;

  // 内容区域 - 添加滚动条
  .page-content {
    flex: 1;
    padding: 20px;
    overflow-y: auto;

    .detail-card {
      background-color: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
      margin: 0 auto;
      width: 90%;
      max-width: 1000px;
      overflow: hidden;
      padding: 20px;

      .detail-header {
        padding: 24px 30px;
        border-bottom: 1px solid #ebeef5;

        .detail-title {
          font-size: 24px;
          font-weight: bold;
          color: #303133;
          margin-bottom: 8px;
        }

        .detail-id {
          font-size: 14px;
          color: #909399;
        }
      }

      .detail-body {
        padding: 30px;

        .detail-image {
          margin-bottom: 24px;
          text-align: center;

          .el-image {
            width: 100%;
            max-height: 400px;
            border-radius: 8px;
            overflow: hidden;
          }

          .image-error {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 200px;
            color: #909399;
            background-color: #f5f7fa;
            border-radius: 8px;

            .el-icon {
              font-size: 32px;
              margin-bottom: 8px;
            }
          }
        }

        .detail-section {
          margin-bottom: 24px;

          .section-title {
            font-size: 18px;
            font-weight: bold;
            color: #303133;
            margin-bottom: 16px;
            padding-left: 10px;
            border-left: 4px solid #409eff;
          }

          .section-content {
            font-size: 16px;
            color: #606266;
            line-height: 1.6;
          }

          .content-formatted {
            white-space: pre-line;
          }
        }
      }
    }
  }
}

:deep(.content-formatted) {
  a {
    color: #409eff;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
