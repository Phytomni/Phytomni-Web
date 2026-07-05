<template>
  <div class="brief-gene-agent-container">
    <div class="chat-header">
      <div class="header-content">
        <el-button
          type="primary"
          :icon="ArrowLeft"
          @click="goBack"
          class="back-button"
        >
          {{ $t("common.back") }}
        </el-button>
        <div class="header-text">
          <h1>{{ $t("agents.briefGene.title") }}</h1>
          <p>{{ $t("agents.briefGene.subtitle") }}</p>
        </div>
      </div>
    </div>

    <div class="chat-messages">
      <!-- User question -->
      <div class="message user-message">
        <div class="message-content">
          <div class="message-text">
            How does single-cell RNA sequencing (scRNA-seq) reveal the
            heterogeneous responses of different cell types within plant organs
            to biotic/abiotic stresses?
          </div>
        </div>
      </div>

      <!-- AI answer -->
      <div class="message ai-message">
        <div class="message-avatar">
          <el-avatar :size="36" :src="botAvatar" />
        </div>
        <div class="message-content">
          <div class="message-text">
            <CitedAnswer
              :content="briefGeneAnswer.content"
              :references="briefGeneAnswer.references"
              :ns="'bg'"
            />
            <div class="tip-text">{{ $t("common.Tip") }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { ArrowLeft } from "@element-plus/icons-vue";
import CitedAnswer from "@/components/CitedAnswer.vue";

const router = useRouter();
const goBack = () => {
  router.back();
};

const botAvatar =
  "/avatars/bot.svg";

const briefGeneAnswer = {
  content: `**Title**: Advances in Single-Cell RNA Sequencing (scRNA-seq) Methodology and Its Applications in Plant Biology

**Results**:

Single-cell RNA sequencing (scRNA-seq) methodology in plant biology

Single-cell RNA sequencing (scRNA-seq) has revolutionized the field of plant biology by enabling the study of gene expression at the individual cell level, thus addressing the limitations of bulk tissue sampling which often masks cellular heterogeneity [1]. The application of protoplasts in scRNA-seq has been particularly transformative, allowing for comprehensive exploration of single-cell transcriptomes and providing insights into plant development, responses to environmental cues, and crop improvement [1].

The technological advancements in single-cell transcriptomics have broadened the scope of plant biotechnology research, enabling detailed analysis of gene expression and elucidating complex cellular processes and developmental pathways [2]. Despite the challenges associated with sample preparation, cell isolation, and data complexity, strategies such as optimizing protoplast isolation and improving computational tools for data integration are being developed to mitigate these issues [2].

Cell-type-specific responses to biotic stresses in plants

Understanding cell-type-specific responses to biotic stresses in plants is crucial for developing resilient crops. Single-cell transcriptomics has enabled the analysis of molecular responses at the single-cell level, revealing the complexity of plant stress responses and the specific roles of different cell types [9][10]. For example, the analysis of Arabidopsis guard cells in response to abscisic acid has identified 909 genes specifically regulated, highlighting the sensitivity of single-cell transcriptomic approaches [11].

Cell-type-specific responses to abiotic stresses in plants

Abiotic stresses, such as drought, salinity, and cold, trigger complex physiological and biochemical changes in plants, which occur in a cell-type-specific manner [17]. Advances in cell-type-specific isolation techniques, such as laser capture microdissection (LCM) and fluorescent activated cell sorting (FACS), have enabled the transcriptional profiling of specific plant cell types, providing insights into their responses to abiotic stresses.

In conclusion, single-cell RNA sequencing has revolutionized our understanding of plant stress responses by enabling the analysis of gene expression at the individual cell level. This technology has revealed the complexity and heterogeneity of plant stress responses, providing insights into the molecular mechanisms underlying plant adaptation to environmental challenges.`,
  references: [
    {
      file_id: "bg-1",
      title:
        "Single-cell RNA sequencing in plant biology: methods and applications.pdf",
    },
    {
      file_id: "bg-2",
      title:
        "Protoplast isolation strategies for plant single-cell transcriptomics.pdf",
    },
    {
      file_id: "bg-3",
      title: "Computational tools for single-cell RNA-seq data integration.pdf",
    },
    {
      file_id: "bg-4",
      title:
        "Single-cell transcriptomics reveals developmental trajectories in plant root tissues.pdf",
    },
    {
      file_id: "bg-5",
      title:
        "Resolving cellular heterogeneity in plant organs with scRNA-seq.pdf",
    },
    {
      file_id: "bg-6",
      title: "Advances in laser capture microdissection for plant tissues.pdf",
    },
    {
      file_id: "bg-7",
      title:
        "Fluorescence-activated cell sorting of plant protoplasts for transcriptomic profiling.pdf",
    },
    {
      file_id: "bg-8",
      title:
        "Single-cell atlases of crop species under environmental stress.pdf",
    },
    {
      file_id: "bg-9",
      title: "Single-cell transcriptomic atlas of plant stress responses",
      au: "Author, A. et al",
      ti: "Single-cell transcriptomic atlas of plant stress responses",
      so: "NATURE PLANTS",
      vl: "7",
      bp: "100",
      ep: "112",
      py: "2021",
      di: "10.1038/s41477-021-00000-0",
      dl: "http://dx.doi.org/10.1038/s41477-021-00000-0",
      pm: "33333333",
    },
    {
      file_id: "bg-10",
      title:
        "Cell-type-specific molecular responses to biotic stress in plants.pdf",
    },
    {
      file_id: "bg-11",
      title: "Single-cell profiling of Arabidopsis guard cell ABA responses",
      au: "Chen, L. et al",
      ti: "Single-cell profiling of Arabidopsis guard cell ABA responses",
      so: "NATURE PLANTS",
      vl: "8",
      bp: "215",
      ep: "228",
      py: "2022",
      di: "10.1038/s41477-022-00001-1",
      dl: "http://dx.doi.org/10.1038/s41477-022-00001-1",
      pm: "35444444",
    },
    {
      file_id: "bg-12",
      title: "Guard cell signaling networks in abscisic acid response.pdf",
    },
    {
      file_id: "bg-13",
      title: "Transcriptional profiling of plant cell types under drought.pdf",
    },
    {
      file_id: "bg-14",
      title: "Cell-type-specific salinity stress responses in crop roots.pdf",
    },
    {
      file_id: "bg-15",
      title: "Cold stress transcriptomics at single-cell resolution in plants.pdf",
    },
    {
      file_id: "bg-16",
      title:
        "Comparative single-cell analysis of abiotic stress signaling pathways.pdf",
    },
    {
      file_id: "bg-17",
      title:
        "Cell-type-specific responses to abiotic stress revealed by single-cell transcriptomics.pdf",
    },
  ],
};
</script>

<style lang="scss" scoped>
.brief-gene-agent-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
}

.chat-header {
  background: #fff;
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;

  .header-content {
    display: flex;
    align-items: center;
    gap: 16px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .back-button {
    flex-shrink: 0;
  }

  .header-text {
    flex: 1;
    text-align: center;

    h1 {
      margin: 0 0 8px 0;
      color: #333;
      font-size: 24px;
    }

    p {
      margin: 0;
      color: #666;
      font-size: 14px;
    }
  }
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  margin: 20px 0px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: var(--el-bg-color);
  box-shadow: 0 0 10px 0 rgb(218, 217, 217);
  border-radius: 10px;
}

.message {
  display: flex;
  margin-bottom: 16px;

  &.user-message {
    justify-content: flex-end;

    .message-content {
      background: #eff6ff;
      color: #333;
      border-radius: 18px 18px 4px 18px;
      max-width: 100%;
    }
  }

  &.ai-message {
    justify-content: flex-start;

    .message-avatar {
      flex-shrink: 0;
      align-self: flex-start;
      margin-right: 8px;
    }

    .message-content {
      background: white;
      color: #333;
      border-radius: 18px 18px 18px 4px;
      max-width: 85%;
      border: 1px solid #e0e0e0;
    }
  }
}

.message-content {
  padding: 12px 16px;
  word-wrap: break-word;

  .message-text {
    line-height: 1.5;

    :deep(h1),
    :deep(h2),
    :deep(h3),
    :deep(h4),
    :deep(h5),
    :deep(h6) {
      margin-top: 0;
      margin-bottom: 12px;
      color: inherit;
    }

    :deep(p) {
      margin-bottom: 12px;
      &:last-child {
        margin-bottom: 0;
      }
    }

    :deep(ul),
    :deep(ol) {
      margin-bottom: 12px;
      padding-left: 20px;
    }

    :deep(li) {
      margin-bottom: 4px;
    }

    :deep(strong) {
      font-weight: 600;
    }

    :deep(code) {
      background: rgba(0, 0, 0, 0.1);
      padding: 2px 4px;
      border-radius: 3px;
      font-family: "Courier New", monospace;
    }

    :deep(pre) {
      background: rgba(0, 0, 0, 0.05);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin-bottom: 12px;
    }
  }
}

.tip-text {
  font-size: 12px;
  color: #909399;
  margin-top: 10px;
  width: 100%;
  text-align: right;
}
</style>
