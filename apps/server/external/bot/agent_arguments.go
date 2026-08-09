package bot

import (
	"fmt"
	"regexp"
	"strings"
)

// AgentArgumentInput contains the Web-owned values that can be projected into
// one Bot native-run argument object. Opaque asset references travel through
// the dedicated attachments field, never through native argument paths.
type AgentArgumentInput struct {
	UserQuery      string
	HasAttachments bool
	GeneID         string
	ToID           string
	SpeciesCode    string
	InteropMode    string
	InteropTargets []string
}

var interopTargetIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

const (
	MaxInteropTargets    = 16
	MaxInteropModeLength = 16
)

func validateInterop(mode string, targets []string) (string, []string, error) {
	if mode == "" {
		mode = "off"
	}
	if len([]rune(mode)) > MaxInteropModeLength {
		return "", nil, fmt.Errorf("interop mode exceeds %d characters", MaxInteropModeLength)
	}
	switch mode {
	case "off", "auto", "required":
	default:
		return "", nil, fmt.Errorf("invalid interop mode %q", mode)
	}

	copyTargets := make([]string, len(targets))
	if len(targets) > MaxInteropTargets {
		return "", nil, fmt.Errorf("too many interop targets")
	}
	copy(copyTargets, targets)
	seen := make(map[string]struct{}, len(copyTargets))
	for _, target := range copyTargets {
		if !interopTargetIDPattern.MatchString(target) {
			return "", nil, fmt.Errorf("interop target is outside the configured allowlist")
		}
		if _, exists := seen[target]; exists {
			return "", nil, fmt.Errorf("duplicate interop target %q", target)
		}
		seen[target] = struct{}{}
	}
	if mode == "off" {
		// The local mode is an explicit no-peer contract. Validate any supplied
		// ids so malformed input cannot be smuggled through, then never forward
		// them to Bot where a future implementation might misinterpret them.
		return mode, []string{}, nil
	}
	return mode, copyTargets, nil
}

// ValidateInteropControls exposes the same bounded mode/id validation used by
// BuildAgentArguments to the service orchestration layer. It does not consult
// Bot or a registry; the service applies the authenticated target allowlist
// separately before enabling auto/required delegation.
func ValidateInteropControls(mode string, targets []string) (string, []string, error) {
	return validateInterop(mode, targets)
}

// BuildAgentArguments projects validated Web input into the release-native
// argument shape for one agent run. It returns a fresh map and fresh slices so
// callers cannot mutate a payload after it has been handed to the Bot client.
func BuildAgentArguments(slug string, input AgentArgumentInput) (map[string]interface{}, error) {
	if _, ok := CanonicalAgentTool[slug]; !ok {
		return nil, fmt.Errorf("unknown agent slug %q", slug)
	}
	if strings.TrimSpace(input.UserQuery) == "" &&
		!(input.HasAttachments && (slug == "analyst" || slug == "research")) {
		return nil, fmt.Errorf("user query is required")
	}
	interopMode, interopTargets, err := validateInterop(input.InteropMode, input.InteropTargets)
	if err != nil {
		return nil, err
	}

	args := map[string]interface{}{"user_query": input.UserQuery}
	switch slug {
	case "research":
		args["data_list"] = map[string]string{}
		args["obs_file_list"] = []string{}
		args["interop_mode"] = interopMode
		args["interop_targets"] = interopTargets
	case "analyst":
		args["data_list"] = map[string]string{}
		args["obs_file_list"] = []string{}
		args["goal_description"] = input.UserQuery
	case "design":
		args["obs_file_list"] = []string{}
		args["interop_mode"] = interopMode
		args["interop_targets"] = interopTargets
		args["resolve_gene_id"] = true
		if input.GeneID != "" || input.SpeciesCode != "" {
			if input.GeneID == "" || input.SpeciesCode == "" {
				return nil, fmt.Errorf("design resolver values require gene_id and species_code")
			}
			args["gene_id"] = input.GeneID
			args["species_code"] = input.SpeciesCode
		}
	case "network":
		args["obs_file_list"] = []string{}
		if input.ToID != "" || input.SpeciesCode != "" {
			if input.ToID == "" || input.SpeciesCode == "" {
				return nil, fmt.Errorf("network resolver values require to_id and species_code")
			}
			args["resolve_trait_id"] = true
			args["to_id"] = input.ToID
			args["species_code"] = input.SpeciesCode
		} else {
			args["resolve_to_id"] = true
		}
	case "deep_genome":
		args["resolve_gene_id"] = true
		if input.GeneID != "" || input.SpeciesCode != "" {
			if input.GeneID == "" || input.SpeciesCode == "" {
				return nil, fmt.Errorf("deep_genome resolver values require gene_id and species_code")
			}
			args["gene_id"] = input.GeneID
			args["species_code"] = input.SpeciesCode
		}
	default:
		if input.InteropMode != "" || len(input.InteropTargets) > 0 {
			return nil, fmt.Errorf("interop controls are not supported for %s", slug)
		}
	}
	return args, nil
}
