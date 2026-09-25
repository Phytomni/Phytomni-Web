package bot

import "fmt"

const (
	DefaultMaxUserQueryChars          = 131_072
	HardMaxUserQueryChars             = 1_048_576
	DefaultMaxAssetAttachmentRefs     = 64
	HardMaxAssetAttachmentRefs        = 256
	DefaultMaxResearchDatasetPaths    = 64
	HardMaxResearchDatasetPaths       = 256
	DefaultMaxResearchInputReferences = 128
	HardMaxResearchInputReferences    = 256
)

func NormalizeMaxUserQueryChars(value int) (int, error) {
	if value == 0 {
		return DefaultMaxUserQueryChars, nil
	}
	if value < 1 || value > HardMaxUserQueryChars {
		return 0, fmt.Errorf("bot.max_query_chars must be between 1 and %d", HardMaxUserQueryChars)
	}
	return value, nil
}

func ConfiguredMaxUserQueryChars() int {
	if BotConfig == nil {
		return DefaultMaxUserQueryChars
	}
	return BotConfig.MaxQueryChars
}
