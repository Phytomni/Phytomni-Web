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
		name    string
		enabled bool
		value   string
		wantErr bool
	}{
		{name: "v0 missing", enabled: false},
		{name: "v0 malformed remains compatible", enabled: false, value: "bad turn"},
		{name: "v1 missing", enabled: true, wantErr: true},
		{name: "v1 malformed", enabled: true, value: "bad turn", wantErr: true},
		{name: "v1 oversized", enabled: true, value: strings.Repeat("a", 129), wantErr: true},
		{name: "v1 valid", enabled: true, value: "turn-1:retry_2"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{MultiturnV1Enabled: tc.enabled}
			t.Cleanup(func() { rxBot.BotConfig = previous })

			form := url.Values{
				"query":          {"hello"},
				"client_turn_id": {tc.value},
			}
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/v1/conversations/0/messages",
				strings.NewReader(form.Encode()),
			)
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = request

			input := queryInputForSurface(ctx, api_service.QuerySurfaceChat, "")
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
