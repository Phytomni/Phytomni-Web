<template>
  <div class="help-page">
    <div class="help-container">
      <!-- 页面头部 -->
      <div class="help-header">
        <div class="header-content">
          <h1 class="help-title">{{ $t('help.title') }}</h1>
        </div>
        <div class="header-actions">
          <button class="back-btn" @click="goBack">
            <i class="icon-arrow-left"></i>
            {{ $t('common.back') }}
          </button>
        </div>
      </div>

      <!-- 帮助内容 -->
      <div class="help-content">
        <div class="content-layout">
          <!-- 侧边栏目录 -->
          <div class="toc-sidebar">
            <div class="toc-title">{{ $t('help.tableOfContents') }}</div>
            <nav class="toc-nav">
              <ul class="toc-list">
                <li 
                  v-for="item in tableOfContents" 
                  :key="item.id"
                  class="toc-item"
                  :class="{ 'active': activeSection === item.id }"
                  @click="scrollToSection(item.id)"
                >
                  <span class="toc-link">{{ item.title }}</span>
                </li>
                </ul>
            </nav>
          </div>
          
          <!-- 主内容区域 -->
          <div class="main-content" ref="mainContentRef">
            <MarkdownViewer :content="helpContent" />
                  </div>
                </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import MarkdownViewer from '@/components/MarkdownViewer.vue'
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { getToken } from '@/utils/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const { t } = useI18n()

// 返回上一页
const goBack = () => {
  try {
    // 检查token是否存在
    if (!getToken()) {
      ElMessage.warning(t('help.goBackTokenExpired'))
      router.replace('/login')
      return
    }
    // 尝试返回上一页
    router.back()
  } catch (error) {
    // 处理路由返回异常
    console.error('返回上一页失败:', error)
    ElMessage.error(t('help.goBackFailed'))
    // 如果返回失败，导航到默认页面
    router.push('/')
  }
}

// 目录数据结构
const tableOfContents = ref([
  { id: 'what-is-phytomni', title: 'What is Phytomni?', level: 1 },
  { id: 'getting-started', title: 'Getting Started', level: 1 },
  { id: 'how-it-works', title: 'How does Phytomni work?', level: 1 },
  { id: 'resources', title: 'What resources does Phytomni integrate?', level: 1 },
  { id: 'limitations', title: 'Limitations and Best Practices', level: 1 }
])

// 当前激活的目录项
const activeSection = ref('what-is-phytomni')

// 获取主内容区域元素
const mainContentRef = ref<HTMLElement | null>(null)

// 点击目录项跳转
const scrollToSection = (sectionId: string) => {
  const element = document.getElementById(sectionId)
  if (element && mainContentRef.value) {
    // 计算元素在主内容区域内的相对位置
    const elementTop = element.offsetTop - 20 // 添加20px的上边距，避免标题被遮挡
    // 滚动到指定位置
    mainContentRef.value.scrollTo({
      top: elementTop,
      behavior: 'smooth'
    })
    activeSection.value = sectionId
  }
}

// 监听滚动，更新当前激活的章节
const handleScroll = () => {
  if (!mainContentRef.value) return

  const sections = tableOfContents.value.map(item => item.id)
  const scrollPosition = mainContentRef.value.scrollTop + 100 // 使用main-content的滚动位置

  for (let i = sections.length - 1; i >= 0; i--) {
    const element = document.getElementById(sections[i])
    if (element && element.offsetTop <= scrollPosition) {
      activeSection.value = sections[i]
      break
    }
  }
}

onMounted(() => {
  // 绑定到main-content的滚动事件
  if (mainContentRef.value) {
    mainContentRef.value.addEventListener('scroll', handleScroll)
  }
  // 初始化时检查当前激活的章节
  handleScroll()
})

onUnmounted(() => {
  // 解绑滚动事件
  if (mainContentRef.value) {
    mainContentRef.value.removeEventListener('scroll', handleScroll)
  }
})

// Markdown内容
const helpContent = `<div id="what-is-phytomni"># 1. What is Phytomni?</div>

Phytomni is an intelligent agentic AI system for scientific discovery and design in plant research, which can assist researchers to significantly accelerate scientific discovery, including:

-   Answering diverse scientific questions directly with natural language queries;
-   Unlocking insights from over 4 million full-text scientific articles, extracting reliable insights, and providing direct answers with source references;
-   Integrating and analyzing 14 types of omics datasets covering 65 plant species to generate precise digital insights;
-   Accepting user-submitted data and task requirements, and autonomously planning and executing bioinformatics analyses;

Building upon these core capabilities, Phytomni can perform complex research tasks, including but not limited to:

-   Automated integration of literature and generation of domain review reports;
-   Integrating multi-dimensional information to analyze gene function and write professional reports;
-   Automating key steps in the reproduction of published scientific studies;
-   Discovering new biological pathways (such as hormone-gene-phenotype network analysis);
-   Designing and optimizing alleles and proteins (including gene promoters and protein engineering);
-   **... ...**

<div id="getting-started"># 2. Getting Started: How to Use Phytomni</div>

Using Phytomni is a conversational, task-oriented process. Follow these simple steps to begin your research:

### Step 1: Formulate and Submit Your Query

To start using Phytomni, the first step is to clearly formulate your research query. You need to select the corresponding **AGENT** button and describe your specific objectives as precisely as possible—whether they involve literature retrieval, data extraction, or analytical tasks. Clear and detailed instructions will ensure that Phytomni accurately captures your research needs and delivers high-quality results.

### Step 2: Monitor and Manage Your Task

After submitting your query, you can monitor its progress in real time through the **Task Management** module. This module provides an overview of your submitted tasks, including the original problem, task status, and the most recent update time.

### Step 3: Review and Explore Results

Once the task is completed, you will be able to review the results directly in the system. For example, when exploring specific genes, the Gene Display module offers a comprehensive, integrated view of the target gene, including basic information, literature summaries, interaction networks, and expression heatmaps. You can download your results for further use or export them into different formats. To facilitate long-term research, completed tasks can also be saved as favourites, allowing you to easily revisit and reuse them whenever needed.

<div id="how-it-works"># 3. How does Phytomni work? Understanding the Architecture and Capabilities</div>

### The Dual-LLM Core

The **Phytomni-Hub** module serves as the central intelligence for the entire system. This module integrates two domain-specific LLMs—**Phyto-Chatbot** and **Phyto-Reasoner**—both of which were pre-trained on knowledge from Phytomni's resource modules and fine-tuned with high-quality data. **Phyto-Chatbot** is capable of intent recognition and initiating data searches, while **Phyto-Reasoner** is responsible for reasoning, planning, and knowledge synthesis. The two work synergistically to support automated bioinformatic operations.

### A Team of AI Agents and Their Applications

Phytomni accomplishes tasks by orchestrating a team of specialized agents. Here's what each agent does and how you can use them:

-   The **Chat Agent** is your primary conversational interface with Phytomni. It answers various research questions in natural language, explains complex biological concepts, and provides guidance on experimental design or data analysis. This agent enables researchers to quickly gain actionable insights without having to manually navigate multiple databases.

-   The **Knowledge Agent** is built on a century-spanning agricultural knowledge base, integrating over 4 million full-text articles, 27 million abstracts, and nearly 200,000 structured patents. It supports natural language queries to retrieve and extract full-text information, generating evidence-based answers with complete source references—turning fragmented plant research into an accessible, authoritative discovery foundation.

-   The **Data Agent** is powered by a multi-omics database covering 65 plant species and 14 omics data types. It unifies 21 identifier types, corrects errors, removes redundancies, and standardizes entries. It intelligently translates your natural language query into a precise database query (SQL) to extract, cross-link, and visualize gene-centric or system-level biological data, enabling seamless exploration of plant genomes, expression profiles, and protein interactions.

-   The **Analyst Agent** functions like an automated bioinformatician, integrating a library of over 120 curated bioinformatics tools. It plans and executes complex tasks (such as sequence analysis or gene expression profiling) and embeds expert-validated pipelines into a user-friendly interface, enabling end-to-end multi-omics analyses without manual software installation or configuration.

-   The **Review Agent** automatically generates comprehensive literature reviews on targeted research topics. It interprets user queries to build a review plan, uses the Knowledge Agent to collect multimodal evidence via iterative searches, and leverages its reasoning capabilities to organize the information into citation-backed reports. It saves weeks of manual curation and provides a ready-to-use foundation for proposals, publications, or experimental design.

-   The ***In Silico* Research Agent facilitates the automated replication** of published studies by coordinating other agents. It can also generate a \`reproduce.sh\` script for one-command workflow re-execution from a clean environment, ensuring scientific reproducibility. Beyond replication, it supports exploratory analysis—researchers can modify datasets, parameters, or species to validate findings or explore new hypotheses, serving as both a replication engine and a hypothesis-testing platform.

-   The **Gene Network Agent** accepts user-defined gene lists to identify interaction partners, regulatory relationships, and functional associations. It synthesizes this information into coherent networks (e.g., hormone–gene–phenotype maps), enabling on-demand candidate gene network construction to help uncover biological pathways and link molecular interactions to phenotypes.

-   The **Deep Genome Agent** generates in-depth functional summaries for target genes by integrating literature, multi-omics data, and network information. Its final output is a gene-focused review report covering gene function, regulation, known variants, and potential breeding applications—serving as a one-stop reference for researchers.

-   The **Digital Design Agent** leverages the other agents for allele and protein engineering. Via natural language queries, it supports protein sequence modification and gene promoter optimization, predicts beneficial mutations, and generates protein variants with enhanced traits. It bridges computational design and experimental validation to accelerate synthetic biology, functional genomics, and crop improvement.

<div id="resources"># 4. What resources does Phytomni integrate?</div>

-   A **Knowledge Base** comprising over 4 million full-text agriculture and plant biology research papers published from 1900-2025, along with over 27 million abstracts and nearly 200,000 patents.
-   A **Biological Database** covering 65 plant species (including rice, maize, wheat, soybean, *Arabidopsis*, etc.) and 14 omics methods (e.g., genomics, transcriptomics, epigenomics, phenomics, etc.).
-   A **Bioinformatics Toolkit** containing 125 total bioinformatic tools, including 25 models and 100 command-line tools, encompassing a variety of biological scenarios.

<div id="limitations"># 5. Limitations and Best Practices</div>

-   **Experimental Validation is Essential:** While Phytomni provides powerful *in silico* predictions, its outputs may contain theoretical gaps or require real-world context. Validating its recommendations via experiments is crucial to guarantee their reliability in practical scenarios.
-   **Iterative Refinement is Key:** For complex tasks, refine your queries, input parameters, or prompts based on initial results and feedback to gradually enhance the relevance and quality of the outputs.
-   **Provide Specific Context:** Furnish detailed context (e.g., task objectives, species, experimental conditions, background) to help the AI understand your intent clearly, minimizing ambiguities and improving response accuracy.`
</script>

<style scoped>
.help-page {
  min-height: 100vh;
  padding: 20px;
  overflow-y: auto;
}

.help-container {
  max-width: 1200px;
  margin: 0 auto;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
}

.help-header {
  background: linear-gradient(135deg, #4f46e5 0%, #3aa3ed 100%);
  color: white;
  padding: 40px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-content h1 {
  font-size: 2.5rem;
  font-weight: 700;
  margin: 0 0 10px 0;
}

.header-content p {
  font-size: 1.1rem;
  opacity: 0.9;
  margin: 0;
}

.back-btn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-2px);
}

.help-content {
  padding: 40px;
}

/* 内容布局 */
.content-layout {
  display: flex;
  gap: 40px;
  max-width: 1400px;
  margin: 0 auto;
  padding-left: 320px; /* 为固定目录留出空间 */
}

/* 侧边栏目录样式 */
.toc-sidebar {
  width: 280px;
  flex-shrink: 0;
  position: fixed;
  top: 185px;
  left: 100px;
  height: fit-content;
  z-index: 100;
}

.toc-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e5e7eb;
}

.toc-nav {
  background: #f8fafc;
  border-radius: 8px;
  padding: 20px;
}

.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.toc-item {
  margin-bottom: 8px;
  position: relative;
}

.toc-item:last-child {
  margin-bottom: 0;
}

.toc-link {
  display: block;
  padding: 12px 16px;
  color: #6b7280;
  text-decoration: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.95rem;
  line-height: 1.4;
}

.toc-item:hover .toc-link {
  color: #374151;
  background: #e5e7eb;
}

.toc-item.active {
  position: relative;
}

.toc-item.active::before {
  content: '';
  position: absolute;
  left: -20px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #3b82f6;
  border-radius: 2px;
}

.toc-item.active .toc-link {
  color: #1f2937;
  font-weight: 600;
  background: #dbeafe;
}

/* 主内容区域 */
.main-content {
  flex: 1;
  min-width: 0;
}

.help-section {
  margin-bottom: 60px;
}

.section-title {
  font-size: 2rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 30px;
  position: relative;
  padding-bottom: 15px;
}

.section-title::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 60px;
  height: 4px;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  border-radius: 2px;
}

/* 快速开始样式 */
.step-list {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.step-item {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  padding: 30px;
  background: #f8fafc;
  border-radius: 12px;
  border-left: 4px solid #4f46e5;
}

.step-number {
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: white;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  flex-shrink: 0;
}

.step-content h3 {
  font-size: 1.3rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 10px 0;
}

.step-content p {
  color: #6b7280;
  line-height: 1.6;
  margin: 0;
}

/* 功能介绍样式 */
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 30px;
}

.feature-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 30px;
  transition: all 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  border-color: #4f46e5;
}

.feature-icon {
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}

.feature-icon i {
  font-size: 24px;
  color: white;
}

.feature-card h3 {
  font-size: 1.3rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 15px 0;
}

.feature-card p {
  color: #6b7280;
  line-height: 1.6;
  margin-bottom: 20px;
}

.feature-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.feature-list li {
  padding: 8px 0;
  color: #4b5563;
  position: relative;
  padding-left: 20px;
}

.feature-list li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: #10b981;
  font-weight: bold;
}

/* 深色模式适配(theme axis only — layout-coupled rules in TW-D3 / Wave 4.5) */
.theme-dark .help-page {
  background-color: var(--color-background) !important;
}

.theme-dark .help-container {
  background: var(--color-background) !important;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3) !important;
}

.theme-dark .help-header {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%) !important;
}

.theme-dark .toc-sidebar {
  background: var(--color-background-card) !important;
}

.theme-dark .toc-title {
  color: var(--el-text-color-primary) !important;
  border-bottom-color: var(--el-border-color) !important;
}

.theme-dark .toc-nav {
  background: var(--color-background-card) !important;
}

.theme-dark .toc-link {
  color: var(--el-text-color-regular) !important;
}

.theme-dark .toc-item:hover .toc-link {
  color: var(--el-text-color-primary) !important;
  background: var(--el-fill-color-light) !important;
}

.theme-dark .toc-item.active .toc-link {
  color: var(--el-color-primary) !important;
  background: var(--el-color-primary-light-9) !important;
}

.theme-dark .toc-item.active::before {
  background: var(--el-color-primary) !important;
}

.theme-dark .section-title {
  color: var(--el-text-color-primary) !important;
}

.theme-dark .section-title::after {
  background: linear-gradient(
    135deg,
    var(--el-color-primary),
    #7c3aed
  ) !important;
}

.theme-dark .step-item {
  background: var(--color-background) !important;
  border-left-color: var(--el-color-primary) !important;
}

.theme-dark .step-content h3 {
  color: var(--el-text-color-primary) !important;
}

.theme-dark .step-content p {
  color: var(--el-text-color-regular) !important;
}

.theme-dark .feature-card {
  background: var(--color-background-card) !important;
  border-color: var(--el-border-color) !important;
}

.theme-dark .feature-card:hover {
  border-color: var(--el-color-primary) !important;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2) !important;
}

.theme-dark .feature-card h3 {
  color: var(--el-text-color-primary) !important;
}

.theme-dark .feature-card p {
  color: var(--el-text-color-regular) !important;
}

.theme-dark .feature-list li {
  color: var(--el-text-color-regular) !important;
}

.theme-dark .feature-list li::before {
  color: var(--el-color-success) !important;
}

/* 响应式设计 */
@media (max-width: 1024px) {
  .content-layout {
  flex-direction: column;
  gap: 30px;
    padding-left: 0; /* 移除左侧padding */
  }
  
  .toc-sidebar {
    width: 100%;
    position: static;
    order: 2;
    top: auto;
    left: auto;
  }
  
  .main-content {
    order: 1;
  }
}

@media (max-width: 768px) {
  .help-page {
    padding: 10px;
  }
  
  .help-header {
    padding: 30px 20px;
    flex-direction: column;
    gap: 20px;
    text-align: center;
  }
  
  .header-content h1 {
    font-size: 2rem;
  }
  
  .help-content {
    padding: 20px;
  }
  
  .content-layout {
    gap: 20px;
  }
  
  .toc-sidebar {
    width: 100%;
  }
  
  .toc-nav {
    padding: 15px;
  }
  
  .toc-link {
    padding: 10px 12px;
    font-size: 0.9rem;
  }
}
</style>
