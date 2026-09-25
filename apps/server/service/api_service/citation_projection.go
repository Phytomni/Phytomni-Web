package api_service

import (
	"phytomni-server/common/citation"
	rxBot "phytomni-server/external/bot"
)

// Supplied references must be valid even when there is no report to replace.
func validateCitationReferencesForAgent(slug string, formatted *rxBot.Formatted) error {
	if formatted == nil {
		return nil
	}
	switch slug {
	case "knowledge", "review", "brief_gene", "deep_genome":
		_, err := citation.DecodeRows(formatted.References)
		return err
	default:
		return nil
	}
}

func normalizeCitationAnswerForTool(toolName, answer string) (string, error) {
	switch toolName {
	case "KnowledgeAgent", "ReviewAgent", "BriefGeneAgent", "DeepGenomeAgent":
		return rxBot.NormalizeCitedAnswer(answer)
	default:
		return answer, nil
	}
}
