<template>
  <div class="deep-genome-agent-container">
    <div class="chat-header">
      <div class="header-content">
        <el-button 
          type="primary" 
          :icon="ArrowLeft" 
          @click="goBack"
          class="back-button">
          返回
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
          <div class="message-text">[Species Name: rice (Oryza sativa)
Gene Names: d18h|GA3ox1|OsGA3OX2|OsGA3ox-2|d18-h|GA3OX2|d18-I|d25|dwf15|ga3ox2|d18-dy|OsGA3ox2|d18|d18-k|d18-AD|D18|GA3ox-2]

Provide a scientifically rigorous and integrated account of the rice (Oryza sativa) d18h|GA3ox1|OsGA3OX2|OsGA3ox-2|d18-h|GA3OX2|d18-I|d25|dwf15|ga3ox2|d18-dy|OsGA3ox2|d18|d18-k|d18-AD|D18|GA3ox-2 gene. Consolidate data for all gene aliases (separated by '|') as representing identical genetic entities. Maintain strict adherence to evidence-based reporting, excluding unsupported assertions. Prioritize conciseness while preserving informational density comparable to source materials.</div>
        </div>
      </div>
      
      <!-- AI回答 -->
      <div class="message ai-message">
        <div class="message-avatar">
          <el-avatar :size="36" :src="botAvatar" />
        </div>
        <div class="message-content">
          <div class="message-text">
            <MarkdownViewer :content="deepGenomeAgentResponse" :instantMessage="true"/>
            <div class="tip-text">{{ $t('common.Tip') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import MarkdownViewer from '@/components/MarkdownViewer.vue'

const router = useRouter()
const goBack = () => {
  router.back()
}

const botAvatar = 'https://cube.elemecdn.com/9/3c/436fe7666b465e0e69e553e5f5a071png.png'

const deepGenomeAgentResponse = `# Deep Genome Analysis of Os01g0177400

GA3ox-2|D18|GA3OX2|dwf15|OsGA3ox-2|d18h|GA3ox1|d18-k|d18-I|ga3ox2|d18|OsGA3ox2|d18-h|OsGA3OX2|d18-dy|d18-AD|d25|Os01g0177400 in rice (Oryza sativa) encodes a gibberellin 3-beta-hydroxylase, a crucial enzyme in the biosynthesis of gibberellins, which are plant hormones essential for growth regulation. This gene converts GA20 and GA9 to the bioactive forms GA1 and GA4, playing a pivotal role in the final step of gibberellin biosynthesis. The discovery of this gene has been instrumental in understanding plant hormone regulation and its impact on plant stature, particularly in the context of the Green Revolution where semi-dwarf varieties were developed to improve yield by reducing lodging [document:5][document:14][document:18].

Genetic mapping has localized GA3ox-2/D18 to chromosome 1, associating it with dwarfism and gibberellin biosynthesis pathways. The gene's alleles show significant pleiotropic effects on plant height, cool tolerance, and stress responses, making it a major contributor to these phenotypic traits [document:1][document:14]. Its cloning through map-based techniques has further elucidated its role in gibberellin biosynthesis and regulation, revealing a structure with three exons and two introns, encoding a protein with conserved domains typical of 2-oxoglutarate-dependent dioxygenases, crucial for enzymatic activity [document:5][document:39].

Functional analysis indicates that GA3ox-2/D18 is expressed in various tissues, including leaves, flowers, and seeds, with expression levels influenced by developmental stages and environmental conditions. Mutants of this gene exhibit dwarfism and altered gibberellin levels, underscoring its critical role in plant growth regulation. The gene's activity is modulated by feedback mechanisms involving gibberellin levels, ensuring hormonal homeostasis [document:18][document:72]. Its manipulation has been pivotal in developing semi-dwarf rice varieties, enhancing yield and stress tolerance, and its role in gibberellin regulation makes it a key target in rice breeding programs for improved productivity and resilience [document:5][document:14].

## Gene Profiles

### 1. Gene Discovery, Family, and Localization

#### 1.1. Discovery History and Nomenclature

The gene aliases GA3ox-2, D18, GA3OX2, dwf15, OsGA3ox-2, d18h, GA3ox1, d18-k, d18-I, ga3ox2, d18, OsGA3ox2, d18-h, OsGA3OX2, d18-dy, d18-AD, d25, and Os01g0177400 collectively refer to the gibberellin 3-beta-hydroxylase gene in rice (Oryza sativa), which plays a crucial role in the biosynthesis of gibberellins, a class of plant hormones essential for growth regulation. The gene was initially identified due to its involvement in the final step of gibberellin biosynthesis, converting GA20 and GA9 to the bioactive forms GA1 and GA4, respectively. The discovery of this gene has been pivotal in understanding plant hormone regulation and its impact on plant stature, particularly in the context of the Green Revolution where semi-dwarf varieties were developed to improve yield by reducing lodging [document:5][document:14][document:18].

#### 1.2. Genetic Mapping

The gene is located on chromosome 1 of the rice genome. Genetic mapping studies have localized this gene to a region associated with dwarfism and gibberellin biosynthesis pathways. Quantitative Trait Loci (QTL) mapping has identified this gene as a major contributor to plant height and growth regulation, with its alleles showing significant pleiotropic effects on various phenotypic traits, including cool tolerance and stress responses [document:1][document:14].

### 2. Gene Cloning and Structural Analysis

#### 2.1. Cloning Information

The cloning of GA3ox-2/D18 was achieved through map-based cloning techniques, involving the isolation of genomic DNA and subsequent sequencing to identify the gene responsible for the dwarf phenotype in rice varieties. This process has been instrumental in understanding the genetic basis of gibberellin biosynthesis and its regulation [document:5][document:18].

#### 2.2. Structural Characteristics

GA3ox-2/D18 consists of three exons and two introns, with the coding sequence encoding a protein with conserved domains typical of 2-oxoglutarate-dependent dioxygenases. The structural features include a non-haem dioxygenase N-terminal domain and an isopenicillin N synthase-like Fe(2+) 2OG dioxygenase domain, crucial for its enzymatic activity [document:5][document:39].

#### 2.3. Protein Stability or Enzyme Activity Analysis

The enzyme activity of GA3ox-2/D18 is influenced by various conditions, including the presence of gibberellins and environmental factors. The protein's stability and activity are regulated through feedback mechanisms involving gibberellin levels, with increased GA levels leading to decreased enzyme activity, maintaining hormonal homeostasis [document:18][document:72].

### 3. Functional Analysis

#### 3.1. Expression Patterns

GA3ox-2/D18 is expressed in various tissues, including leaves, flowers, and seeds, with its expression levels influenced by developmental stages and environmental conditions. The gene's expression is upregulated in response to gibberellin application, indicating its role in gibberellin homeostasis [document:18][document:39].

#### 3.2. Phenotypic Characteristics and Biological Functions

Mutants of GA3ox-2/D18 exhibit dwarfism, reduced plant height, and altered gibberellin levels, demonstrating the gene's critical role in plant growth regulation. These mutants have been used to develop semi-dwarf rice varieties that are less prone to lodging, contributing to higher grain yields [document:1][document:5][document:14].

#### 3.3. The Underlying Mechanism, Pathways, and Networks

GA3ox-2/D18 functions in the gibberellin biosynthesis pathway, converting precursors to active gibberellins. It interacts with other genes in the pathway, such as GA20ox and GA2ox, to regulate gibberellin levels and plant growth. The gene's activity is modulated by feedback mechanisms involving gibberellin levels, ensuring proper growth regulation [document:5][document:72].

#### 3.4. QTL Interactions

The gene's involvement in QTL interactions has been extensively studied, particularly in relation to plant height and stress tolerance. QTL mapping studies have identified GA3ox-2/D18 as a major contributor to plant height variation, with its alleles showing significant effects on various agronomic traits [document:1][document:14].`
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
    
    :deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
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
    
    :deep(ul), :deep(ol) {
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
</style>