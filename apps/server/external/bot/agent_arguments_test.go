package bot

import (
	"reflect"
	"strings"
	"testing"
)

func TestBuildAgentArgumentsResearchDefaultsToLocalEmptyDataset(t *testing.T) {
	got, err := BuildAgentArguments("research", AgentArgumentInput{
		UserQuery:   "paper",
		OBSFileList: []string{"/obs/bucket/paper.pdf"},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]interface{}{
		"user_query":      "paper",
		"data_list":       map[string]interface{}{},
		"obs_file_list":   []string{"/obs/bucket/paper.pdf"},
		"interop_mode":    "off",
		"interop_targets": []string{},
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
	if design["resolve_gene_id"] != true || design["gene_id"] != "AT1G01010" {
		t.Fatalf("design=%#v", design)
	}

	network, err := BuildAgentArguments("network", AgentArgumentInput{
		UserQuery: "network", ToID: "TO:0001", SpeciesCode: "ath",
	})
	if err != nil {
		t.Fatal(err)
	}
	if network["resolve_trait_id"] != true || network["to_id"] != "TO:0001" {
		t.Fatalf("network=%#v", network)
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
		{name: "non OBS attachment", slug: "research", input: AgentArgumentInput{
			UserQuery: "q", OBSFileList: []string{"/tmp/paper.pdf"},
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
