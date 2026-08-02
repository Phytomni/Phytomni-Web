package bot

import (
	"fmt"
	"regexp"
	"strings"
)

// AgentArgumentInput contains the Web-owned values that can be projected into
// one Bot native-run argument object. The gateway deliberately accepts only
// values it already owns (the query and server-managed dataset metadata); it
// does not invent dataset paths or accept arbitrary Bot arguments from the
// browser.
type AgentArgumentInput struct {
	UserQuery      string
	DataList       map[string]interface{}
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

func validOBSPath(path string) bool {
	if !strings.HasPrefix(path, "/obs/") || len(path) <= len("/obs/") {
		return false
	}
	if strings.ContainsAny(path, "\\\x00\r\n") || strings.Contains(path, "..") {
		return false
	}
	return true
}

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

func validateDataList(dataList map[string]interface{}) (map[string]interface{}, error) {
	copyData := make(map[string]interface{}, len(dataList))
	for path, description := range dataList {
		if !validOBSPath(path) {
			return nil, fmt.Errorf("data_list contains an invalid OBS path")
		}
		copyData[path] = description
	}
	return copyData, nil
}

// BuildAgentArguments projects validated Web input into the release-native
// argument shape for one agent run. It returns a fresh map and fresh slices so
// callers cannot mutate a payload after it has been handed to the Bot client.
func BuildAgentArguments(slug string, input AgentArgumentInput) (map[string]interface{}, error) {
	if _, ok := CanonicalAgentTool[slug]; !ok {
		return nil, fmt.Errorf("unknown agent slug %q", slug)
	}
	if strings.TrimSpace(input.UserQuery) == "" {
		return nil, fmt.Errorf("user query is required")
	}
	interopMode, interopTargets, err := validateInterop(input.InteropMode, input.InteropTargets)
	if err != nil {
		return nil, err
	}

	args := map[string]interface{}{"user_query": input.UserQuery}
	switch slug {
	case "research":
		args["obs_file_list"] = []string{}
		dataList, err := validateDataList(input.DataList)
		if err != nil {
			return nil, err
		}
		args["data_list"] = dataList
		args["interop_mode"] = interopMode
		args["interop_targets"] = interopTargets
	case "analyst":
		args["obs_file_list"] = []string{}
		dataList, err := validateDataList(input.DataList)
		if err != nil {
			return nil, err
		}
		args["goal_description"] = input.UserQuery
		args["data_list"] = dataList
	case "design":
		args["obs_file_list"] = []string{}
		if len(input.DataList) > 0 {
			return nil, fmt.Errorf("data_list is not supported for design")
		}
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
		if len(input.DataList) > 0 {
			return nil, fmt.Errorf("data_list is not supported for network")
		}
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
		if len(input.DataList) > 0 {
			return nil, fmt.Errorf("data_list is not supported for %s", slug)
		}
		if input.InteropMode != "" || len(input.InteropTargets) > 0 {
			return nil, fmt.Errorf("interop controls are not supported for %s", slug)
		}
	}
	return args, nil
}
