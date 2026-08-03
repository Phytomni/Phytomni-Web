package bot

import (
	"reflect"
	"testing"
)

func TestBuildAgentArgumentsAnalystAndResearchUseCanonicalEmptyFiles(t *testing.T) {
	for _, slug := range []string{"analyst", "research"} {
		t.Run(slug, func(t *testing.T) {
			got, err := BuildAgentArguments(slug, AgentArgumentInput{UserQuery: "run"})
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got["data_list"], map[string]string{}) {
				t.Fatalf("%s data_list=%#v", slug, got["data_list"])
			}
			if !reflect.DeepEqual(got["obs_file_list"], []string{}) {
				t.Fatalf("%s obs_file_list=%#v", slug, got["obs_file_list"])
			}
		})
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
		"obs_file_list":   []string{},
		"resolve_gene_id": true,
		"gene_id":         "AT1G01010",
		"species_code":    "ath",
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
		"obs_file_list":    []string{},
		"resolve_trait_id": true,
		"to_id":            "TO:0000207",
		"species_code":     "osa",
	}
	if !reflect.DeepEqual(network, wantNetwork) {
		t.Fatalf("network=%#v want=%#v", network, wantNetwork)
	}
}

func TestBuildAgentArgumentsCanonicalEmptyFilesAreFresh(t *testing.T) {
	first, err := BuildAgentArguments("analyst", AgentArgumentInput{UserQuery: "first"})
	if err != nil {
		t.Fatal(err)
	}
	first["data_list"].(map[string]string)["obs://mutated"] = "mutated"
	first["obs_file_list"] = append(first["obs_file_list"].([]string), "obs://mutated")

	second, err := BuildAgentArguments("analyst", AgentArgumentInput{UserQuery: "second"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(second["data_list"], map[string]string{}) {
		t.Fatalf("second data_list=%#v", second["data_list"])
	}
	if !reflect.DeepEqual(second["obs_file_list"], []string{}) {
		t.Fatalf("second obs_file_list=%#v", second["obs_file_list"])
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
