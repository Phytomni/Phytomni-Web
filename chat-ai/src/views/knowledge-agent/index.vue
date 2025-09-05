<template>
  <div class="knowledge-agent-container">
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
          <h1>{{ $t('agents.knowledge.title') }}</h1>
          <p>{{ $t('agents.knowledge.subtitle') }}</p>
        </div>
      </div>
    </div>
    
    <div class="chat-messages">
      <!-- 用户提问 -->
      <div class="message user-message">
        <div class="message-content">
          <div class="message-text">How do epigenetic modifications, such as DNA methylation and histone modifications, regulate adaptive responses to drought stress in crops?</div>
        </div>
      </div>
      
      <!-- AI回答 -->
      <div class="message ai-message">
        <div class="message-avatar">
          <el-avatar :size="36" :src="botAvatar" />
        </div>
        <div class="message-content">
          <div class="message-text">
            <MarkdownViewer :content="knowledgeAgentResponse" :instantMessage="true"/>
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

const knowledgeAgentResponse = `Epigenetic modifications, including DNA methylation and histone modifications, play crucial roles in regulating adaptive responses to drought stress in crops by altering gene expression and chromatin structure, thereby enabling plants to better cope with water deficit conditions. Here's a detailed look at how these modifications contribute to drought stress responses:

### DNA Methylation
1. **Gene Expression Regulation**: DNA methylation involves the addition of methyl groups to the cytosine residues in DNA, which can either activate or silence genes depending on the context. This modification is crucial for regulating genes involved in drought stress responses. For example, in rice, hypo-methylation has been associated with the upregulation of stress-responsive genes, enhancing drought tolerance [1]. Conversely, hyper-methylation can lead to gene silencing, potentially reducing the plant's ability to respond to drought [2].

2. **Stress Memory**: DNA methylation contributes to the phenomenon of stress memory, where plants remember past stress events and respond more efficiently to subsequent exposures. This memory is often mediated by changes in methylation patterns that persist even after the stress is alleviated, allowing for quicker and more robust responses to recurring drought [3][4]. For instance, in the resurrection plant Boea hygrometrica, DNA methylation-mediated modulation allows for rapid desiccation tolerance acquisition and dehydration stress memory [3].

3. **Epigenetic Inheritance**: Some DNA methylation changes can be mitotically or meiotically inherited, providing a mechanism for transgenerational stress memory. This means that plants can pass on the memory of drought stress to their offspring, enhancing their ability to cope with future stress events [5][6].

4. **Hormonal Interactions**: DNA methylation interacts with hormonal pathways, such as abscisic acid (ABA) signaling, which is vital for drought response. Changes in methylation patterns can modulate the expression of ABA-responsive genes, thereby fine-tuning the plant's physiological and morphological adaptations to drought [7][8].

5. **Technological Advances**: Advanced technologies like bisulfite sequencing and CRISPR-Cas9 are being used to study and manipulate DNA methylation patterns, offering new avenues for developing drought-tolerant crops [7][9].

### Histone Modifications
1. **Chromatin Remodeling**: Histone modifications, such as acetylation and methylation, alter the structure of chromatin, making it more or less accessible to transcription machinery. For example, histone acetylation generally promotes gene expression by loosening chromatin structure, while methylation can either activate or repress transcription depending on the specific residues modified [10][11].

2. **Stress-Responsive Gene Activation**: Specific histone marks, such as H3K4me3 (trimethylation of histone H3 at lysine 4), are associated with the activation of stress-responsive genes. These modifications ensure that genes necessary for drought response are readily accessible and can be quickly activated when needed [12].

3. **Histone Variants and Stress Tolerance**: The incorporation of histone variants, such as H2A.Z, can also play a role in stress response by altering chromatin structure and gene expression. These variants are linked to transcriptional activation in response to environmental stimuli, enhancing the plant's ability to cope with drought [11][13].

4. **Dynamic Changes**: Histone modifications are dynamic and can change rapidly in response to stress. For instance, drought stress can induce changes in histone acetylation and methylation patterns, which are crucial for activating or repressing stress-responsive genes [10][13].

5. **Epigenetic Priming**: Similar to DNA methylation, histone modifications can prime plants for future stress events. This priming involves changes in histone marks that persist after the initial stress, allowing for a faster and stronger response upon subsequent exposures [14][15].

### Combined Effects
1. **Interplay Between Modifications**: DNA methylation and histone modifications often work together to regulate gene expression. For example, DNA methylation can recruit histone-modifying enzymes, and vice versa, creating a complex regulatory network that fine-tunes the plant's response to drought stress [16][17].

2. **Breeding Applications**: Understanding these epigenetic mechanisms opens up possibilities for breeding drought-tolerant crops. By manipulating these modifications, breeders can develop varieties that are more resilient to water deficit conditions, ensuring sustainable agriculture and food security [18][19].

3. **Epigenomic Editing**: Technologies like CRISPR-Cas9 can be used to edit the epigenome, allowing for precise modifications of DNA methylation and histone marks. This can lead to the development of crops with enhanced drought tolerance by targeting specific genes involved in stress responses [9][20].

4. **Stress Memory and Adaptation**: Both DNA methylation and histone modifications contribute to the establishment of stress memory, which is crucial for long-term adaptation to changing environmental conditions. This memory enables plants to not only respond to current stress but also prepare for future challenges, enhancing their overall resilience [4][6].

5. **Global Impact**: These epigenetic changes can have a broad impact on plant physiology, affecting processes such as stomatal regulation, water absorption, and metabolic adjustments, all of which are critical for drought tolerance [11][10].

In summary, epigenetic modifications like DNA methylation and histone modifications are integral to how crops adapt to drought stress. They regulate gene expression, contribute to stress memory, and offer potential pathways for breeding more resilient crops. Advances in technology are making it possible to manipulate these modifications, paving the way for sustainable agricultural practices in the face of climate change.

**参考资料:**
1. Molecular Mechanisms and Regulatory Pathways Underlying Drought Stress Response in Rice.pdf
2. Assessment of DNA methylation pattern under drought stress using methylation-sensitive randomly amplified polymorphism analysis in rice.pdf
3. DNA methylation-mediated modulation of rapid desiccation tolerance acquisition and dehydration stress memory in the resurrection plant Boea hygrometrica.pdf
4. Exploration of Epigenetics for Improvement of Drought and Other Stress Resistance in Crops A Review.pdf
5. In Response to Abiotic Stress, DNA Methylation Confers EpiGenetic Changes in Plants.
6. Small DNA Methylation, Big Player in Plant Abiotic Stress Responses and Memory.pdf
7. Epigenetic Modifications of Hormonal Signaling Pathways in Plant Drought Response and Tolerance for Sustainable Food Security.
8. Epigenetic regulation in plant abiotic stress responses.pdf
9. Epigenomics in stress tolerance of plants under the climate change.
10. Histone Acetylation Changes in Plant Response to Drought Stress.
11. Epigenetic regulation of stress responses in plants.pdf
12. Role of Epigenetic Factors in Response to Stress and Establishment of Somatic Memory of Stress Exposure in Plants.pdf
13. Histone Modifications Form Epigenetic Regulatory Networks to Regulate Abiotic Stress Response.pdf
14. Epigenetic regulation of stress responses in plants.pdf
15. Role of Epigenetic Factors in Response to Stress and Establishment of Somatic Memory of Stress Exposure in Plants.pdf
16. Epigenetic regulation of stress responses in plants.pdf
17. Role of Epigenetic Factors in Response to Stress and Establishment of Somatic Memory of Stress Exposure in Plants.pdf
18. Epigenetic regulation of stress responses in plants.pdf
19. Role of Epigenetic Factors in Response to Stress and Establishment of Somatic Memory of Stress Exposure in Plants.pdf
20. Epigenetic regulation of stress responses in plants.pdf`
</script>

<style lang="scss" scoped>
.knowledge-agent-container {
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