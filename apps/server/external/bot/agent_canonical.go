package bot

// CanonicalAgentTool pins the Bot /v1/agents {slug: tool} mapping as the single
// source of truth for agent names. aliasToSlug (this package) and slugToToolName
// (api_service) are validated against it by the drift-guard tests so a future
// edit cannot let a Web name drift from the Bot function name again.
var CanonicalAgentTool = map[string]string{
	"chat":        "ChatAgent",
	"knowledge":   "KnowledgeAgent",
	"data":        "DataAgent",
	"review":      "ReviewAgent",
	"brief_gene":  "BriefGeneAgent",
	"analyst":     "AnalystAgent",
	"deep_genome": "DeepGenomeAgent",
	"research":    "InSilicoResearchAgent",
	"design":      "DigitalDesignAgent",
	"network":     "GeneNetworkAgent",
}
