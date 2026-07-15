package api_handler

import (
	"errors"
	"net/http"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/service/api_service"
)

func TestA2uiAction_UpstreamErrorsMap502(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{name: "invalid upstream protocol", err: api_service.ErrA2uiUpstreamProtocol},
		{name: "oversize upstream response", err: rxBot.ErrA2uiResponseTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, ok := a2uiActionUpstreamStatus(tt.err)
			if !ok {
				t.Fatal("upstream error was not classified")
			}
			if status != http.StatusBadGateway {
				t.Fatalf("status = %d, want %d", status, http.StatusBadGateway)
			}
		})
	}

	if _, ok := a2uiActionUpstreamStatus(errors.New("unrelated")); ok {
		t.Fatal("unrelated error classified as upstream failure")
	}
}
