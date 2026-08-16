package api_handler

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/service/api_service"

	"github.com/gin-gonic/gin"
)

// TestQueryErrorStatus_ExpertDisabled pins the 503 mapping for a dark Expert
// gateway, distinct from the generic 500 fallthrough. Wrapped with %w so
// errors.Is resolves.
func TestQueryErrorStatus_ExpertDisabled(t *testing.T) {
	status, msg := queryErrorStatus(fmt.Errorf("dispatch: %w", api_service.ErrExpertDisabled))
	if status != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", status)
	}
	if msg != "expert mode not available" {
		t.Errorf("expected expert message, got %q", msg)
	}
}

func TestQueryInputForSurfaceClientTurnCompatibility(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name      string
		enabled   bool
		value     string
		surface   api_service.QuerySurface
		routeTool string
		mode      string
		formTool  string
		wantErr   bool
	}{
		{name: "v0 forced Research chat missing", enabled: false, surface: api_service.QuerySurfaceChat, mode: "expert", formTool: "InSilicoResearchAgent", wantErr: true},
		{name: "v0 forced Research chat malformed", enabled: false, value: "bad turn", surface: api_service.QuerySurfaceChat, mode: "expert", formTool: "InSilicoResearchAgent", wantErr: true},
		{name: "v0 forced Research chat valid", enabled: false, value: "turn-research-chat", surface: api_service.QuerySurfaceChat, mode: "expert", formTool: "InSilicoResearchAgent"},
		{name: "chat missing", enabled: false, surface: api_service.QuerySurfaceChat},
		{name: "v1 chat missing", enabled: true, surface: api_service.QuerySurfaceChat, wantErr: true},
		{name: "v1 chat malformed", enabled: true, value: "bad turn", surface: api_service.QuerySurfaceChat, wantErr: true},
		{name: "v1 chat oversized", enabled: true, value: strings.Repeat("a", 129), surface: api_service.QuerySurfaceChat, wantErr: true},
		{name: "v1 chat valid", enabled: true, value: "turn-1:retry_2", surface: api_service.QuerySurfaceChat},
		{name: "conversation V1 off Research product missing", enabled: false, surface: api_service.QuerySurfaceAgentProduct, routeTool: "InSilicoResearchAgent", wantErr: true},
		{name: "conversation V1 off Research product malformed", enabled: false, value: "bad turn", surface: api_service.QuerySurfaceAgentProduct, routeTool: "InSilicoResearchAgent", wantErr: true},
		{name: "conversation V1 off Research product valid", enabled: false, value: "turn-research-direct", surface: api_service.QuerySurfaceAgentProduct, routeTool: "InSilicoResearchAgent"},
		{name: "v1 Research product missing", enabled: true, surface: api_service.QuerySurfaceAgentProduct, routeTool: "InSilicoResearchAgent", wantErr: true},
		{name: "v1 Research product malformed", enabled: true, value: "bad turn", surface: api_service.QuerySurfaceAgentProduct, routeTool: "InSilicoResearchAgent", wantErr: true},
		{name: "v1 Research product valid", enabled: true, value: "turn-research-retry", surface: api_service.QuerySurfaceAgentProduct, routeTool: "InSilicoResearchAgent"},
		{name: "v1 design product remains compatible", enabled: true, surface: api_service.QuerySurfaceAgentProduct, routeTool: "DigitalDesignAgent"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{}
			rxBot.SetConversationContextV1Advertised(tc.enabled)
			t.Cleanup(func() {
				rxBot.BotConfig = previous
				rxBot.SetConversationContextV1Advertised(false)
			})

			form := url.Values{
				"query":          {"hello"},
				"client_turn_id": {tc.value},
				"mode":           {tc.mode},
				"tool":           {tc.formTool},
			}
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/v1/conversations/0/messages",
				strings.NewReader(form.Encode()),
			)
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = request

			input := queryInputForSurface(ctx, tc.surface, tc.routeTool)
			err := validateQueryClientTurn(input)
			if (err != nil) != tc.wantErr {
				t.Fatalf("validateQueryClientTurn() error = %v, wantErr %v", err, tc.wantErr)
			}
			if input.ClientTurnID != strings.TrimSpace(tc.value) {
				t.Fatalf("client_turn_id = %q, want %q", input.ClientTurnID, strings.TrimSpace(tc.value))
			}
		})
	}
}

func TestAgentProductResolver(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name        string
		surface     api_service.QuerySurface
		routeTool   string
		fields      url.Values
		wantGeneID  string
		wantToID    string
		wantSpecies string
		wantErr     bool
	}{
		{name: "design absent", surface: api_service.QuerySurfaceAgentProduct, routeTool: "DigitalDesignAgent"},
		{name: "design normalizes pair", surface: api_service.QuerySurfaceAgentProduct, routeTool: "DigitalDesignAgent", fields: url.Values{"gene_id": {" AT1G01010 "}, "species_code": {" ATH "}}, wantGeneID: "AT1G01010", wantSpecies: "ath"},
		{name: "network absent", surface: api_service.QuerySurfaceAgentProduct, routeTool: "GeneNetworkAgent"},
		{name: "network normalizes pair", surface: api_service.QuerySurfaceAgentProduct, routeTool: "GeneNetworkAgent", fields: url.Values{"to_id": {" to:0000207 "}, "species_code": {" OSA "}}, wantToID: "TO:0000207", wantSpecies: "osa"},
		{name: "network defaults bare trait to rice", surface: api_service.QuerySurfaceAgentProduct, routeTool: "GeneNetworkAgent", fields: url.Values{"to_id": {"TO:0000207"}}, wantToID: "TO:0000207", wantSpecies: "osa"},
		{name: "network defaults blank species to rice", surface: api_service.QuerySurfaceAgentProduct, routeTool: "GeneNetworkAgent", fields: url.Values{"to_id": {"TO:0000207"}, "species_code": {"  "}}, wantToID: "TO:0000207", wantSpecies: "osa"},
		{name: "design missing species", surface: api_service.QuerySurfaceAgentProduct, routeTool: "DigitalDesignAgent", fields: url.Values{"gene_id": {"AT1G01010"}}, wantErr: true},
		{name: "network missing trait", surface: api_service.QuerySurfaceAgentProduct, routeTool: "GeneNetworkAgent", fields: url.Values{"species_code": {"ath"}}, wantErr: true},
		{name: "network rejects gene", surface: api_service.QuerySurfaceAgentProduct, routeTool: "GeneNetworkAgent", fields: url.Values{"gene_id": {"AT1G01010"}, "species_code": {"ath"}}, wantErr: true},
		{name: "design rejects trait", surface: api_service.QuerySurfaceAgentProduct, routeTool: "DigitalDesignAgent", fields: url.Values{"to_id": {"TO:0000207"}, "species_code": {"ath"}}, wantErr: true},
		{name: "research rejects resolver", surface: api_service.QuerySurfaceAgentProduct, routeTool: "InSilicoResearchAgent", fields: url.Values{"gene_id": {"AT1G01010"}}, wantErr: true},
		{name: "chat rejects resolver", surface: api_service.QuerySurfaceChat, fields: url.Values{"gene_id": {"AT1G01010"}}, wantErr: true},
		{name: "design rejects malformed gene", surface: api_service.QuerySurfaceAgentProduct, routeTool: "DigitalDesignAgent", fields: url.Values{"gene_id": {"bad gene"}, "species_code": {"ath"}}, wantErr: true},
		{name: "network rejects malformed trait", surface: api_service.QuerySurfaceAgentProduct, routeTool: "GeneNetworkAgent", fields: url.Values{"to_id": {"TO:0001"}, "species_code": {"ath"}}, wantErr: true},
		{name: "network rejects unsupported trait", surface: api_service.QuerySurfaceAgentProduct, routeTool: "GeneNetworkAgent", fields: url.Values{"to_id": {"TO:9999999"}, "species_code": {"ath"}}, wantErr: true},
		{name: "network rejects species", surface: api_service.QuerySurfaceAgentProduct, routeTool: "GeneNetworkAgent", fields: url.Values{"to_id": {"TO:0000207"}, "species_code": {"wht"}}, wantErr: true},
		{name: "design rejects species", surface: api_service.QuerySurfaceAgentProduct, routeTool: "DigitalDesignAgent", fields: url.Values{"gene_id": {"AT1G01010"}, "species_code": {"1ath"}}, wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/query", strings.NewReader(tc.fields.Encode()))
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = request

			geneID, toID, speciesCode, err := parseAgentProductResolver(ctx, tc.surface, tc.routeTool)
			if (err != nil) != tc.wantErr {
				t.Fatalf("parseAgentProductResolver() error = %v, wantErr %v", err, tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			got := api_service.QueryInput{GeneID: geneID, ToID: toID, SpeciesCode: speciesCode}
			if got.GeneID != tc.wantGeneID || got.ToID != tc.wantToID || got.SpeciesCode != tc.wantSpecies {
				t.Fatalf("resolver QueryInput = %#v; want gene_id=%q to_id=%q species_code=%q", got, tc.wantGeneID, tc.wantToID, tc.wantSpecies)
			}
		})
	}
}
