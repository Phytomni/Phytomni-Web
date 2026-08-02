package bot

import (
	"reflect"
	"strings"
	"testing"
)

func TestBuildAgentArgumentsResearchDefaultsToLocalEmptyDataset(t *testing.T) {
	got, err := BuildAgentArguments("research", AgentArgumentInput{
		UserQuery: "paper",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]interface{}{
		"user_query":      "paper",
		"data_list":       map[string]interface{}{},
		"interop_mode":    "off",
		"interop_targets": []string{},
		"obs_file_list":   []string{},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("payload=%#v want=%#v", got, want)
	}
}

func TestBuildAgentArgumentsDesignAndNetworkUseResolverFields(t *testing.T) {
	design, err := BuildAgentArguments("design", AgentArgumentInput{
		UserQuery: "design", GeneID: "AT1G01010", SpeciesCode: "ath",
	})
	if err != nil {
		t.Fatal(err)
	}
	wantDesign := map[string]interface{}{
		"user_query":      "design",
		"interop_mode":    "off",
		"interop_targets": []string{},
		"resolve_gene_id": true,
		"gene_id":         "AT1G01010",
		"species_code":    "ath",
		"obs_file_list":   []string{},
	}
	if !reflect.DeepEqual(design, wantDesign) {
		t.Fatalf("design=%#v want=%#v", design, wantDesign)
	}

	network, err := BuildAgentArguments("network", AgentArgumentInput{
		UserQuery: "network", ToID: "TO:0000207", SpeciesCode: "osa",
	})
	if err != nil {
		t.Fatal(err)
	}
	wantNetwork := map[string]interface{}{
		"user_query":       "network",
		"resolve_trait_id": true,
		"to_id":            "TO:0000207",
		"species_code":     "osa",
		"obs_file_list":    []string{},
	}
	if !reflect.DeepEqual(network, wantNetwork) {
		t.Fatalf("network=%#v want=%#v", network, wantNetwork)
	}
}

func TestBuildAgentArgumentsBackgroundUsesFreshEmptyOBSFileList(t *testing.T) {
	for _, slug := range []string{"analyst", "research", "network", "design"} {
		t.Run(slug, func(t *testing.T) {
			first, err := BuildAgentArguments(slug, AgentArgumentInput{UserQuery: "run"})
			if err != nil {
				t.Fatal(err)
			}
			files, ok := first["obs_file_list"].([]string)
			if !ok || files == nil || len(files) != 0 {
				t.Fatalf("obs_file_list=%#v, want non-nil empty []string", first["obs_file_list"])
			}
			first["obs_file_list"] = append(files, "mutated")

			second, err := BuildAgentArguments(slug, AgentArgumentInput{UserQuery: "run"})
			if err != nil {
				t.Fatal(err)
			}
			if files, ok := second["obs_file_list"].([]string); !ok || files == nil || len(files) != 0 {
				t.Fatalf("fresh obs_file_list=%#v, want non-nil empty []string", second["obs_file_list"])
			}
		})
	}
}

func TestBuildAgentArgumentsDeepGenomePreservesResolverFlag(t *testing.T) {
	got, err := BuildAgentArguments("deep_genome", AgentArgumentInput{UserQuery: "gene"})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]interface{}{
		"user_query":      "gene",
		"resolve_gene_id": true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("payload=%#v want=%#v", got, want)
	}
}

func TestBuildAgentArgumentsRejectsUntrustedInput(t *testing.T) {
	tests := []struct {
		name  string
		slug  string
		input AgentArgumentInput
	}{
		{name: "unknown slug", slug: "unknown", input: AgentArgumentInput{UserQuery: "q"}},
		{name: "empty query", slug: "research", input: AgentArgumentInput{}},
		{name: "unsupported dataset path", slug: "research", input: AgentArgumentInput{
			UserQuery: "q", DataList: map[string]interface{}{`/tmp/paper.pdf`: "dataset"},
		}},
		{name: "invalid interop mode", slug: "research", input: AgentArgumentInput{
			UserQuery: "q", InteropMode: "always",
		}},
		{name: "target outside allowlist", slug: "research", input: AgentArgumentInput{
			UserQuery: "q", InteropTargets: []string{"https://attacker.example"},
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := BuildAgentArguments(tt.slug, tt.input); err == nil {
				t.Fatal("BuildAgentArguments unexpectedly accepted invalid input")
			}
		})
	}
}

func TestBuildAgentArgumentsRejectsInvalidDatasetPath(t *testing.T) {
	_, err := BuildAgentArguments("research", AgentArgumentInput{
		UserQuery: "q",
		DataList:  map[string]interface{}{strings.TrimSpace("relative.tsv"): "dataset"},
	})
	if err == nil {
		t.Fatal("expected invalid dataset path to be rejected")
	}
}
