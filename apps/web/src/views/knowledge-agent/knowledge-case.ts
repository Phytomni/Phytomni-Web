export const KNOWLEDGE_CASE = {
  question:
    "How do epigenetic modifications, such as DNA methylation and histone modifications, regulate adaptive responses to drought stress in crops?",
  content:
    "The regulation of drought stress adaptation in crops by epigenetic mechanisms involves a dynamic interplay between **DNA methylation**, **histone modifications**, and hormonal signaling pathways. These reversible, heritable alterations to chromatin structure modulate gene expression without changing the underlying DNA sequence, enabling rapid physiological and morphological adjustments to water deficit conditions <sup>1,2</sup>.\n\n## DNA Methylation Dynamics and Gene Regulation\nDNA methylation, the addition of a methyl group to cytosine bases, is a primary epigenetic mark governing drought-responsive gene expression. It occurs in three sequence contexts: symmetric **CG** and **CHG** (where H is A, T, or C), and asymmetric **CHH**, which is hypersensitive to drought stress <sup>3,4</sup>. Maintenance of CG methylation is mediated by **MET1**, while **DRM** (Domains Rearranged Methyltransferase) is responsible for *de novo* methylation of all sequences and maintaining CHH sites via the RNA-directed DNA methylation (**RdDM**) pathway <sup>3,4</sup>. **CMT3** maintains CHG methylation <sup>5</sup>.\n\nDrought induces species-, genotype-, and tissue-specific changes in methylation patterns that directly regulate stress-responsive genes <sup>4,6</sup>. For instance, in drought-sensitive rice varieties, global DNA methylation levels increase under stress, whereas tolerant genotypes may show distinct hyper- or hypomethylation patterns <sup>6,7</sup>. In *Malus prunifolia*, demethylation of a promoter region (from 60% to 25%) in a dehydration-responsive gene resulted in a &gt;100-fold expression increase <sup>8</sup>. Similarly, in maize, the ABA-deficient mutant *vp10* exhibits altered methylation patterns crucial for stress tolerance, and the *Arabidopsis cmt3* mutant (defective in CHG methylation) shows reduced stomatal frequency and improved drought resistance over generations <sup>5</sup>. In potato, drought-tolerant varieties display hypermethylation genome-wide, while sensitive varieties show hypomethylation <sup>6</sup>. The **RdDM** pathway also targets transposable elements (TEs) and genes for sequence-specific silencing, contributing to transcriptome reprogramming <sup>4</sup>.\n\n## Histone Modifications and Chromatin Remodeling\nPost-translational modifications of histone proteins—including methylation, acetylation, phosphorylation, and ubiquitination—alter chromatin accessibility to transcription machinery <sup>1,9</sup>. **Acetylation** (e.g., **H3K9ac**) generally activates transcription by loosening chromatin, while **methylation** can activate (e.g., **H3K4me3**, **H3K36me3**) or repress (e.g., **H3K27me3**, **H3K9me3**) depending on the residue <sup>9,10</sup>.\n\nDuring drought stress, specific histone marks are selectively deposited to fine-tune gene expression. In barley, drought induces **H3K4me3** and **H3K9ac** enrichment at genes involved in ABA signaling, including **PP2C** family members <sup>5</sup>. Histone acetyltransferase **GCN5** facilitates acetylation at stress-responsive promoters under ABA signaling <sup>11</sup>. In tomato, self-grafting induces changes in **H3K4me3** and **H3K27me3**, leading to enduring shifts in hormone-related gene expression <sup>12</sup>. Maize NAT genes induced by drought are enriched with **H3K36me3**, **H3K9ac**, and **H3K4me3** <sup>10</sup>. In cotton, histone modifications regulate drought stress memory genes <sup>13</sup>. These modifications enable rapid stomatal regulation, improved water retention, and modified leaf architecture <sup>9</sup>.\n\n## Hormonal Crosstalk and Epigenetic Integration\nEpigenetic mechanisms integrate with hormonal pathways—particularly **abscisic acid (ABA)**, ethylene, jasmonates (JA), and salicylic acid (SA)—to orchestrate precise adaptive responses <sup>5,11,14</sup>. DNA methylation patterns interact with ABA signaling; in citrus, recurrent drought establishes methylation marks linked to increased ABA levels, enhancing resilience through physiological and antioxidant responses <sup>5,13</sup>. ABA can regulate gene expression via DNA methylation and histone acetylation status; for example, it represses gene expression in *Arabidopsis* via promoter methylation <sup>12</sup>.\n\nConversely, histone modifications mediate hormone-specific responses: JA signaling involves histone methylation at defense-related genes, while SA influences histone phosphorylation to activate immune genes <sup>11</sup>. The protein phosphatase **PP2C** in ABA signaling is regulated by histone acetylation in barley <sup>5</sup>. **WHIRLY1** expression in barley modulates ABA marker genes and histone modifications during drought <sup>5</sup>. This crosstalk allows plants to balance stability and flexibility in their epigenomes for optimal stress adaptation <sup>5,14</sup>.\n\n## Stress Memory and Transgenerational Inheritance\nEpigenetic marks form the basis of **somatic stress memory** (within one generation) and **transgenerational memory** (inherited by offspring) <sup>4</sup>. Somatic memory involves maintenance of histone marks like **H3K4me3** at drought-inducible genes (e.g., *RB29B*, *RAB18*) after re-watering, enabling faster priming responses <sup>4</sup>. Enzymes **DRM** (de novo methylation) and **CMT3** (maintenance), along with histone acetyltransferases (**HATs**) and deacetylases (**HDACs**), regulate the persistence of these marks <sup>5</sup>.\n\nTransgenerational inheritance is evidenced by heritable DNA methylation changes in rice over 11 generations of drought <sup>10</sup>. In rice, drought-primed progeny retain elevated 5-mC content, demonstrating epigenetic transmission of adaptive traits <sup>15</sup>. Citrus trees transmit drought memory via methylation status in scions, facilitating breeding of tolerant varieties <sup>13</sup>. In wheat, drought priming induces ABA and JA activity in progeny, enhancing tolerance <sup>13</sup>. Understanding the maintenance and erasure of these marks reveals how plants balance epigenomic stability and flexibility <sup>5,16</sup>.\n\n## Applications and Future Directions\nAdvanced technologies enable precise manipulation of epigenetic regulation for crop improvement. **Bisulfite sequencing** and **CRISPR-Cas9** epigenome editing (e.g., dCas9 fused to Tet1 or Dnmt3a for targeted methylation/demethylation) offer avenues to engineer drought tolerance <sup>4,14</sup>. **Epi-QTL** mapping identifies causal differentially methylated regions (DMRs) for stress tolerance <sup>15</sup>. Integrating omics approaches (epigenomics, transcriptomics) and single-cell sequencing will elucidate cell-type-specific epigenetic dynamics <sup>4,17</sup>.\n\n**Key epigenetic mechanisms for drought adaptation:**\n1. **RdDM pathway** targeting TEs for silencing <sup>4</sup>.\n2. **Maintenance methylation** by MET1/CMT3 for stable inheritance <sup>5</sup>.\n3. **Histone acetylation** via GCN5 for ABA-responsive activation <sup>11</sup>.\n4. **H3K4me3 persistence** for somatic memory <sup>4</sup>.\n5. **DNA demethylation** of promoters (e.g., drought-responsive genes) for rapid induction <sup>8</sup>.\n\nThese findings underscore the potential of epigenetic breeding and biotechnological approaches to develop climate-resilient crops essential for sustainable food security <sup>4,14</sup>.\n",
  references: [
    {
      file_id: "a701c6cb-ce12-4e75-84cd-7aa27afbc1a8",
      title:
        "Delineating the epigenetic regulation of heat and drought response in plants.",
      formatted_citation:
        "Delineating the epigenetic regulation of heat and drought response in plants.",
      doi_missing: true,
    },
    {
      file_id: "c426d53af1c6d65785a34b587d2e8145",
      title: "Plant Tolerance to Drought Stress with Emphasis on Wheat",
      formatted_citation:
        "Adel, S. & Carels, N. Plant Tolerance to Drought Stress with Emphasis on Wheat. *PLANTS-BASEL* **12,** 2170 (2023). [https://doi.org/10.3390/plants12112170](https://doi.org/10.3390/plants12112170)",
      ar: "2170",
      au: "Adel, S; Carels, N",
      ti: "Plant Tolerance to Drought Stress with Emphasis on Wheat",
      so: "PLANTS-BASEL",
      vl: "12",
      py: "2023",
      di: "10.3390/plants12112170",
      pm: "37299149",
    },
    {
      file_id: "b14838a057fa95afa797581558539b19",
      title:
        "Exploration of Epigenetics for Improvement of Drought and Other Stress Resistance in Crops A Review",
      formatted_citation:
        "Sun, C. et al. Exploration of Epigenetics for Improvement of Drought and Other Stress Resistance in Crops: A Review. *PLANTS-BASEL* **10,** 1226 (2021). [https://doi.org/10.3390/plants10061226](https://doi.org/10.3390/plants10061226)",
      ar: "1226",
      au: "Sun, C; Ali, K; Yan, K; Fiaz, S; Dormatey, R; Bi, ZZ; Bai, JP",
      ti: "Exploration of Epigenetics for Improvement of Drought and Other Stress Resistance in Crops: A Review",
      so: "PLANTS-BASEL",
      vl: "10",
      py: "2021",
      di: "10.3390/plants10061226",
      pm: "34208642",
    },
    {
      file_id: "824f0ba2a8a1be80c960ce849f6a5282",
      title: "DNA Methylation Dynamics in Response to Drought Stress in Crops",
      formatted_citation:
        "DNA Methylation Dynamics in Response to Drought Stress in Crops",
      doi_missing: true,
    },
    {
      file_id: "34c29df259f2c69f060667a9e35c7c07",
      title:
        "Epigenetic Modifications of Hormonal Signaling Pathways in Plant Drought Response and Tolerance for Sustainable Food Security",
      formatted_citation:
        "Epigenetic Modifications of Hormonal Signaling Pathways in Plant Drought Response and Tolerance for Sustainable Food Security",
      doi_missing: true,
    },
    {
      file_id: "16bbe6bbaaf4d6778c34927dcdfe7248",
      title:
        "Transcriptomics Analysis Reveals a More Refined Regulation Mechanism of Methylation in a Drought-Tolerant Variety of Potato",
      formatted_citation:
        "Bi, Z. Z. et al. Transcriptomics Analysis Reveals a More Refined Regulation Mechanism of Methylation in a Drought-Tolerant Variety of Potato. *GENES* **13,** 2260 (2022). [https://doi.org/10.3390/genes13122260](https://doi.org/10.3390/genes13122260)",
      ar: "2260",
      au: "Bi, ZZ; Wang, YH; Li, PC; Li, CJ; Liu, YD; Sun, C; Yao, PF; Liu, YH; Liu, Z; Bai, JP",
      ti: "Transcriptomics Analysis Reveals a More Refined Regulation Mechanism of Methylation in a Drought-Tolerant Variety of Potato",
      so: "GENES",
      vl: "13",
      py: "2022",
      di: "10.3390/genes13122260",
      pm: "36553527",
    },
    {
      file_id: "0a912120ae5ed8a55253c820f93e9bd3",
      title:
        "Genomics-based precision breeding approaches to improve drought tolerance in rice",
      formatted_citation:
        "Swamy, B. P. M. & Kumar, A. Genomics-based precision breeding approaches to improve drought tolerance in rice. *BIOTECHNOLOGY ADVANCES* **31,** 1308–1318 (2013). [https://doi.org/10.1016/j.biotechadv.2013.05.004](https://doi.org/10.1016/j.biotechadv.2013.05.004)",
      au: "Swamy, BPM; Kumar, A",
      ti: "Genomics-based precision breeding approaches to improve drought tolerance in rice",
      so: "BIOTECHNOLOGY ADVANCES",
      vl: "31",
      bp: "1308",
      ep: "1318",
      py: "2013",
      di: "10.1016/j.biotechadv.2013.05.004",
      pm: "23702083",
    },
    {
      file_id: "5f81a0843060f40827058a1941227903",
      title:
        "DNA methylation regulates the secondary metabolism of saponins to improve the adaptability of Eleutherococcus senticosus during drought stress",
      formatted_citation:
        "DNA methylation regulates the secondary metabolism of saponins to improve the adaptability of Eleutherococcus senticosus during drought stress",
      doi_missing: true,
    },
    {
      file_id: "ecabc7054cba0bbcb29baaa1bb445f98",
      title:
        "Somatic drought stress memory affects leaf morpho-physiological traits of plants via epigenetic mechanisms and phytohormonal signalling",
      formatted_citation:
        "Somatic drought stress memory affects leaf morpho-physiological traits of plants via epigenetic mechanisms and phytohormonal signalling",
      doi_missing: true,
    },
    {
      file_id: "5ade877499d7da3d47b0af30ff2dfa0f",
      title:
        "Exploitation of Drought Tolerance-Related Genes for Crop Improvement",
      formatted_citation:
        "Wang, J. Y. et al. Exploitation of Drought Tolerance-Related Genes for Crop Improvement. *INTERNATIONAL JOURNAL OF MOLECULAR SCIENCES* **22,** 10265 (2021). [https://doi.org/10.3390/ijms221910265](https://doi.org/10.3390/ijms221910265)",
      ar: "10265",
      au: "Wang, JY; Li, CN; Li, L; Reynolds, M; Mao, XG; Jing, RL",
      ti: "Exploitation of Drought Tolerance-Related Genes for Crop Improvement",
      so: "INTERNATIONAL JOURNAL OF MOLECULAR SCIENCES",
      vl: "22",
      py: "2021",
      di: "10.3390/ijms221910265",
      pm: "34638606",
    },
    {
      file_id: "23fb2dbecfc9d9eaae96f430246547d8",
      title:
        "Decoding phytohormone signaling in plant stress physiology Insights_ challenges_ and future directions",
      formatted_citation:
        "Decoding phytohormone signaling in plant stress physiology Insights\\_ challenges\\_ and future directions",
      doi_missing: true,
    },
    {
      file_id: "6f1ef57ce4781895ce6952e1a53cc428",
      title: "Epigenetics_ Epigenomics and Crop Improvement",
      formatted_citation:
        "Kapazoglou, A., Ganopoulos, I., Tani, E. & Tsaftaris, A. Epigenetics, Epigenomics and Crop Improvement. *TRANSGENIC PLANTS AND BEYOND* **86,** 287–324 (2018). [https://doi.org/10.1016/bs.abr.2017.11.007](https://doi.org/10.1016/bs.abr.2017.11.007)",
      au: "Kapazoglou, A; Ganopoulos, I; Tani, E; Tsaftaris, A",
      ti: "Epigenetics, Epigenomics and Crop Improvement",
      so: "TRANSGENIC PLANTS AND BEYOND",
      vl: "86",
      bp: "287",
      ep: "324",
      py: "2018",
      di: "10.1016/bs.abr.2017.11.007",
    },
    {
      file_id: "50b80804eedeac524ae47e1dacccf927",
      title:
        "Echoes of a Stressful Past Abiotic Stress Memory in Crop Plants towards Enhanced Adaptation",
      formatted_citation:
        "Lagiotis, G., Madesis, P. & Stavridou, E. Echoes of a Stressful Past: Abiotic Stress Memory in Crop Plants towards Enhanced Adaptation. *AGRICULTURE-BASEL* **13,** 2090 (2023). [https://doi.org/10.3390/agriculture13112090](https://doi.org/10.3390/agriculture13112090)",
      ar: "2090",
      au: "Lagiotis, G; Madesis, P; Stavridou, E",
      ti: "Echoes of a Stressful Past: Abiotic Stress Memory in Crop Plants towards Enhanced Adaptation",
      so: "AGRICULTURE-BASEL",
      vl: "13",
      py: "2023",
      di: "10.3390/agriculture13112090",
    },
    {
      file_id: "59ccce1b-c36d-469f-8b35-540469f8e00a",
      title:
        "Epigenetic Modifications of Hormonal Signaling Pathways in Plant Drought Response and Tolerance for Sustainable Food Security.",
      formatted_citation:
        "Epigenetic Modifications of Hormonal Signaling Pathways in Plant Drought Response and Tolerance for Sustainable Food Security.",
      doi_missing: true,
    },
    {
      file_id: "ed915409c1168db5dbd1356b52e39226",
      title:
        "Biochemical and Epigenetic Modulations under Drought Remembering the Stress Tolerance Mechanism in Rice",
      formatted_citation:
        "Kumar, S., Seem, K. & Mohapatra, T. Biochemical and Epigenetic Modulations under Drought: Remembering the Stress Tolerance Mechanism in Rice. *LIFE-BASEL* **13,** 1156 (2023). [https://doi.org/10.3390/life13051156](https://doi.org/10.3390/life13051156)",
      ar: "1156",
      au: "Kumar, S; Seem, K; Mohapatra, T",
      ti: "Biochemical and Epigenetic Modulations under Drought: Remembering the Stress Tolerance Mechanism in Rice",
      so: "LIFE-BASEL",
      vl: "13",
      py: "2023",
      di: "10.3390/life13051156",
      pm: "37240801",
    },
    {
      file_id: "4b6b12f3a9f057bc9510e68c9fb909f0",
      title:
        "Drought stress memory in maize understanding and harnessing the past for future resilience",
      formatted_citation:
        "Drought stress memory in maize understanding and harnessing the past for future resilience",
      doi_missing: true,
    },
    {
      file_id: "3fdcd388b2a28f36a3cbe3c21cc93a2e",
      title:
        "Dynamic regulation of DNA methylation and histone modifications in response to abiotic stresses in plants",
      formatted_citation:
        "Liu, Y. T., Wang, J., Liu, B. & Xu, Z. Y. Dynamic regulation of DNA methylation and histone modifications in response to abiotic stresses in plants. *JOURNAL OF INTEGRATIVE PLANT BIOLOGY* **64,** 2252–2274 (2022). [https://doi.org/10.1111/jipb.13368](https://doi.org/10.1111/jipb.13368)",
      au: "Liu, YT; Wang, J; Liu, B; Xu, ZY",
      ti: "Dynamic regulation of DNA methylation and histone modifications in response to abiotic stresses in plants",
      so: "JOURNAL OF INTEGRATIVE PLANT BIOLOGY",
      vl: "64",
      bp: "2252",
      ep: "2274",
      py: "2022",
      di: "10.1111/jipb.13368",
      pm: "36149776",
    },
  ],
};
