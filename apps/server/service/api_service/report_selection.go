package api_service

import (
	"encoding/json"
	"regexp"
	"strings"

	rxBot "phytomni-server/external/bot"
)

var reportFailureOnlyTemplates = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^The analysis reached a terminal outcome, but no validated scientific text artifact was available for synthesis\. Review the downloadable scientific artifacts and execution warnings before drawing conclusions\.$`),
	regexp.MustCompile(`(?i)^The analysis reached a terminal outcome, but scientific report synthesis was unavailable\. The validated scientific artifacts remain available for review before drawing conclusions\.(?: The terminal outcome covered [0-9]+ tasks, with [0-9]+ successful\.)?$`),
	regexp.MustCompile("^\u5206\u6790\u5df2\u5230\u8fbe\u7ec8\u6001\uff0c\u4f46\u6ca1\u6709\u53ef\u7528\u4e8e\u7efc\u5408\u7684\u5df2\u9a8c\u8bc1\u79d1\u5b66\u6587\u672c\u4ea7\u7269\u3002\u5728\u5f62\u6210\u7ed3\u8bba\u524d\uff0c\u8bf7\u7ed3\u5408\u53ef\u4e0b\u8f7d\u7684\u79d1\u5b66\u4ea7\u7269\u548c\u6267\u884c\u8b66\u544a\u8fdb\u884c\u5ba1\u9605\u3002$"),
	regexp.MustCompile("^\u5206\u6790\u5df2\u5230\u8fbe\u7ec8\u6001\uff0c\u4f46\u79d1\u5b66\u62a5\u544a\u7efc\u5408\u4e0d\u53ef\u7528\u3002\u5728\u5f62\u6210\u7ed3\u8bba\u524d\uff0c\u4ecd\u53ef\u5ba1\u9605\u5df2\u9a8c\u8bc1\u7684\u79d1\u5b66\u4ea7\u7269\u3002(?: \u672c\u6b21\u7ec8\u6001\u5305\u542b [0-9]+ \u4e2a\u4efb\u52a1\uff0c\u5176\u4e2d [0-9]+ \u4e2a\u4efb\u52a1\u6210\u529f\u3002)?$"),
}

// Match only known UI acknowledgements and complete operational templates.
// Scientific prose containing failure terminology is retained byte-for-byte.
func validReportText(agent, text string) bool {
	value := strings.ToUpper(strings.TrimSpace(text))
	switch value {
	case "", "PENDING", "QUEUED", "RUNNING", "INPUT_REQUIRED", "SUCCEEDED", "FAILED", "CANCELLED", "CANCELED", "TIMED_OUT", "TIMEOUT",
		"SORRY, I CANNOT ANSWER THIS QUESTION.", "TASK CREATED", "NO REFERENCES AVAILABLE.",
		"THE ANALYSIS REPORT IS NOT AVAILABLE YET.", "THE GENE NETWORK REPORT IS NOT AVAILABLE YET.",
		"THE DESIGN REPORT IS NOT AVAILABLE YET.", "THE RESEARCH REPORT IS NOT AVAILABLE YET.",
		"\u5206\u6790\u62a5\u544a\u5c1a\u672a\u751f\u6210\u3002", "\u57fa\u56e0\u7f51\u7edc\u62a5\u544a\u5c1a\u672a\u751f\u6210\u3002",
		"\u8bbe\u8ba1\u62a5\u544a\u5c1a\u672a\u751f\u6210\u3002", "\u7814\u7a76\u62a5\u544a\u5c1a\u672a\u751f\u6210\u3002", "\u6682\u65e0\u53c2\u8003\u6587\u732e\u3002":
		return false
	}
	for _, prefix := range []string{"TASK CREATED:", "TASK CREATED SUCCESSFULLY", "TASKS CREATED SUCCESSFULLY:", "TASK SUBMISSION FAILED:", "SERVER TASK CREATED:", "\u4efb\u52a1\u521b\u5efa\u6210\u529f"} {
		if strings.HasPrefix(value, prefix) {
			return false
		}
	}
	if agent == "deep_genome" || agent == "DeepGenomeAgent" {
		switch value {
		case "LOADING FILE CONTENT...", "LOADING FILE CONTENT..", "FILE CONTENT IS EMPTY OR FAILED TO LOAD":
			return false
		}
		if strings.HasPrefix(value, "FAILED TO LOAD FILE") {
			return false
		}
	}
	for _, template := range reportFailureOnlyTemplates {
		if template.MatchString(strings.TrimSpace(text)) {
			return false
		}
	}
	return true
}

func normalizeReportText(agent, text string) string {
	if validReportText(agent, text) {
		return text
	}
	return ""
}

func validStoredReportAnswer(agent, answer string) bool {
	if isCitedReportAgent(agent) {
		var cited struct {
			Content *string `json:"content"`
		}
		if json.Unmarshal([]byte(answer), &cited) == nil && cited.Content != nil {
			return validReportText(agent, *cited.Content)
		}
	}
	return validReportText(agent, answer)
}

func isCitedReportAgent(agent string) bool {
	switch agent {
	case "knowledge", "review", "brief_gene", "deep_genome":
		return true
	default:
		return false
	}
}

func hasFormattedTable(formatted *rxBot.Formatted) bool {
	return formatted != nil && strings.TrimSpace(string(formatted.Tabular)) != "" &&
		strings.TrimSpace(string(formatted.Tabular)) != "null"
}

// These are Bot's concrete work_item_key values, not logical sections or
// remote dispatch function names (agents/deep_genome/work_items.py).
func isDeepGenomeAnalysisKind(kind string) bool {
	switch kind {
	case "evolution_analysis", "gene_expression_tissues", "gene_expression_cultivars",
		"gene_expression_treatments", "gene_expression_genotypes", "single_cell_analysis",
		"promoter_analysis", "smep_analysis", "smoc_analysis", "protein_structure_analysis",
		"protein_design", "promoter_design":
		return true
	default:
		return false
	}
}

func normalizeProjectionReports(p BotRunProjection) BotRunProjection {
	p.IntermediateReport = normalizeReportText(p.Agent, p.IntermediateReport)
	p.FinalReport = normalizeReportText(p.Agent, p.FinalReport)
	if p.Agent == "deep_genome" {
		children := make([]BotRunChild, 0, len(p.Children))
		for _, child := range p.Children {
			if !isDeepGenomeAnalysisKind(child.Kind) {
				continue
			}
			child.Ordinal = len(children) + 1
			children = append(children, child)
		}
		p.Children = cloneBotRunChildren(children)
		p.ChildTaskCount = len(children)
	}
	return p
}

func cloneProjectionReport(report *rxBot.RunReport) *rxBot.RunReport {
	if report == nil {
		return nil
	}
	copy := *report
	return &copy
}

func cloneReportWarningCodes(codes []string) []string {
	if codes == nil {
		return nil
	}
	return append([]string{}, codes...)
}

func persistedReportWarningCodes(codes []string) *[]string {
	if codes == nil {
		return nil
	}
	copy := cloneReportWarningCodes(codes)
	return &copy
}

// Reuse the canonical decoder for stored metadata as well as live snapshots.
func decodeStoredReportMetadata(report json.RawMessage, codes []string) (rxBot.RunExecutionDelivery, error) {
	type warning struct {
		Code string `json:"code"`
	}
	var warnings []warning
	if codes != nil {
		warnings = make([]warning, len(codes))
		for i, code := range codes {
			warnings[i].Code = code
		}
	}
	raw, err := json.Marshal(struct {
		Report   json.RawMessage `json:"report,omitempty"`
		Warnings []warning       `json:"warnings"`
	}{report, warnings})
	if err != nil {
		return rxBot.RunExecutionDelivery{}, projectionDecodeError("report", "malformed metadata")
	}
	return rxBot.DecodeRunExecutionDelivery(raw, "")
}
