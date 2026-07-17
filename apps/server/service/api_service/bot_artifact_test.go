package api_service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestProjectArtifactsRejectPrivateAndMalformedPaths(t *testing.T) {
	got := ProjectArtifacts([]string{"/obs/bucket/user/output.zip", "http://private/secret", "../escape", ""})
	if len(got) != 1 || got[0].Path != "/obs/bucket/user/output.zip" {
		t.Fatalf("artifacts=%#v", got)
	}
}

func TestProjectArtifactsCarriesBoundedProvenance(t *testing.T) {
	got := ProjectOwnedArtifacts(
		"run-1",
		"alice",
		[]string{"/obs/bucket/user/output.zip", "/obs/bucket/user/report.pdf"},
	)
	if len(got) != 2 {
		t.Fatalf("artifacts=%#v", got)
	}
	if got[0].RunID != "run-1" || got[0].UserName != "alice" {
		t.Fatalf("provenance=%#v", got[0])
	}
	if got[0].DisplayName != "output.zip" || got[0].Origin != "bot" || got[0].Kind != "zip" {
		t.Fatalf("display metadata=%#v", got[0])
	}
	if got[0].DownloadAction == "" {
		t.Fatal("missing server download action")
	}
}

func TestProjectOwnedArtifactsOmitsInternalProvenanceFromJSON(t *testing.T) {
	payload, err := json.Marshal(ProjectOwnedArtifacts(
		"run-1",
		"alice@example.com",
		[]string{"/obs/bucket/user/output.zip"},
	))
	if err != nil {
		t.Fatalf("marshal artifacts: %v", err)
	}
	encoded := string(payload)
	if strings.Contains(encoded, "alice@example.com") || strings.Contains(encoded, "/obs/") {
		t.Fatalf("internal provenance leaked into browser DTO: %s", encoded)
	}
}

func TestDownloadAnalystAgentObsFileRejectsMalformedPathBeforeLookup(t *testing.T) {
	setupTestDB(t)
	if _, err := NewService().DownloadAnalystAgentObsFile(context.Background(), "alice", "http://private/secret"); err == nil {
		t.Fatal("expected malformed path to be rejected")
	}
}

func TestDownloadAnalystAgentObsImagesRejectsMalformedPathBeforeLookup(t *testing.T) {
	setupTestDB(t)
	if _, err := NewService().DownloadAnalystAgentObsImages(context.Background(), "alice", "../escape"); err == nil {
		t.Fatal("expected malformed path to be rejected")
	}
}
