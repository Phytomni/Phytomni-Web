<template>
  <div class="deep-genome-agent-container">
    <div class="chat-header">
      <div class="header-content">
        <el-button
          type="primary"
          :icon="ArrowLeft"
          @click="goBack"
          class="back-button">
          {{ $t('common.back') }}
        </el-button>
        <div class="header-text">
          <h1>{{ $t('agents.deepGenome.title') }}</h1>
          <p>{{ $t('agents.deepGenome.subtitle') }}</p>
        </div>
      </div>
    </div>

    <div class="chat-messages">
      <!-- 用户提问 -->
      <div class="message user-message">
        <div class="message-content">
          <div class="message-text">
            [Species Name: rice (Oryza sativa) Gene Names:
            d18h|GA3ox1|OsGA3OX2|OsGA3ox-2|d18-h|GA3OX2|d18-I|d25|dwf15|ga3ox2|d18-dy|OsGA3ox2|d18|d18-k|d18-AD|D18|GA3ox-2]
            Provide a scientifically rigorous and integrated account of the rice
            (Oryza sativa)
            d18h|GA3ox1|OsGA3OX2|OsGA3ox-2|d18-h|GA3OX2|d18-I|d25|dwf15|ga3ox2|d18-dy|OsGA3ox2|d18|d18-k|d18-AD|D18|GA3ox-2
            gene. Consolidate data for all gene aliases (separated by '|') as
            representing identical genetic entities. Maintain strict adherence
            to evidence-based reporting, excluding unsupported assertions.
            Prioritize conciseness while preserving informational density
            comparable to source materials.
          </div>
        </div>
      </div>

      <div class="message ai-message">
        <div class="message-avatar">
          <el-avatar :size="36" :src="botAvatar" />
        </div>
        <div class="message-content">
          <div class="message-text">
            {{ $t('agents.deepGenome.taskCreated') }}:
            4a7715a-996a-22e0-acd5-fb278e7d45b3
            <div class="tip-text">{{ $t('common.Tip') }}</div>
          </div>
        </div>
      </div>

      <!-- AI 回答 -->
      <div class="message ai-message">
        <div class="message-avatar">
          <el-avatar :size="36" :src="botAvatar" />
        </div>
        <div class="message-content">
          <div class="message-text">
            <DeepGenomeResultViewer
              :markdown="deepGenomeAgentResponse.replace(/\n/g, '\\n')"
              :references="docList" />
            <div class="message-fotter">
              <!-- 点赞点踩按钮 -->
              <div class="reaction-buttons">
                <el-tooltip effect="dark" :content="getReactionTooltip(1)" placement="top">
                  <div
                    class="message-fotter-item reaction-btn"
                    :class="{ active: loveThisState === 1 }"
                    @click="handleReaction(1)">
                    <el-icon>
                      <SuccessFilled v-if="loveThisState === 1" />
                      <CircleCheck v-else />
                    </el-icon>
                  </div>
                </el-tooltip>
                <el-tooltip effect="dark" :content="getReactionTooltip(2)" placement="top">
                  <div
                    class="message-fotter-item reaction-btn"
                    :class="{ active: needsImprovementState === 2 }"
                    @click="handleReaction(2)">
                    <el-icon>
                      <CircleCloseFilled v-if="needsImprovementState === 2" />
                      <CircleClose v-else />
                    </el-icon>
                  </div>
                </el-tooltip>
              </div>
            </div>
            <div class="tip-text">{{ $t('common.Tip') }}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="ai-disclaimer">
      {{ $t('common.aiDisclaimer') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  ArrowLeft,
  SuccessFilled,
  CircleCheck,
  CircleCloseFilled,
  CircleClose,
} from '@element-plus/icons-vue';
import DeepGenomeResultViewer from '@/components/DeepGenomeResultViewer.vue';
import { ref } from 'vue';

const { t } = useI18n();

const loveThisState = ref(0);
const needsImprovementState = ref(0);

const router = useRouter();
const goBack = () => {
  router.back();
};

const getReactionTooltip = (reactionType: number) => {
  if (reactionType === 1) return t('chat.loveThis');
  if (reactionType === 2) return t('chat.needsImprovement');
  return '';
};

const handleReaction = (reactionType: number) => {
  if (reactionType === 1) {
    loveThisState.value = loveThisState.value === 1 ? 2 : 1;
  } else if (reactionType === 2) {
    needsImprovementState.value = needsImprovementState.value === 2 ? 1 : 2;
  }
};

const botAvatar = '/logo.png';

// DeepGenomeResultViewer 的 references 列表(demo 数据,与 docList 中的 file_id
// / au / ti 字段对齐 viewer 期望的 schema)
const docList = [
  {
    file_id: '65c0d139-67b8-4dab-bb4a-b8e9b57dd990',
    title:
      'The rice YABBY1 gene is involved in the feedback regulation of gibberellin metabolism.',
  },
  {
    file_id: 'ab4dc877-173d-44f1-bacc-4754905b9eff',
    title: 'Gibberellin 2-oxidase genes and uses thereof',
  },
  {
    file_id: 'caa4f546-7c2a-4eda-b4d9-c0959bb78df5',
    title:
      'Expression of novel rice gibberellin 2-oxidase gene is under homeostatic regulation by biologically active gibberellins.',
  },
  {
    file_id: '55576eed0d07b52b177bd97fc3137f54',
    au: 'Murai, M. et al',
    ti: 'Pleiotropic effect of the dwarfing gene <i>d18-k</i> on cool tolerance at booting stage under the genetic background of an extremely cool-tolerant line Norin-PL8 in rice',
    so: 'PLANT BREEDING',
    vl: '122',
    bp: '410',
    ep: '415',
    py: '2003',
    di: '10.1046/j.1439-0523.2003.00843.x',
    dl: 'http://dx.doi.org/10.1046/j.1439-0523.2003.00843.x',
    pm: null,
  },
  {
    file_id: '864553cb384fcacf7ee3022e925b48aa',
    title:
      'Expression of a gibberellin 2-oxidase gene around the shoot apex is related to phase transition in rice',
  },
  {
    file_id: 'a1e87ceb902eb1ba6d354f6f56000412',
    au: '',
    ti: 'A common allosteric mechanism regulates homeostatic inactivation of auxin and gibberellin',
    so: 'NATURE COMMUNICATIONS',
    vl: '11',
    bp: null,
    ep: null,
    py: '2020',
    di: '10.1038/s41467-020-16068-0',
    dl: '',
    pm: '32358569',
  },
  {
    file_id: '58c87600aba5cd7c98b593364309efde',
    title: '00002HUHLL7G7JP0MPDO7JP1M9R',
  },
  {
    file_id: 'b03f9244cff2a831005a9c4ff554e94d',
    au: 'Shukla, N. et al',
    ti: 'Biochemical and physiological responses of rice (<i>Oryza sativa</i> L.) as influenced by <i>Trichoderma harzianum</i> under drought stress',
    so: 'PLANT PHYSIOLOGY AND BIOCHEMISTRY',
    vl: '54',
    bp: '78',
    ep: '88',
    py: '2012',
    di: '10.1016/j.plaphy.2012.02.001',
    dl: 'http://dx.doi.org/10.1016/j.plaphy.2012.02.001',
    pm: '22391125',
  },
  {
    file_id: '86993031b31b229d51a72728b199de5e',
    title:
      'Hd18, Encoding Histone Acetylase Related to Arabidopsis FLOWERING LOCUS D, is Involved in the Control of Flowering Time in Rice',
  },
  {
    file_id: 'a172a9f9-d949-41a0-805e-58061eee3a88',
    title:
      'Oryza sativa mediator subunit OsMED25 interacts with OsBZR1 to regulate brassinosteroid signaling and plant architecture in rice.',
  },
];

// Deep Genome Agent demo response(verbatim 来源于 frontend 仓库,保留
// [1][2] 引用格式与 docList 对齐)
const deepGenomeAgentResponse = `
# Deep Genome Analysis of Os01g0177400

GA3ox-2|D18|GA3OX2|dwf15|OsGA3ox-2|d18h|GA3ox1|d18-k|d18-I|ga3ox2|d18|OsGA3ox2|d18-h|OsGA3OX2|d18-dy|d18-AD|d25|Os01g0177400 in rice (Oryza sativa) encodes a gibberellin 3-beta-hydroxylase, a crucial enzyme in the biosynthesis of gibberellins, which are plant hormones essential for growth regulation. This gene converts GA20 and GA9 to the bioactive forms GA1 and GA4, playing a pivotal role in the final step of gibberellin biosynthesis. The discovery of this gene has been instrumental in understanding plant hormone regulation and its impact on plant stature, particularly in the context of the Green Revolution where semi-dwarf varieties were developed to improve yield by reducing lodging [1][2][3].

Genetic mapping has localized GA3ox-2/D18 to chromosome 1, associating it with dwarfism and gibberellin biosynthesis pathways. The gene's alleles show significant pleiotropic effects on plant height, cool tolerance, and stress responses, making it a major contributor to these phenotypic traits [4][2]. Its cloning through map-based techniques has further elucidated its role in gibberellin biosynthesis and regulation, revealing a structure with three exons and two introns, encoding a protein with conserved domains typical of 2-oxoglutarate-dependent dioxygenases, crucial for enzymatic activity [1][5].

Functional analysis indicates that GA3ox-2/D18 is expressed in various tissues, including leaves, flowers, and seeds, with expression levels influenced by developmental stages and environmental conditions. Mutants of this gene exhibit dwarfism and altered gibberellin levels, underscoring its critical role in plant growth regulation. The gene's activity is modulated by feedback mechanisms involving gibberellin levels, ensuring hormonal homeostasis [3][6]. Its manipulation has been pivotal in developing semi-dwarf rice varieties, enhancing yield and stress tolerance, and its role in gibberellin regulation makes it a key target in rice breeding programs for improved productivity and resilience [1][2].

## Gene Profiles

### 1. Gene Discovery, Family, and Localization

#### 1.1. Discovery History and Nomenclature

The gene aliases GA3ox-2, D18, GA3OX2, dwf15, OsGA3ox-2, d18h, GA3ox1, d18-k, d18-I, ga3ox2, d18, OsGA3ox2, d18-h, OsGA3OX2, d18-dy, d18-AD, d25, and Os01g0177400 collectively refer to the gibberellin 3-beta-hydroxylase gene in rice (Oryza sativa), which plays a crucial role in the biosynthesis of gibberellins, a class of plant hormones essential for growth regulation. The gene was initially identified due to its involvement in the final step of gibberellin biosynthesis, converting GA20 and GA9 to the bioactive forms GA1 and GA4, respectively. The discovery of this gene has been pivotal in understanding plant hormone regulation and its impact on plant stature, particularly in the context of the Green Revolution where semi-dwarf varieties were developed to improve yield by reducing lodging [1][2][3].

#### 1.2. Genetic Mapping

The gene is located on chromosome 1 of the rice genome. Genetic mapping studies have localized this gene to a region associated with dwarfism and gibberellin biosynthesis pathways. Quantitative Trait Loci (QTL) mapping has identified this gene as a major contributor to plant height and growth regulation, with its alleles showing significant pleiotropic effects on various phenotypic traits, including cool tolerance and stress responses [4][2].

### 2. Gene Cloning and Structural Analysis

#### 2.1. Cloning Information

The cloning of GA3ox-2/D18 was achieved through map-based cloning techniques, involving the isolation of genomic DNA and subsequent sequencing to identify the gene responsible for the dwarf phenotype in rice varieties. This process has been instrumental in understanding the genetic basis of gibberellin biosynthesis and its regulation [1][3].

#### 2.2. Structural Characteristics

GA3ox-2/D18 consists of three exons and two introns, with the coding sequence encoding a protein with conserved domains typical of 2-oxoglutarate-dependent dioxygenases. The structural features include a non-haem dioxygenase N-terminal domain and an isopenicillin N synthase-like Fe(2+) 2OG dioxygenase domain, crucial for its enzymatic activity [1][5].

#### 2.3. Protein Stability or Enzyme Activity Analysis

The enzyme activity of GA3ox-2/D18 is influenced by various conditions, including the presence of gibberellins and environmental factors. The protein's stability and activity are regulated through feedback mechanisms involving gibberellin levels, with increased GA levels leading to decreased enzyme activity, maintaining hormonal homeostasis [3][6].

### 3. Functional Analysis

#### 3.1. Expression Patterns

GA3ox-2/D18 is expressed in various tissues, including leaves, flowers, and seeds, with its expression levels influenced by developmental stages and environmental conditions. The gene's expression is upregulated in response to gibberellin application, indicating its role in gibberellin homeostasis [3][5].

#### 3.2. Phenotypic Characteristics and Biological Functions

Mutants of GA3ox-2/D18 exhibit dwarfism, reduced plant height, and altered gibberellin levels, demonstrating the gene's critical role in plant growth regulation. These mutants have been used to develop semi-dwarf rice varieties that are less prone to lodging, contributing to higher grain yields [4][1][2].

#### 3.3. The Underlying Mechanism, Pathways, and Networks

GA3ox-2/D18 functions in the gibberellin biosynthesis pathway, converting precursors to active gibberellins. It interacts with other genes in the pathway, such as GA20ox and GA2ox, to regulate gibberellin levels and plant growth. The gene's activity is modulated by feedback mechanisms involving gibberellin levels, ensuring proper growth regulation [1][6].

#### 3.4. QTL Interactions

The gene is linked to QTLs associated with plant height and stress responses, indicating its role in multiple physiological pathways. Its interaction with other QTLs suggests a complex regulatory network involving gibberellin biosynthesis and response to environmental stimuli [4][2].

### 4. Application and Evolutionary Analysis

#### 4.1. Domestication Studies

GA3ox-2/D18 has been a target in rice breeding programs for developing semi-dwarf varieties, which have significantly contributed to increased yields and reduced lodging. Its role in gibberellin regulation makes it a key gene in rice domestication and improvement [1][2].

#### 4.2. Genetic Diversity

Natural variations in the GA3ox-2/D18 gene, including SNPs and alleles, contribute to the diversity in plant height and stress responses among rice varieties. These variations have been exploited in breeding programs to enhance yield and adaptability to different environments [4][2].

#### 4.3. Improvement

The gene's manipulation has led to the development of rice varieties with improved growth characteristics, including enhanced yield and stress tolerance. Its role in gibberellin regulation makes it a valuable target for genetic engineering and breeding strategies aimed at improving rice productivity and resilience [1][2].

**Table: Key Mutations in the GA3ox-2/D18 Gene and Their Phenotypic Effects**

|Allele |Background Cultivar |Phenotypic Effect |Molecular Basis |Reference(s) |
|---|---|---|---|---|
|d18-AD |Akibare |Severe dwarfism (~15 cm), GA-responsive |7-kbp deletion encompassing the entire gene; no PCR product detectable |[7] |
|d18-dy |Waito-C |Milder dwarfism |In-frame 9-base deletion in exon 1 (positions 181–189) |[7][8] |
|d18-h |Nosetsu-waisei |Severe dwarfism, complete loss of enzyme activity |Single base deletion at position 750, causing a frameshift and premature stop |[8] |
|d18-k |Kotaketamanishiki |Dwarfism, associated with cool tolerance |Not fully characterized at the molecular level |[1] |

This comprehensive overview of the GA3ox-2/D18 gene in rice highlights its significance in plant growth regulation, its application in breeding programs, and its role in gibberellin biosynthesis and homeostasis. The gene's manipulation has led to significant advancements in rice agriculture, demonstrating the importance of understanding gene function and regulation in crop improvement.

## Bioinformatic Analysis and Molecular Design

### 1. Phylogenetic Analysis

To elucidate the evolutionary relationships among the identified protein homologs, a phylogenetic analysis was conducted. The resulting circular phylogram reveals the clustering of the sequences into several distinct monophyletic clades, with varying degrees of statistical support for the internal nodes.

The analysis robustly resolved multiple subclades with high confidence values. For instance, a major clade encompassing sequences from \`NP_001266453.1\` to \`OEL23979.1\` was recovered. Within this group, several sister-pair relationships were strongly supported, such as \`XP_039813942.1\` and \`XP_039813941.1\` (node support: 0.999), and \`NP_001266453.1\` and \`PWZ31809.1\` (node support: 0.993). Another well-defined clade includes sequences \`BAB62154.1\` through \`KAG8045865.1\`.

### 2. Transcriptomic Profiling

#### 2.1. Expression Profile in Different Tissues

To characterize the expression profile across different developmental stages and tissues, we analyzed transcript abundance, measured in Fragments Per Kilobase of transcript per Million mapped reads (FPKM). The analysis revealed a distinct tissue-specific expression pattern. The highest expression levels were observed in flower tissues, exhibiting a mean FPKM of 23.55 (SD = 20.37). Panicle tissues also demonstrated substantial expression, with the second-highest mean FPKM of 18.86 (SD = 18.72). Conversely, the lowest expression was detected in the meristem, with a mean FPKM of only 2.45 (SD = 3.19).

#### 2.2. Expression Profile across Different Cultivars

The expression levels of the analyzed genes, measured in Fragments Per Kilobase of transcript per Million mapped reads (FPKM), showed notable variation across the five rice varieties. The Ir29 variety exhibited the highest average expression level with a mean FPKM of 14.04 ± 6.52. In contrast, the Dongjin and Nipponbare varieties displayed the lowest expression, with mean FPKM values of 6.33 ± 7.86 and 6.75 ± 9.52, respectively.

#### 2.3. Expression Profile under Different kinds of Stresses

Analysis of transcript abundance, quantified as Fragments Per Kilobase of transcript per Million mapped reads (FPKM), revealed differential expression across eight experimental conditions. A substantial increase in transcript levels was observed in all treatments combining varied water and nitrogen availability. Specifically, the highest mean expression was recorded under high water and low nitrogen conditions (mean FPKM = 65.47 ± 40.70), followed by the high water and high nitrogen group (mean FPKM = 56.93 ± 38.77).

### 3. Protein Characterization

#### 3.1. Domain Architecture

A bioinformatic analysis was performed to identify conserved domains within the protein sequence of Os01t0177400-01. The search revealed the presence of two significant domains. A highly significant match was found to the 2OG-Fe(II) oxygenase superfamily domain (2OG-FeII_Oxy; PF03171.25) with an E-value of 3.4e-27. Furthermore, the N-terminal region of the protein showed significant homology to the DIOX_N domain (PF14226.11), characteristic of non-haem dioxygenases, with an E-value of 3.1e-15.

## Conclusion

GA3ox-2/D18 in rice (Oryza sativa) is pivotal in the biosynthesis of gibberellins, essential plant hormones regulating growth. This gene encodes a gibberellin 3-beta-hydroxylase, which catalyzes the conversion of GA20 and GA9 to the bioactive forms GA1 and GA4, playing a crucial role in the final step of gibberellin biosynthesis [1][2][3]. The discovery of GA3ox-2/D18 has been instrumental in understanding plant hormone regulation, particularly in the context of the Green Revolution, where semi-dwarf varieties were developed to improve yield by reducing lodging [1][2][3].

Future research should focus on resolving mechanistic uncertainties and exploring the gene's regulatory networks. Detailed studies on the interaction of GA3ox-2/D18 with other genes in the gibberellin pathway, such as GA20ox and GA2ox, will provide deeper insights into its regulatory mechanisms [1][6]. Additionally, investigating the gene's response to various environmental stresses and its role in different developmental stages will enhance our understanding of its pleiotropic effects [4][2].
`;
</script>

<style lang="scss" scoped>
.deep-genome-agent-container {
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
  margin: 20px 0px 52px 0px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: var(--el-bg-color);
  box-shadow: 0 0 10px 0 rgb(218, 217, 217);
  border-radius: 10px 10px 0 0;
}

.message {
  display: flex;
  margin-bottom: 16px;

  &.user-message {
    justify-content: flex-end;

    .message-content {
      background: #409eff;
      color: #ffffff;
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
      max-width: 99%;
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
      color: #000;
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
      font-family: 'Courier New', monospace;
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

.ai-disclaimer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color);
  padding: 12px 20px;
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  z-index: 1000;
}

.theme-dark {
  .deep-genome-agent-container {
    background-color: var(--color-background);
  }

  .chat-header {
    background: var(--color-background-card);
    border-bottom: 1px solid var(--el-border-color);

    h1 {
      color: var(--el-text-color-primary);
    }

    p {
      color: var(--el-text-color-secondary);
    }
  }

  .chat-messages {
    background: var(--color-background-card);
    box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.3);
  }

  .message {
    &.ai-message .message-content {
      background: var(--color-background);
      color: var(--el-text-color-primary);
      border: 1px solid var(--color-border);
    }
  }

  :deep(code) {
    background: rgba(255, 255, 255, 0.1);
  }

  :deep(pre) {
    background: rgba(255, 255, 255, 0.05);
  }

  .ai-disclaimer {
    background: var(--color-background);
    border-top: 1px solid var(--el-border-color);
    color: var(--el-text-color-secondary);
  }
}

.message-fotter {
  width: 100%;
  height: auto;
  display: flex;
  gap: 10px;
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  margin-top: 5px;

  &-item {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 22px;
    height: 22px;
    padding: 2px;
    box-sizing: border-box;
    border-radius: 4px;
    cursor: pointer;
  }

  &-item:hover {
    color: #1890ff;
    background: #e8e6e6;
  }

  .reaction-buttons {
    display: flex;
  }
}
</style>
