export const REVIEW_CASE = {
  question:
    "How does single-cell RNA sequencing (scRNA-seq) reveal the heterogeneous responses of different cell types within plant organs to biotic/abiotic stresses?",
  content:
    "### Title: Single-Cell RNA Sequencing Resolves Cell-Type-Specific Transcriptional Heterogeneity in Plant Organ Stress Responses\n\n### Abstract\nBulk tissue RNA sequencing obscures cell-type-specific transcriptional heterogeneity underlying plant responses to biotic and abiotic stresses. Single-cell RNA sequencing (scRNA-seq) and single-nucleus RNA sequencing (snRNA-seq) partition individual plant cells or nuclei to capture stress response profiles masked by population averages, bypassing limitations of fluorescence-activated cell sorting and translating ribosome affinity purification. This review synthesizes evidence for cell-type-specific stress responses across model and crop species, methodological advances in plant protoplast isolation, and integration of scRNA-seq with spatial transcriptomics and regulatory networks. We exclude human scRNA-seq, microbial single-cell studies, and bulk RNA-seq lacking single-cell validation. Current applications reveal heterogeneous regulatory mechanisms including TMO5/LHW-mediated root hair proliferation under low phosphorus and salt stress-induced cell-type-specific transcriptomic shifts in rice, with emerging translational prospects for climate-resilient crop breeding.\n\n### Introduction\nA central bottleneck in plant stress biology is the inability of bulk tissue RNA sequencing to resolve cell-type-specific transcriptional heterogeneity, as population-averaged expression masks distinct regulatory programs across cell identities within organs. Single-cell RNA sequencing (scRNA-seq) and related single-nucleus RNA sequencing (snRNA-seq) enable transcriptome profiling of individual plant cells or nuclei, overcoming technical barriers posed by rigid cell walls and dissociation-induced stress artifacts. Here we review advances in scRNA-seq methodology for plant tissues, evidence for cell-type-specific responses to biotic and abiotic stresses, and translational prospects for stress-resilient crop breeding. We exclude human scRNA-seq, microbial single-cell studies, and bulk RNA-seq datasets lacking single-cell validation.\n\n### Why cellular heterogeneity matters for plant stress responses\n#### Transcriptional heterogeneity in root stress responses\nSingle-cell RNA sequencing reveals that root cell populations maintain distinct transcriptional states under stress conditions, responses that bulk RNA-seq homogenizes into misleading population averages. In plant root systems facing multiple soil stressors, sc/snRNA-seq partitions individual cells to capture detailed stress response profiles, contrasting sharply with bulk tissue analysis that yields only averaged responses across all cell types <sup>1</sup>. This methodological advance enables isolation of specific cell populations without relying solely on fluorescence-activated cell sorting or translating ribosome affinity purification, thereby preserving native transcriptional states that dissociation protocols might otherwise alter <sup>1</sup>. The rigid secondary cell walls of many plant cells necessitate snRNA-seq approaches that bypass cell wall digestion, preventing the induction of artificial stress responses during sample preparation <sup>1</sup>.\n\n#### Spatially resolved single-cell multi-omics\nSpatially resolved single-cell transcriptomics demonstrates that plant stress responses involve dynamic coordination between cellular subpopulations and their metabolic microenvironments across tissues. Time-series scRNA-seq in Arabidopsis thaliana under ABA stress revealed rapid, cell-type specific miRNA regulatory networks, including mesophyll- and vascular-enriched miR858a-FBH3-MYB modules that suppress lignin biosynthesis via feed-forward loops, underscoring the role of single-cell resolution in dissecting stress-responsive regulatory mechanisms <sup>2</sup>. Recent scRNA-seq studies are beginning to merge with spatial transcriptome and mass spectrometry imaging-based spatial metabolome to systematically study the spatial dynamics of transcriptome and metabolome in different cell types during plant responses to stress <sup>3</sup>. Spatially resolved transcriptome studies in Oryza sativa leaves have identified six regulatory modules enriched for environmental sensing, cell wall deposition, and photosynthesis processes, with over 86.9% of network genes regulated by just five transcription factor families, demonstrating that spatial regulatory network analysis can resolve functional specialization relevant to stress responses <sup>4,5</sup>. Integration of single cell type-specific transcriptomes, proteomes, and metabolomes further enhances resolution of heterogeneous transcriptional states that bulk RNA-seq masks, revealing distinct subpopulations with high and low stress responses analogous to those observed in yeast transcriptome profiling <sup>3,6</sup>. However, the contribution of single-cell RNA-sequencing to plant biotic stress responses remains just the tip of the iceberg, as current efforts have not yet systematically characterized the full cellular heterogeneity across diverse plant species and stress conditions <sup>3</sup>. Recent spatial transcriptomics studies of plant host responses to pathogens have identified WRKY transcription factor-mediated regulatory networks underlying spatial expression patterns, providing early mechanistic insights into biotic stress cellular heterogeneity <sup>7</sup>.\n\n#### Plant stress repositories and cross-taxa comparisons\nLarge-scale plant stress transcriptome repositories provide critical molecular insights but currently lack the cellular resolution necessary to capture heterogeneous stress responses. The Plant Stress RNA-Seq Nexus integrates 12 plant species, 26 datasets, and 937 samples across 133 stress-specific subsets for differential expression analysis <sup>8</sup>. However, these collections predominantly derive from bulk RNA-seq methodologies that average transcriptional states across cell types, obscuring the distinct subpopulations that single-cell RNA sequencing reveals in root stress responses <sup>1,8</sup>. Even repositories including crop species fail to capture cell-type specific responses in specialized structures such as cotton fibers, peanut fruit pods, and root nodules, which single-cell and spatial transcriptomics have shown to harbor distinct regulatory networks governing stress resilience and yield traits <sup>9</sup>. This gap underscores the necessity of transitioning to single-cell resolution in future plant stress atlases to fully characterize the cellular heterogeneity underlying stress adaptation mechanisms, particularly for developing climate-resilient crops where cell-type specific responses to abiotic stresses like drought and high temperature are critical <sup>1,8,9</sup>.\n\nComparative eukaryotic studies demonstrate that cellular heterogeneity in stress responses represents a conserved biological principle, though direct evidence in plants remains limited but growing, with recent single-cell and spatial transcriptomic studies characterizing cell-type specific regulatory mechanisms in model and crop species <sup>2-4</sup>. In bacterial systems, scRNA-seq reveals that isogenic populations of Klebsiella pneumoniae exposed to meropenem develop transcriptionally distinct subpopulations associated with different phenotypic outcomes including persistence, states completely masked by bulk RNA-seq <sup>10</sup>. Similarly, yeast populations exhibit cells with high and low stress responses under transcriptional profiling <sup>3</sup>. While these findings suggest that heterogeneous cellular states confer adaptive advantages across taxa, systematic characterization of such heterogeneity in plant stress responses is still in its infancy, with current plant scRNA-seq studies only beginning to explore these dynamics, though emerging data on transcription factor regulatory networks are already informing targeted breeding strategies for stress resilient crops <sup>3,7,11</sup>.\n\n### How scRNA-seq deciphers plant cell-type transcriptomes\n#### Overview and core methodology\nSingle-cell RNA sequencing provides unprecedented resolution of plant cellular transcriptomes by revealing heterogeneity obscured in bulk tissue analyses. This droplet-based technology enables transcriptome profiling of individual cells within heterogeneous tissues, generating high-resolution atlases of cellular characterization and vastly improving understandings of interactions between individual cells and the microenvironment <sup>12</sup>. By operating at the level of single cells, scRNA-seq addresses limitations of tissue samples in capturing cellular heterogeneity and overcomes challenges posed by insufficient sample sizes for conventional sequencing approaches <sup>13</sup>. The methodology offers distinct advantages in detecting rare cell types and states, mining detailed spatio-temporal transcript information, resolving developmental trajectories in complex tissues, and identifying tissue- and developmental stage-specific marker genes <sup>14</sup>.\n\n#### Protoplast isolation and crop applications\nProtoplast isolation serves as the critical prerequisite enabling scRNA-seq application in plants by dissociating the rigid cell walls surrounding plant cells <sup>14</sup>. Leveraging protoplasts has propelled the capabilities of scRNA-seq, enabling comprehensive exploration of single-cell transcriptomes for understanding plant development, responses to environmental cues, and crop improvement <sup>13</sup>. In rice, Xie et al. developed a protocol for preparing chloroplast protoplasts and conducted scRNA-seq on individual cells, leading to the screening and identification of Os01g0934800 and Os01g0949900 as targets of OsNAC78, elucidating their regulatory roles <sup>13</sup>. Similarly, Li et al. established high-resolution expression profiles through scRNA-seq for wood formation, offering invaluable insights into the intricate processes underpinning this developmental pathway <sup>13</sup>. scRNA-seq has further elucidated cell-type-specific abiotic stress responses across plant species: Wang et al. identified five cell types in rice seedlings under high salt stress, revealing transcriptomic changes, altered cell population compositions, and slowed chloroplast differentiation, while Wendrich et al. linked the TMO5/LHW complex to low phosphorus-induced root hair proliferation in Arabidopsis, and heat stress in cabbage was shown to affect cell-type-specific gene expression and subgenome dominance <sup>15</sup>. Rice scRNA-seq has additionally revealed heterogeneity in cell-type responses to abiotic stress <sup>16</sup>. In cotton, scRNA-seq has identified nine cell clusters and 23 cluster-specific marker genes (including PLT3, LOX3, LAX1/2) underlying regeneration capacity differences between genotypes, characterized cell populations during somatic embryogenesis, and revealed cell-type-specific gene expression aberrations in anther and root under high temperature and salinity stress, respectively <sup>17</sup>.\n\n| Gene/Module | Species | Stress Type | Evidence Class |\n| --- | --- | --- | --- |\n| Os01g0934800, Os01g0949900 | Oryza sativa | Abiotic (salt) | scRNA-seq, target validation <sup>13</sup> |\n| TMO5/LHW | Arabidopsis thaliana | Low phosphorus | scRNA-seq, mutant analysis <sup>15</sup>|\n| PLT3, LOX3, LAX1/2 | Gossypium hirsutum | Salinity/regeneration | scRNA-seq, marker identification <sup>17</sup> |\n\n#### Technical limitations of plant scRNA-seq\nDespite its transformative potential, plant scRNA-seq faces significant technical constraints primarily due to the existence of cell walls and limitations in protoplasting procedures <sup>3</sup>. Protoplasting has been applied for scRNA-seq analysis but remains mostly limited to model plants such as Arabidopsis, which possesses stable and well-developed protoplasting protocols, while several cell types exhibit resistance to this enzymatic digestion <sup>3</sup>. Furthermore, the protoplasting process may promote ectopic gene expression and deletion of certain cell types, thereby increasing bias in cell-type proportions <sup>3</sup>. Additionally, most scRNA-seq technologies rely on polyadenylated tail priming of messenger RNA, primarily quantifying protein-coding transcripts and lagging in functional miRNA profiling <sup>16</sup>. scRNA-seq alone cannot provide cellular spatial information, limiting the exploration of complex developmental processes and responses to stimuli within intact tissue contexts <sup>3</sup>.\n\n#### Methodological advances for diverse plant species\nRecent methodological innovations have expanded the applicability of scRNA-seq across diverse plant species through improved protoplast isolation protocols. Wang and colleagues developed an efficient protocol for protoplast preparation in Chirita pumila consisting of two digestion processes with several enzymatic buffers, generating viable cell suspensions suitable for scRNA-seq analysis <sup>3</sup>. An efficient and universal protocol established in Chirita pumila employing two consecutive digestion processes with different enzymatic buffers was successfully tested on multiple organs including petals, fruits, tuberous roots, and gynophores from representative species across key branches of the angiosperm lineage, overcoming barriers to isolating protoplasts in diverse plant species <sup>18</sup>. Establishment of efficient cotton root protoplast isolation protocols has similarly demonstrated suitability for single-cell RNA sequencing, facilitating functional genomics in this essential fiber crop.\n\n### Cell-type-specific responses to biotic stress in plant organs\n#### General framework for biotic stress resolution\nSingle-cell RNA sequencing resolves the transcriptional heterogeneity obscured by bulk tissue analyses, enabling precise dissection of cell-type-specific stress responses across plant organs. While bulk RNA-seq averages expression across all cells, masking distinct regulatory programs, scRNA-seq captures individual transcriptomes with high resolution, revealing differential gene expression patterns specific to distinct cell populations during environmental perturbation <sup>19</sup>. This approach accommodates the technical challenges of plant cell isolation, with both scRNA-seq requiring dissociation and snRNA-seq bypassing dissociation for rigid-walled cells offering complementary advantages for preserving transcriptional states during experimental workflows involving cell wall digestion or frozen samples <sup>1</sup>.\n\n#### Abiotic stress heterogeneity in model and crop plants\nIn rice seedlings subjected to high salt stress, single-cell transcriptomic profiling reveals that abiotic stress-induced transcriptomic changes vary substantially across cell types, demonstrating distinct regulatory responses rather than uniform tissue-wide shifts. Analysis of 4,580 cells from wild-type and control groups identified five major cell populations, with differential gene expression analysis confirming that the magnitude and direction of transcriptional responses to salinity were cell-type-specific <sup>15</sup>. These findings indicate that salt stress alters gene expression programs in a manner dependent upon cellular identity within the seedling, rather than inducing a homogeneous response across all tissues.\n\nLow phosphorus availability triggers cell-type-specific proliferation of root epidermal cells in Arabidopsis through the action of the TMO5/LHW transcriptional complex, demonstrating targeted developmental adaptation to nutrient stress. Single-cell sequencing and genetic analysis revealed that target genes of this complex are enriched specifically in root hair cells, with the tmo5/tmo5-like1 double mutant exhibiting no increase in root hair density under low phosphorus conditions, whereas overexpression of TMO5 and LHW significantly increased density even under control conditions <sup>15</sup>. This establishes a causal link between the TMO5/LHW module and cell-type-specific developmental responses to phosphorus deficiency, rather than a general stress response affecting all root cells uniformly.\n\nHeat stress exposure in cabbage leaves and stems modulates gene expression in a cell-type-specific manner across 19 cellular subpopulations, affecting not only transcriptomic profiles but also subgenome dominance patterns. Single-cell RNA sequencing identified seven major cell types within these subpopulations, revealing that thermal stress alters the predominance of specific subgenomes in addition to inducing distinct transcriptional signatures in each cell type <sup>15</sup>. This demonstrates that elevated temperature induces heterogeneous responses across cellular identities, with implications for both gene expression regulation and genomic architecture within vegetative organs.\n\n#### Biotic stress insights and cross-domain parallels\nSingle-cell transcriptomic approaches reveal heterogeneous transcriptional responses during biotic stress interactions, though detailed characterization in plant systems remains nascent relative to microbial models. In Salmonella and Pseudomonas bacteria, scRNA-seq demonstrates cell-to-cell variation in growth-dependent gene expression across all RNA classes, while yeast studies identify distinct subpopulations exhibiting high and low stress responses during environmental challenge, suggesting conserved heterogeneity in host-pathogen interactions <sup>3</sup>. Emerging integration of single-cell RNA sequencing with spatial transcriptome and mass spectrometry imaging for spatial metabolome analysis promises systematic elucidation of plant biotic stress dynamics across tissue architectures, representing the current frontier in this domain <sup>3</sup>.\n\n### Cell-type-specific responses to abiotic stress in plant organs\n#### Rice abiotic stress transcriptional heterogeneity\nSingle-cell RNA sequencing resolves heterogeneous transcriptional responses to abiotic stress across distinct plant cell types that bulk tissue analyses average into uninformative mean expression profiles. While bulk RNA-seq aggregates expression across entire tissues, scRNA-seq captures transcriptome dynamics of individual cells, enabling identification of cell-type-specific transcriptional differences <sup>1,19</sup>. The technique partitions individual cells or nuclei using microfluidic devices to generate comprehensive transcriptome profiles without the confounding stress artifacts sometimes induced by cell dissociation required for fluorescence-activated cell sorting or translating ribosome affinity purification methods <sup>1</sup>. This high-resolution approach allows researchers to dissect molecular mechanisms underlying plant stress responses and discover potential stress resistance genes through the detection of expression heterogeneity that traditional approaches obscure <sup>19</sup>.\n\nHigh-salt stress induces transcriptomic alterations in rice seedlings that vary in magnitude and direction across cell types while reshaping population composition. Single-cell transcriptome profiling of wild-type Oryza sativa seedlings under high-salt stress identified 4,580 cells representing five distinct cell types, revealing that abiotic stress-induced transcriptome changes differed substantially by cell type compared to control conditions <sup>15</sup>. The treatment altered cell population composition and slowed chloroplast differentiation, demonstrating that stress impacts developmental trajectories in a cell-type-specific manner <sup>15</sup>. Parallel research using scRNA-seq on rice under combined high-salt and low-nitrogen conditions confirmed that differential gene expression across samples was cell type-specific and impeded mesophyll cell differentiation <sup>19</sup>. These findings indicate that abiotic stress responses in rice involve coordinated transcriptional reprogramming that varies across cellular identities <sup>19</sup>.\n\n#### Low phosphorus responses in Arabidopsis\nLow phosphate stress triggers TMO5/LHW-dependent increases in root hair density in Arabidopsis thaliana through cytokinin-mediated intercellular signaling between vascular and epidermal cells. Single-cell RNA sequencing of A. thaliana root tips revealed that target genes of the TMO5/LHW heterodimer were enriched specifically in root hair cells <sup>15</sup>. The tmo5 mutant maintained normal root hair density under low phosphorus, whereas overexpression of TMO5 and LHW significantly increased root hair density <sup>15</sup>. Critically, the tmo5/tmo5-like1 double mutant exhibited no change in root hair density under low phosphorus conditions, indicating that the low-phosphate-induced increase in root hair density was dependent on TMO5 function <sup>15</sup>. This response involves TMO5/LHW-stimulated cytokinin synthesis in vascular cells that alters epidermal cell length and fate, correlating cytokinin signals with phosphate acquisition mechanisms <sup>19</sup>.\n\n#### Thermal stress heterogeneity in maize and cabbage\nHeat stress exposure in maize roots reveals distinct subcellular trajectories for cortex and columella cell types, indicating cell-type-specific spatiotemporal responses to thermal stress. Single-cell transcriptome profiling of over 35,000 maize root cells under heat stress identified two subcellular types each for cortex and columella, which exhibited distinct cellular trajectories under stress conditions that were not previously described <sup>20</sup>. This analysis identified 939 cell markers, with 331 genes matching previous mapping studies, and validated five marker genes that localized to the same cell types as prior maize root single-cell atlases <sup>20</sup>. The large-scale single-cell dataset enabled comprehensive analysis of heat stress responses across cellular clusters, demonstrating that transcriptional responses to thermal stress vary not only between major cell types but also within subpopulations of the same cell type <sup>20</sup>.\n\nHeat stress treatment in cabbage leaves and stems alters gene expression in a cell-type-specific manner and shifts subgenome dominance across multiple cellular subpopulations. Single-cell RNA sequencing of heat-stressed Brassica oleracea leaves and stems identified 19 cellular subpopulations comprising seven major cell types <sup>15</sup>. The analysis revealed that heat stress affects gene expression in a cell-type-specific manner and also influences the predominance of subgenomes within these distinct cellular groups <sup>15</sup>. These findings demonstrate that transcriptional responses to elevated temperature in cabbage involve complex reprogramming that differs across cellular identities and genomic subdomains, highlighting the necessity of single-cell resolution for capturing stress-induced heterogeneity <sup>15</sup>.\n\n### Integrating scRNA-seq with spatial and regulatory networks\n#### Spatial transcriptomics and hormonal signaling\nThe integration of single-cell RNA sequencing with spatial transcriptomics provides unprecedented resolution for mapping cell type-specific hormonal signaling pathways and regulatory networks in plant stress physiology. Unlike bulk transcriptomics, this combined approach has revealed heterogeneous stress responses across diverse plant species and tissue types: in Arabidopsis roots, distinct cellular responses to phytohormones such as auxin and cytokinin during somatic embryogenesis have been identified <sup>21</sup>, while single-cell resolution in rice seedlings under salt stress uncovered cell type-specific transcriptome alterations, shifts in cell population composition, and slowed chloroplast differentiation <sup>15</sup>. In Arabidopsis, low phosphorus stress induces TMO5/LHW complex-dependent root hair proliferation, with target genes enriched in root hair cells and overexpression of TMO5/LHW significantly increasing root hair density <sup>15</sup>. Heat stress in cabbage leaves identified 19 cellular subpopulations across seven major cell types, revealing cell type-specific gene expression changes and altered subgenome dominance <sup>15</sup>. Comparative analyses between Arabidopsis and rice demonstrate that single-cell approaches uncover species-specific adaptations to stress stimuli while preserving spatial context of gene expression across tissues <sup>21</sup>, with expanded application to species including maize, tomato, poplar, and peanut now enabling cross-species comparisons of stress response mechanisms across roots, stems, leaves, and reproductive tissues <sup>15</sup>. These methodologies enable systematic study of spatially coordinated gene expression patterns, allowing researchers to decipher molecular mechanisms governing plant development and environmental responses through cell type classification and developmental trajectory tracing <sup>22</sup>.\n\n#### Regulatory network mapping with multi-omics integration\nChromatin accessibility assays integrated with scRNA-seq have pinpointed pivotal transcription factors mediating stress-responsive regulatory networks at single-cell resolution. The combination of scRNA-seq with ATAC-seq in Arabidopsis has highlighted WUS and DRN as critical regulators in stress-mediated cellular reprogramming, providing insights into genome-wide transcriptional regulation <sup>21</sup>. Complementary regulatory network analyses in monocot systems expand these insights: genome-scale gene network (RiceNet) application to biotic stress identified ROX1, ROX2, and ROX3 as regulators of XA21-mediated resistance <sup>23</sup>, while modular subnetwork clustering of rice stress responses revealed 228 subnetworks, with the largest (Cluster 1) enriched for ubiquitin proteasome and apoptosis signaling pathways and containing 45 high-degree, high-betweenness pathogen-targeted proteins <sup>24</sup>. Single-cell gene regulatory network (scGRN) prediction frameworks are now being leveraged for rice abiotic stress (e.g., heat) resilience, with workflows adaptable to diverse crops and stress conditions <sup>25</sup>. This regulatory network mapping identifies critical hubs in hormonal crosstalk, offering a basis for targeted interventions to enhance stress tolerance <sup>21</sup>. Spatial transcriptomics complements these approaches by preserving spatial context to map hormone-responsive pathways across different tissues, delivering a holistic view of plant stress adaptation mechanisms <sup>21</sup>.\n\n#### Spatial metabolomics and future multi-omics directions\nThe convergence of single-cell transcriptomics with spatial metabolomics enables systematic characterization of spatial dynamics in transcriptome and metabolome during plant stress responses. Recent scRNA-seq studies are merging with spatial transcriptome and mass spectrometry imaging-based spatial metabolome to systematically study spatial dynamics across tissues and cell types during plant responses to stress <sup>3</sup>. Spatial transcriptomics allows researchers to study gene regulatory networks in a spatially resolved manner, identifying spatially coordinated gene expression patterns that contribute to tissue functionality and stress adaptation <sup>22</sup>. However, challenges remain in integrating high-volume spatial and single-cell omics data, including deconvoluting responses to co-occurring abiotic stresses and parsing heterogeneous pathogen response signatures for accurate interpretation <sup>9</sup>. Future integration of spatial transcriptome data with complementary omics layers (proteome, metabolome, microbiome) and multi-omics platforms, combined with systems biology and artificial intelligence approaches, will enhance the resolution of gene regulatory networks underlying complex agronomic traits and accelerate precision crop breeding <sup>26,27</sup>. Integration of these spatially resolved transcriptomic approaches with other omics datasets accelerates the development of breeding strategies aimed at improving stress tolerance and overall plant development <sup>22</sup>.\n\n### Technical constraints and analytical challenges in plant scRNA-seq\n#### Cell wall-related biases and nuclei alternatives\nProtoplast isolation introduces significant cell-type bias in plant scRNA-seq, particularly for lignified or inner tissue layers. Secondary cell walls hinder enzymatic digestion required for individual protoplast isolation, resulting in unequal representation of cell types in protoplast populations <sup>28</sup>. This limitation is especially critical for cell types located in the inner layers of tissues or inner tissues of organs, restricting microfluidic-based scRNA-seq studies primarily to Arabidopsis roots where well-established protoplast procedures exist <sup>28</sup>. Nuclei isolation protocols have been developed for Populus shoot apices and stems as an alternative to circumvent these cell-wall-related biases <sup>28</sup>.\n\n#### Epitranscriptomic and isoform resolution limitations\nCurrent plant scRNA-seq protocols fail to capture epitranscriptomic marks and RNA structural features because they rely on cDNA synthesis and amplification. Even nascent single-cell long-read sequencing approaches, such as those integrating 10X Chromium scRNA-seq libraries with PacBio or ONT platforms, still require cDNA amplification to obtain sufficient RNA materials from individual cells <sup>29</sup>. This requirement prevents direct measurement of RNA modifications and structures <sup>29</sup>. Direct RNA sequencing at the single-cell level is anticipated to resolve these challenges, although it currently requires optimization of library construction protocols for plants and the development of corresponding machine learning or statistical algorithms <sup>29</sup>.\n\nShort-read scRNA-seq methodologies impose 3′ and 5′ bias that restricts transcript characterization to quantification rather than isoform resolution. The fragmentation step in traditional scRNA-seq causes 3′ and 5′ sequencing bias, limiting the technique to gene expression quantification rather than characterization of intact RNA molecules <sup>29</sup>. In contrast, single-cell long-read sequencing has demonstrated the ability to reveal isoform diversity, including novel and cell-type-specific alternative splicing, at unprecedented resolution in human cell lines <sup>29</sup>. An early study in A. thaliana at the single-nucleus level demonstrated that full-length reads faithfully retain cell identities and reveal heterogeneity in alternative splicing and APA among cell clusters <sup>29</sup>.\n\n#### Spatial and temporal information loss\nFull-length single-cell transcriptomic approaches suffer from prohibitive processing times that limit high-throughput application. Full-length sequencing technologies are characterized by long processing times, which hinders their application in high-throughput single-cell analysis <sup>3</sup>. This constraint contrasts with the requirements of unbiased, high-throughput transcriptomic profiling needed for comprehensive plant studies <sup>3</sup>. Consequently, while full-length methods enable detection of abnormal expression of key genes and transcript isoform patterns, their scalability remains technically challenging <sup>3</sup>.\n\nPlant scRNA-seq inherently sacrifices spatial information and obscures dynamic regulatory history because it measures steady-state RNA pools rather than active transcription. Single-cell sequencing technologies depend on the previous history of RNA transcription and degradation, thus obscuring information about regulatory dynamics <sup>30</sup>. These measurements also tend to sacrifice spatial information, which is critical given that bulk tissue averaging obscures important details about spatial control of cellular processes <sup>30</sup>. Real-time imaging approaches using systems such as PP7 and MS2 have been implemented in tobacco and Arabidopsis to count actively transcribing RNAP molecules, addressing the temporal limitations inherent in sequencing-based methods <sup>30</sup>. Computational integration of plant scRNA-seq with spatial transcriptomics is emerging to address spatial information loss, with tools including Seurat 5, SpatialScope, Giotto, and stPlus enabling transfer of cell-type annotations from single-cell data to spatial contexts to resolve tissue architecture and gene expression patterns in situ, paving the way for more comprehensive understanding of plant tissue composition and function <sup>31</sup>. Cross-omics annotation frameworks such as ScInfeR further support plant spatial omics analysis by incorporating spatial coordinate information and leveraging curated marker sets covering 28 plant tissue types, improving cell-type identification in spatially resolved datasets <sup>32</sup>.\n\n#### Technical noise and analytical frameworks\nTechnical noise in plant scRNA-seq requires rigorous experimental design to separate biological signals from artifacts arising from low RNA input per cell. Reliable gene expression data must be obtained from very low amounts of RNA present in a single cell when moving from homogenous cell analysis to single-cell transcriptome analysis <sup>3</sup>. Challenges including efficient isolation of individual cells, genome amplification, cost, and data interpretation to reduce errors require careful attention to maximize data quality and ensure signals are separable from technical noise <sup>3</sup>. The power of these technologies is still at an early stage, indicating that current analytical frameworks must account for these constraints to achieve accurate cell-type identification and heterogeneity discovery <sup>3</sup>. Graph-based annotation tools such as ScInfeR improve cell-type identification accuracy for plant scRNA-seq by integrating both reference datasets and curated marker sets, including 2497 gene markers across 28 plant tissue types, and demonstrate robustness to batch effects common in single-cell datasets <sup>32</sup>.\n\n### From single-cell insights to stress-resilient crop breeding\n#### Single-cell insights into crop stress regulatory mechanisms\nSingle-cell transcriptome sequencing provides critical resolution for identifying cell-type specific regulatory mechanisms underlying abiotic stress responses in crops. Unlike bulk transcriptomic approaches that average gene expression across all tissue cells, obscuring cell-specific responses and intercellular coordination, scRNA-seq resolves cell-type-specific regulatory networks <sup>9</sup>. In Arabidopsis thaliana root tips, single-cell RNA sequencing (scRNA-seq) revealed that target of monopteros 5/lonesome highway (TMO5/LHW) target genes were notably present in root hair cells, where the TMO5/LHW heterodimer stimulates cytokinin synthesis in vascular cells to enhance root hair density under low phosphorus conditions by altering epidermal cell length and fate, with implications for breeding stress-tolerant crops. In rice, long-term balancing selection at the Phosphorus Starvation Tolerance 1 (PSTOL1) locus across wild, domesticated, and weedy accessions highlights natural allelic variation underlying low phosphorus adaptation, with fitness trade-offs from antagonistic pleiotropy shaping stress adaptation evolution <sup>33</sup>. In rice seedlings subjected to high-salt and low-nitrogen stress, scRNA-seq identified five distinct cell types in both treatment and control groups, demonstrating that transcriptome changes in response to abiotic stress were cell type-specific and altered cell population composition, impeding mesophyll cell differentiation; meta-analysis of rice RNA-Seq data across drought, salt, extreme temperatures, and biotic stresses further identified a core stress response transcriptome, providing context for these cell-type-specific findings <sup>34</sup>. Application of scRNA-seq in sweet potato demonstrates its utility for dissecting abiotic stress responses and informing breeding in root crops <sup>35</sup>. Emerging single-nucleus RNA sequencing and spatial transcriptomics technologies preserve spatial context of gene expression, enabling reconstruction of tissue-level gene regulatory networks for stress responses, with spatial single-cell transcriptomics showing potential for precise breeding of crops and forest plants <sup>36</sup>. These findings establish that single-cell approaches uncover previously obscured regulatory nodes essential for targeted manipulation of stress-responsive traits and identify novel candidate genes for abiotic stress resistance <sup>9</sup>.\n\n#### Metabolite screening and QTL mapping\nMetabolite-based screening constitutes a more efficient strategy for breeding stress-resilient plant cells than gene-level screening due to its accelerated throughput and simplified technical requirements. Screening for alterations in metabolic activity under stress conditions compared to non-stress conditions allows for the rapid identification of plant cells with increased tolerance to environmental stress, as metabolite concentration serves as a direct indicator of physiological status <sup>37</sup>. This approach utilizes analytical methods familiar to those skilled in the art, including gas chromatography (GC), liquid chromatography (LC), high performance liquid chromatography (HPLC), mass spectrometry (MS), nuclear magnetic resonance (NMR) spectroscopy, infrared (IR) spectroscopy, and photometric methods, either individually or in combination <sup>37</sup>. The directed and stable incorporation of these metabolic traits through breeding enables the development of varieties with enhanced stress resilience without requiring prior identification of underlying genetic loci.\n\nQuantitative trait loci (QTL) mapping and high-throughput crop phenomics provide the necessary infrastructure for dissecting the polygenic architecture of stress tolerance traits that cannot be addressed through single-gene approaches. Essential agronomic features such as stress tolerance and crop yield are governed by polygenes regulated by the environment, necessitating marker-linked QTL detection via interval mapping approaches facilitated by whole genome sequence availability <sup>38</sup>. Crop phenomics accelerates genetic gain through massive phenotypic data collection using diverse sensors capturing morphology, structure, and physiological status from cell to whole plant levels, although statistical integration of such phenomic data remains a critical challenge for optimization <sup>38</sup>. These methodologies enable the accumulation of QTL information available from public databases, supporting the translation of complex genetic architectures into breeding applications.\n\n#### Transgenic and integrated breeding strategies\nTransgenic approaches offer a viable alternative for enhancing abiotic stress tolerance in specific contexts where conventional breeding faces reproductive restrictions and high probabilities of transferring undesirable traits. Genetic engineering is considered suitable for single gene transfer, enabling the creation of transgenic plants through direct gene transfer into the genome from single plant cells, conferring traits such as resistance to pesticides and pests, better nutritional value, and improved product shelf life <sup>39</sup>. For salt tolerance specifically, breeding strategies are not particularly recommended due to reproductive restrictions and the high probability of undesirable trait transfer, whereas transgenic methods have been utilized to enhance resistance to abiotic stress including salinity through targeted gene transfer <sup>39</sup>. Molecular breeding in rice has identified numerous genes and QTLs with high application potential for abiotic stress resistance <sup>40</sup>. Transcriptome-derived candidate genes for salt tolerance in poplar have been applied in transgenic breeding and phenotypic selection for stress-tolerant forest varieties (analogical evidence from forest tree species), demonstrating cross-species utility of transgenic approaches <sup>41</sup>. This approach must be integrated with broader genomic strategies to address multi-stress scenarios.\n\nThe integration of high-throughput phenotyping platforms with managed stress trials and genomic prediction is essential for developing crops resilient to multiple simultaneous stressors under climate change scenarios. Plant breeders developed managed stress trials imposing specific and well-defined conditions for single or small numbers of stresses, while phenotyping platforms have emerged to investigate these stresses with precise environmental management <sup>42</sup>. Multi-trait genome-wide association mapping and genomic selection, combined with high-throughput phenotyping, artificial intelligence, and gene editing technologies, facilitate the identification of key regulators functioning under different stressors to disrupt the tradeoff between stress tolerance and growth <sup>43</sup>. CRISPR-driven gene editing integrated into crop science enables development of next-generation traits for abiotic stress resistance (high temperature, drought, salinity, nutrient deficiencies) <sup>9</sup>. Integration of spatial transcriptomics with multi-omics datasets provides comprehensive understanding of plant biology, accelerating breeding strategy development for stress tolerance <sup>44</sup>. These integrative strategies, including genomic-enviromic prediction and speed breeding, aim to achieve high productivity with yield stability under complex multi-stress environments such as drought and heat, high salinity and alkalinity, or flooding and lodging <sup>43</sup>.\n\n### Conclusions\n1. Whether the miR858a-FBH3-MYB feed-forward module regulates lignin biosynthesis in vascular cell types of non-Arabidopsis plant species under ABA stress remains untested <sup>2</sup>.\n2. The extent to which subgenome dominance shifts under heat stress in Brassica oleracea are conserved across other cruciferous vegetable crops has not been systematically characterized <sup>15</sup>.\n3. Whether spatial metabolome-transcriptome integration can resolve heterogeneous pathogen response signatures in root nodule cell types of legume crops is currently lacking <sup>3,9</sup>.",
  references: [
    {
      file_id: "423d3090cae1246350dc16a42bb87f5c",
      title:
        "The transcriptional integration of environmental cues with root cell type development",
      formatted_citation:
        "The transcriptional integration of environmental cues with root cell type development",
      doi_missing: true,
    },
    {
      file_id: "12450da41aedd76e176484b3cb5a9152",
      title:
        "Cell-Type Specific miRNA Regulatory Network Responses to ABA Stress Revealed by Time Series Transcriptional Atlases in Arabidopsis",
      formatted_citation:
        "Cell-Type Specific miRNA Regulatory Network Responses to ABA Stress Revealed by Time Series Transcriptional Atlases in Arabidopsis",
      doi_missing: true,
    },
    {
      file_id: "d311522d1f8da46b0f3e25bc86b0e42e",
      title:
        "Single-Cell RNA Sequencing for Plant Research Insights and Possible Benefits",
      formatted_citation:
        "Bawa, G., Liu, Z. X., Yu, X. L., Qin, A. Z. & Sun, X. W. Single-Cell RNA Sequencing for Plant Research: Insights and Possible Benefits. *INTERNATIONAL JOURNAL OF MOLECULAR SCIENCES* **23,** 4497 (2022). [https://doi.org/10.3390/ijms23094497](https://doi.org/10.3390/ijms23094497)",
      ar: "4497",
      au: "Bawa, G; Liu, ZX; Yu, XL; Qin, AZ; Sun, XW",
      ti: "Single-Cell RNA Sequencing for Plant Research: Insights and Possible Benefits",
      so: "INTERNATIONAL JOURNAL OF MOLECULAR SCIENCES",
      vl: "23",
      py: "2022",
      di: "10.3390/ijms23094497",
      pm: "35562888",
    },
    {
      file_id: "efebb308-5d5a-47b1-ae32-3de8888efe18",
      title:
        "Spatially resolved gene regulatory networks in Asian rice (Oryza sativa cv. Nipponbare) leaves.",
      formatted_citation:
        "Spatially resolved gene regulatory networks in Asian rice \\(Oryza sativa cv. Nipponbare\\) leaves.",
      doi_missing: true,
    },
    {
      file_id: "93e52ab81675eb989bb0423f81410871",
      title:
        "Spatially resolved gene regulatory networks in Asian rice _Oryza sativa cv. Nipponbare_ leaves",
      formatted_citation:
        "Robertson, S. M. & Wilkins, O. Spatially resolved gene regulatory networks in Asian rice \\(&lt;i&gt;Oryza sativa&lt;/i&gt; cv. Nipponbare\\) leaves. *PLANT JOURNAL* **116,** 269–281 (2023). [https://doi.org/10.1111/tpj.16375](https://doi.org/10.1111/tpj.16375)",
      au: "Robertson, SM; Wilkins, O",
      ti: "Spatially resolved gene regulatory networks in Asian rice (<i>Oryza sativa</i> cv. Nipponbare) leaves",
      so: "PLANT JOURNAL",
      vl: "116",
      bp: "269",
      ep: "281",
      py: "2023",
      di: "10.1111/tpj.16375",
      pm: "37390084",
    },
    {
      file_id: "336c39558d3edf71c8e400f5eafa1446",
      title:
        "Decipher the Molecular Response of Plant Single Cell Types to Environmental Stresses",
      formatted_citation:
        "Nourbakhsh-Rey, M. & Libault, M. Decipher the Molecular Response of Plant Single Cell Types to Environmental Stresses. *BIOMED RESEARCH INTERNATIONAL* **2016,** 4182071 (2016). [https://doi.org/10.1155/2016/4182071](https://doi.org/10.1155/2016/4182071)",
      ar: "4182071",
      au: "Nourbakhsh-Rey, M; Libault, M",
      ti: "Decipher the Molecular Response of Plant Single Cell Types to Environmental Stresses",
      so: "BIOMED RESEARCH INTERNATIONAL",
      vl: "2016",
      py: "2016",
      di: "10.1155/2016/4182071",
      pm: "27088086",
    },
    {
      file_id: "d15f5a625cb793b5c88b91362767c506",
      title:
        "Spatially resolved transcriptomics reveals plant host responses to pathogens",
      formatted_citation:
        "Giolai, M. et al. Spatially resolved transcriptomics reveals plant host responses to pathogens. *PLANT METHODS* **15,** 114 (2019). [https://doi.org/10.1186/s13007-019-0498-5](https://doi.org/10.1186/s13007-019-0498-5)",
      ar: "114",
      au: "Giolai, M; Verweij, W; Lister, A; Heavens, D; Macaulay, I; Clark, MD",
      ti: "Spatially resolved transcriptomics reveals plant host responses to pathogens",
      so: "PLANT METHODS",
      vl: "15",
      py: "2019",
      di: "10.1186/s13007-019-0498-5",
      pm: "31624491",
    },
    {
      file_id: "2af25e1d-30a1-44c1-be4e-3689a3ac5342",
      title:
        "Plant stress RNA-seq Nexus: a stress-specific transcriptome database in plant cells.",
      formatted_citation:
        "Plant stress RNA-seq Nexus: a stress-specific transcriptome database in plant cells.",
      doi_missing: true,
    },
    {
      file_id: "7386cd451a0ab81041cf4ba70ba914fb",
      title:
        "Harnessing Single-Cell and Spatial Transcriptomics for Crop Improvement",
      formatted_citation:
        "Harnessing Single-Cell and Spatial Transcriptomics for Crop Improvement",
      doi_missing: true,
    },
    {
      file_id: "41071f4d578b3518163d8c25a8cc9ab4",
      title:
        "Bacterial droplet-based single-cell RNA-seq reveals antibiotic-associated heterogeneous cellular states",
      formatted_citation:
        "Ma, P. J. et al. Bacterial droplet-based single-cell RNA-seq reveals antibiotic-associated heterogeneous cellular states. *CELL* **186,** 877–\\+ (2023). [https://doi.org/10.1016/j.cell.2023.01.002](https://doi.org/10.1016/j.cell.2023.01.002)",
      au: "Ma, PJ; Amemiya, HM; He, LL; Gandhi, SJ; Nicol, R; Bhattacharyya, RP; Smillie, CS; Hung, DT",
      ti: "Bacterial droplet-based single-cell RNA-seq reveals antibiotic-associated heterogeneous cellular states",
      so: "CELL",
      vl: "186",
      bp: "877",
      ep: "+",
      py: "2023",
      di: "10.1016/j.cell.2023.01.002",
      pm: "36708705",
    },
    {
      file_id: "d021f7ae09886d8f2538ef2aa008cdbb",
      title:
        "Transcription factors - Insights into abiotic and biotic stress resilience and crop improvement",
      formatted_citation:
        "Transcription factors - Insights into abiotic and biotic stress resilience and crop improvement",
      doi_missing: true,
    },
    {
      file_id: "25119d69-df9e-421d-b68d-6f37d3d19c39",
      title: "Protoplast Isolation for Plant Single-Cell RNA-seq.",
      formatted_citation: "Protoplast Isolation for Plant Single-Cell RNA-seq.",
      doi_missing: true,
    },
    {
      file_id: "13ce5a78f26677e79775fa5dec9afd2b",
      title:
        "Isolation_ Purification_ and Application of Protoplasts and Transient Expression Systems in Plants",
      formatted_citation:
        "Chen, K. B., Chen, J. L., Pi, X., Huang, L. J. & Li, N. Isolation, Purification, and Application of Protoplasts and Transient Expression Systems in Plants. *INTERNATIONAL JOURNAL OF MOLECULAR SCIENCES* **24,** 16892 (2023). [https://doi.org/10.3390/ijms242316892](https://doi.org/10.3390/ijms242316892)",
      ar: "16892",
      au: "Chen, KB; Chen, JL; Pi, X; Huang, LJ; Li, N",
      ti: "Isolation, Purification, and Application of Protoplasts and Transient Expression Systems in Plants",
      so: "INTERNATIONAL JOURNAL OF MOLECULAR SCIENCES",
      vl: "24",
      py: "2023",
      di: "10.3390/ijms242316892",
      pm: "38069215",
    },
    {
      file_id: "73ca04ea00463215e2f78f70e0e41b5e",
      title:
        "Establishment of an efficient cotton root protoplast isolation protocol suitable for single-cell RNA sequencing and transient gene expression analysis",
      formatted_citation:
        "Zhang, K. et al. Establishment of an efficient cotton root protoplast isolation protocol suitable for single-cell RNA sequencing and transient gene expression analysis. *PLANT METHODS* **19,** 5 (2023). [https://doi.org/10.1186/s13007-023-00983-6](https://doi.org/10.1186/s13007-023-00983-6)",
      ar: "5",
      au: "Zhang, K; Liu, SH; Fu, YZ; Wang, ZX; Yang, XB; Li, WJ; Zhang, CH; Zhang, DM; Li, J",
      ti: "Establishment of an efficient cotton root protoplast isolation protocol suitable for single-cell RNA sequencing and transient gene expression analysis",
      so: "PLANT METHODS",
      vl: "19",
      py: "2023",
      di: "10.1186/s13007-023-00983-6",
      pm: "36653863",
    },
    {
      file_id: "59e52822153f6ae88eb4b2b6f7b7bcdd",
      title:
        "Advances in Single-Cell Transcriptome Sequencing and Spatial Transcriptome Sequencing in Plants",
      formatted_citation:
        "Lv, Z. et al. Advances in Single-Cell Transcriptome Sequencing and Spatial Transcriptome Sequencing in Plants. *PLANTS-BASEL* **13,** 1679 (2024). [https://doi.org/10.3390/plants13121679](https://doi.org/10.3390/plants13121679)",
      ar: "1679",
      au: "Lv, Z; Jiang, SJ; Kong, SX; Zhang, X; Yue, JH; Zhao, WQ; Li, L; Lin, SY",
      ti: "Advances in Single-Cell Transcriptome Sequencing and Spatial Transcriptome Sequencing in Plants",
      so: "PLANTS-BASEL",
      vl: "13",
      py: "2024",
      di: "10.3390/plants13121679",
      pm: "38931111",
    },
    {
      file_id: "e7b96e381159b5d1e551d27414ba7b0c",
      title:
        "Cell-Type Specific miRNA Regulatory Network Responses to ABA Stress Revealed by Time Series Transcriptional Atlases in Arabidopsis",
      formatted_citation:
        "Cell-Type Specific miRNA Regulatory Network Responses to ABA Stress Revealed by Time Series Transcriptional Atlases in Arabidopsis",
      doi_missing: true,
    },
    {
      file_id: "ff92828b91abdbc14f1e4041c8a5bb56",
      title:
        "Single-cell RNA sequencing opens a new era for cotton genomic research and gene functional analysis",
      formatted_citation:
        "Single-cell RNA sequencing opens a new era for cotton genomic research and gene functional analysis",
      doi_missing: true,
    },
    {
      file_id: "1c8afe2484f694589645166912395d71",
      title:
        "An Efficient and Universal Protoplast Isolation Protocol Suitable for Transient Gene Expression Analysis and Single-Cell RNA Sequencing",
      formatted_citation:
        "Wang, J. J. et al. An Efficient and Universal Protoplast Isolation Protocol Suitable for Transient Gene Expression Analysis and Single-Cell RNA Sequencing. *INTERNATIONAL JOURNAL OF MOLECULAR SCIENCES* **23,** 3419 (2022). [https://doi.org/10.3390/ijms23073419](https://doi.org/10.3390/ijms23073419)",
      ar: "3419",
      au: "Wang, JJ; Wang, Y; Lü, TF; Yang, X; Liu, J; Dong, Y; Wang, YZ",
      ti: "An Efficient and Universal Protoplast Isolation Protocol Suitable for Transient Gene Expression Analysis and Single-Cell RNA Sequencing",
      so: "INTERNATIONAL JOURNAL OF MOLECULAR SCIENCES",
      vl: "23",
      py: "2022",
      di: "10.3390/ijms23073419",
      pm: "35408780",
    },
    {
      file_id: "886bc8a38a6ef7ee51123a512e66f9a4",
      title:
        "Research Progress of Single-Cell Transcriptome Sequencing Technology in Plants",
      formatted_citation:
        "Research Progress of Single-Cell Transcriptome Sequencing Technology in Plants",
      doi_missing: true,
    },
    {
      file_id: "df20e0905cf719c4055176f06b99fcea",
      title:
        "Single-cell transcriptomes reveal spatiotemporal heat stress response in maize roots",
      formatted_citation:
        "Single-cell transcriptomes reveal spatiotemporal heat stress response in maize roots",
      doi_missing: true,
    },
    {
      file_id: "1ad02c251527a14bde634ff36ee1250a",
      title:
        "Decoding phytohormone signaling in plant stress physiology Insights, challenges, and future directions",
      formatted_citation:
        "Decoding phytohormone signaling in plant stress physiology Insights, challenges, and future directions",
      doi_missing: true,
    },
    {
      file_id: "d52b941c36d1d93b92b2200071bfcf68",
      title:
        "Multi-Omics Approaches in Oil Palm Research A Comprehensive Review of Metabolomics, Proteomics, and Transcriptomics Based on Low-Temperature Stress",
      formatted_citation:
        "Multi-Omics Approaches in Oil Palm Research A Comprehensive Review of Metabolomics, Proteomics, and Transcriptomics Based on Low-Temperature Stress",
      doi_missing: true,
    },
    {
      file_id: "4c30c6bb-c774-4354-a407-de6bf9dc3851",
      title:
        "Genetic dissection of the biotic stress response using a genome-scale gene network for rice.",
      formatted_citation:
        "Genetic dissection of the biotic stress response using a genome-scale gene network for rice.",
      doi_missing: true,
    },
    {
      file_id: "d0c98b48c45127d1164f96e2650ea439",
      title:
        "Prediction of protein-protein interactions between fungus _Magnaporthe grisea_ and rice _Oryza sativa L._",
      formatted_citation:
        "Ma, S. W. et al. Prediction of protein-protein interactions between fungus \\(Magnaporthe grisea\\) and rice \\(Oryza sativa L.\\). *BRIEFINGS IN BIOINFORMATICS* **20,** 448–456 (2019). [https://doi.org/10.1093/bib/bbx132](https://doi.org/10.1093/bib/bbx132)",
      au: "Ma, SW; Song, Q; Tao, H; Harrison, A; Wang, SB; Liu, W; Lin, SK; Zhang, ZD; Ai, YF; He, HQ",
      ti: "Prediction of protein-protein interactions between fungus (Magnaporthe grisea) and rice (Oryza sativa L.)",
      so: "BRIEFINGS IN BIOINFORMATICS",
      vl: "20",
      bp: "448",
      ep: "456",
      py: "2019",
      di: "10.1093/bib/bbx132",
      pm: "29040362",
    },
    {
      file_id: "98ad2d7afe632a40a4b2e5b143ca3611",
      title:
        "Single cell gene regulatory networks in plants Opportunities for enhancing climate change stress resilience",
      formatted_citation:
        "Tripathi, R. K. & Wilkins, O. Single cell gene regulatory networks in plants: Opportunities for enhancing climate change stress resilience. *PLANT CELL AND ENVIRONMENT* **44,** 2006–2017 (2021). [https://doi.org/10.1111/pce.14012](https://doi.org/10.1111/pce.14012)",
      au: "Tripathi, RK; Wilkins, O",
      ti: "Single cell gene regulatory networks in plants: Opportunities for enhancing climate change stress resilience",
      so: "PLANT CELL AND ENVIRONMENT",
      vl: "44",
      bp: "2006",
      ep: "2017",
      py: "2021",
      di: "10.1111/pce.14012",
      pm: "33522607",
    },
    {
      file_id: "50d5e32a72e1134c15b4b2e785f96fea",
      title:
        "Metabolomics-assisted breeding a viable option for crop improvement",
      formatted_citation:
        "Fernie, A. R. & Schauer, N. Metabolomics-assisted breeding: a viable option for crop improvement? *TRENDS IN GENETICS* **25,** 39–48 (2009). [https://doi.org/10.1016/j.tig.2008.10.010](https://doi.org/10.1016/j.tig.2008.10.010)",
      au: "Fernie, AR; Schauer, N",
      ti: "Metabolomics-assisted breeding: a viable option for crop improvement?",
      so: "TRENDS IN GENETICS",
      vl: "25",
      bp: "39",
      ep: "48",
      py: "2009",
      di: "10.1016/j.tig.2008.10.010",
      pm: "19027981",
    },
    {
      file_id: "4dfcf917-f3ef-4e0d-9ba9-2f0f52648c17",
      title:
        "Integration of multi-omics technologies for crop improvement: Status and prospects.",
      formatted_citation:
        "Integration of multi-omics technologies for crop improvement: Status and prospects.",
      doi_missing: true,
    },
    {
      file_id: "ae08866534e852bf3494a943b7c1fa7c",
      title:
        "A robust method of nuclei isolation for single-cell RNA sequencing of solid tissues from the plant genus Populus",
      formatted_citation:
        "Conde, D. et al. A robust method of nuclei isolation for single-cell RNA sequencing of solid tissues from the plant genus &lt;i&gt;Populus&lt;/i&gt;. *PLOS ONE* **16,** e0251149 (2021). [https://doi.org/10.1371/journal.pone.0251149](https://doi.org/10.1371/journal.pone.0251149)",
      ar: "e0251149",
      au: "Conde, D; Triozzi, PM; Balmant, KM; Doty, AL; Miranda, M; Boullosa, A; Schmidt, HW; Pereira, WJ; Dervinis, C; Kirst, M",
      ti: "A robust method of nuclei isolation for single-cell RNA sequencing of solid tissues from the plant genus <i>Populus</i>",
      so: "PLOS ONE",
      vl: "16",
      py: "2021",
      di: "10.1371/journal.pone.0251149",
      pm: "33974645",
    },
    {
      file_id: "5cc7e06d7f6b00b4d470c8545393b9db",
      title:
        "Direct RNA sequencing in plants Practical applications and future perspectives",
      formatted_citation:
        "Direct RNA sequencing in plants Practical applications and future perspectives",
      doi_missing: true,
    },
    {
      file_id: "7ac07cdfb613e643ec7ab638bc75baa9",
      title:
        "Quantitative imaging of RNA polymerase II activity in plants reveals the single-cell basis of tissue-wide transcriptional dynamics",
      formatted_citation:
        "Alamos, S., Reimer, A., Niyogi, K. K. & Garcia, H. G. Quantitative imaging of RNA polymerase II activity in plants reveals the single-cell basis of tissue-wide transcriptional dynamics. *NATURE PLANTS* **7,** 1037–\\+ (2021). [https://doi.org/10.1038/s41477-021-00976-0](https://doi.org/10.1038/s41477-021-00976-0)",
      au: "Alamos, S; Reimer, A; Niyogi, KK; Garcia, HG",
      ti: "Quantitative imaging of RNA polymerase II activity in plants reveals the single-cell basis of tissue-wide transcriptional dynamics",
      so: "NATURE PLANTS",
      vl: "7",
      bp: "1037",
      ep: "+",
      py: "2021",
      di: "10.1038/s41477-021-00976-0",
      pm: "34373604",
    },
    {
      file_id: "ecdfe8650227dc2e30af26cef7a027a1",
      title: "Recent progress in single-cell transcriptomic studies in plants",
      formatted_citation:
        "Recent progress in single-cell transcriptomic studies in plants",
      doi_missing: true,
    },
    {
      file_id: "5f588ff7-612b-409a-8a12-53cc9304e28a",
      title:
        "ScInfeR: an efficient method for annotating cell types and sub-types in single-cell RNA-seq, ATAC-seq, and spatial omics.",
      formatted_citation:
        "ScInfeR: an efficient method for annotating cell types and sub-types in single-cell RNA-seq, ATAC-seq, and spatial omics.",
      doi_missing: true,
    },
    {
      file_id: "765a5c6a712b38da4ae06b40a4b73ea2",
      title:
        "Long-term balancing selection at the Phosphorus Starvation Tolerance 1 _PSTOL1_ locus in wild_ domesticated and weedy rice _Oryza_",
      formatted_citation:
        "Long-term balancing selection at the Phosphorus &lt;i&gt;Starvation Tolerance 1&lt;/i&gt; \\(&lt;i&gt;PSTOL1&lt;/i&gt;\\) locus in wild, domesticated and weedy rice \\(&lt;i&gt;Oryza&lt;/i&gt;\\). *BMC PLANT BIOLOGY* **16,** 101 (2016). [https://doi.org/10.1186/s12870-016-0783-7](https://doi.org/10.1186/s12870-016-0783-7)",
      ar: "101",
      ti: "Long-term balancing selection at the Phosphorus <i>Starvation Tolerance 1</i> (<i>PSTOL1</i>) locus in wild, domesticated and weedy rice (<i>Oryza</i>)",
      so: "BMC PLANT BIOLOGY",
      vl: "16",
      py: "2016",
      di: "10.1186/s12870-016-0783-7",
      pm: "27101874",
    },
    {
      file_id: "b77f5a6f3f71f40032b60830bc7161da",
      title:
        "Abiotic and biotic stresses induce a core transcriptome response in rice",
      formatted_citation:
        "Cohen, S. P. & Leach, J. E. Abiotic and biotic stresses induce a core transcriptome response in rice. *SCIENTIFIC REPORTS* **9,** 6273 (2019). [https://doi.org/10.1038/s41598-019-42731-8](https://doi.org/10.1038/s41598-019-42731-8)",
      ar: "6273",
      au: "Cohen, SP; Leach, JE",
      ti: "Abiotic and biotic stresses induce a core transcriptome response in rice",
      so: "SCIENTIFIC REPORTS",
      vl: "9",
      py: "2019",
      di: "10.1038/s41598-019-42731-8",
      pm: "31000746",
    },
    {
      file_id: "95e630e46273b80425eed786dcdb4903",
      title: "单细胞转录组测序技术发展及其在甘薯中的应用_赵楠",
      formatted_citation: "单细胞转录组测序技术发展及其在甘薯中的应用\\_赵楠",
      doi_missing: true,
    },
    {
      title: "Unknown Document",
      formatted_citation: "Unknown Document.",
      doi_missing: true,
    },
    {
      file_id: "a5db7dee-e1f4-4f4e-adfe-68b8b58a4100",
      title:
        "Plant cells and plants with increased tolerance to environmental stress",
      formatted_citation:
        "Plant cells and plants with increased tolerance to environmental stress",
      doi_missing: true,
    },
    {
      file_id: "39720322473da5ad5b1c31a3cee79e58",
      title:
        "Biotechnological Advances to Improve Abiotic Stress Tolerance in Crops",
      formatted_citation:
        "Villalobos-López, M. A., Arroyo-Becerra, A., Quintero-Jiménez, A. & Iturriaga, G. Biotechnological Advances to Improve Abiotic Stress Tolerance in Crops. *INTERNATIONAL JOURNAL OF MOLECULAR SCIENCES* **23,** 12053 (2022). [https://doi.org/10.3390/ijms231912053](https://doi.org/10.3390/ijms231912053)",
      ar: "12053",
      au: "Villalobos-López, MA; Arroyo-Becerra, A; Quintero-Jiménez, A; Iturriaga, G",
      ti: "Biotechnological Advances to Improve Abiotic Stress Tolerance in Crops",
      so: "INTERNATIONAL JOURNAL OF MOLECULAR SCIENCES",
      vl: "23",
      py: "2022",
      di: "10.3390/ijms231912053",
      pm: "36233352",
    },
    {
      file_id: "1a8f2be43bcfd346d312bf1bbb0a4f36",
      title:
        "Impact of Nanomaterials on the Regulation of Gene Expression and Metabolomics of Plants under Salt Stress",
      formatted_citation:
        "Abideen, Z., Hanif, M., Munir, N. & Nielsen, B. L. Impact of Nanomaterials on the Regulation of Gene Expression and Metabolomics of Plants under Salt Stress. *PLANTS-BASEL* **11,** 691 (2022). [https://doi.org/10.3390/plants11050691](https://doi.org/10.3390/plants11050691)",
      ar: "691",
      au: "Abideen, Z; Hanif, M; Munir, N; Nielsen, BL",
      ti: "Impact of Nanomaterials on the Regulation of Gene Expression and Metabolomics of Plants under Salt Stress",
      so: "PLANTS-BASEL",
      vl: "11",
      py: "2022",
      di: "10.3390/plants11050691",
      pm: "35270161",
    },
    {
      file_id: "79351a24e3f755d215f106eab8655b53",
      title: "Recent progress on molecular breeding of rice in China",
      formatted_citation:
        "Rao, Y. C., Li, Y. Y. & Qian, Q. Recent progress on molecular breeding of rice in China. *PLANT CELL REPORTS* **33,** 551–564 (2014). [https://doi.org/10.1007/s00299-013-1551-x](https://doi.org/10.1007/s00299-013-1551-x)",
      au: "Rao, YC; Li, YY; Qian, Q",
      ti: "Recent progress on molecular breeding of rice in China",
      so: "PLANT CELL REPORTS",
      vl: "33",
      bp: "551",
      ep: "564",
      py: "2014",
      di: "10.1007/s00299-013-1551-x",
      pm: "24442397",
    },
    {
      file_id: "5cee403e00826419397871cc8d8e66a9",
      title:
        "Multi-Omics Techniques in Genetic Studies and Breeding of Forest Plants",
      formatted_citation:
        "Wang, M. C., Li, R. & Zhao, Q. Multi-Omics Techniques in Genetic Studies and Breeding of Forest Plants. *FORESTS* **14,** 1196 (2023). [https://doi.org/10.3390/f14061196](https://doi.org/10.3390/f14061196)",
      ar: "1196",
      au: "Wang, MC; Li, R; Zhao, Q",
      ti: "Multi-Omics Techniques in Genetic Studies and Breeding of Forest Plants",
      so: "FORESTS",
      vl: "14",
      py: "2023",
      di: "10.3390/f14061196",
    },
    {
      file_id: "bb3e83edba074e1735e4e395f6721249",
      title:
        "Genetic architecture of plant stress resistance multi-trait genome-wide association mapping",
      formatted_citation:
        "Thoen, M. P. M. et al. Genetic architecture of plant stress resistance: multi-trait genome-wide association mapping. *NEW PHYTOLOGIST* **213,** 1346–1362 (2017). [https://doi.org/10.1111/nph.14220](https://doi.org/10.1111/nph.14220)",
      au: "Thoen, MPM; Olivas, NHD; Kloth, KJ; Coolen, S; Huang, PP; Aarts, MGM; Bac-Molenaar, JA; Bakker, J; Bouwmeester, HJ; Broekgaarden, C; Bucher, J; Busscher-Lange, J; Cheng, X; Fradin, EF; Jongsma, MA; Julkowska, MM; Keurentjes, JJB; Ligterink, W; Pieterse, CMJ; Ruyter-Spira, C; Smant, G; Testerink, C; Usadel, B; van Loon, JJA; van Pelt, JA; van Schaik, CC; van Wees, SCM; Visser, RGF; Voorrips, R; Vosman, B; Vreugdenhil, D; Warmerdam, S; Wiegers, GL; van Heerwaarden, J; Kruijer, W; van Eeuwijk, FA; Dicke, M",
      ti: "Genetic architecture of plant stress resistance: multi-trait genome-wide association mapping",
      so: "NEW PHYTOLOGIST",
      vl: "213",
      bp: "1346",
      ep: "1362",
      py: "2017",
      di: "10.1111/nph.14220",
      pm: "27699793",
    },
    {
      file_id: "9a76eee3063be00cb9212634fe2ac200",
      title: "Abiotic stress tolerance Genetics_ genomics_ and breeding",
      formatted_citation:
        "Xu, Y. B., Qin, F., Chu, C. C. & Varshney, R. K. Abiotic stress tolerance: Genetics, genomics, and breeding. *CROP JOURNAL* **11,** 969–974 (2023). [https://doi.org/10.1016/j.cj.2023.07.002](https://doi.org/10.1016/j.cj.2023.07.002)",
      au: "Xu, YB; Qin, F; Chu, CC; Varshney, RK",
      ti: "Abiotic stress tolerance: Genetics, genomics, and breeding",
      so: "CROP JOURNAL",
      vl: "11",
      bp: "969",
      ep: "974",
      py: "2023",
      di: "10.1016/j.cj.2023.07.002",
    },
    {
      file_id: "96dae60cf7c1a30dd16168a7fce650bf",
      title:
        "Multi-Omics Approaches in Oil Palm Research A Comprehensive Review of Metabolomics_ Proteomics_ and Transcriptomics Based on Low-Temperature Stress",
      formatted_citation:
        "Multi-Omics Approaches in Oil Palm Research A Comprehensive Review of Metabolomics\\_ Proteomics\\_ and Transcriptomics Based on Low-Temperature Stress",
      doi_missing: true,
    },
  ],
};
