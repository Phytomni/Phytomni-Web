package bot

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateAssetAttachmentRefsBoundsAndOrder(t *testing.T) {
	valid := []AssetAttachmentRef{{AssetID: "file_first"}, {AssetID: "file_second"}}
	got, err := ValidateAssetAttachmentRefs(valid)
	if err != nil {
		t.Fatalf("valid refs rejected: %v", err)
	}
	if len(got) != len(valid) || got[0].AssetID != "file_first" || got[1].AssetID != "file_second" {
		t.Fatalf("refs=%#v, want ordered copy of %#v", got, valid)
	}
	got[0].AssetID = "file_mutated"
	if valid[0].AssetID != "file_first" {
		t.Fatal("validator returned an aliased slice")
	}

	tests := []struct {
		name string
		refs []AssetAttachmentRef
	}{
		{name: "duplicate", refs: []AssetAttachmentRef{{AssetID: "file_a"}, {AssetID: "file_a"}}},
		{name: "bad prefix", refs: []AssetAttachmentRef{{AssetID: "asset_a"}}},
		{name: "empty suffix", refs: []AssetAttachmentRef{{AssetID: "file_"}}},
		{name: "overlong", refs: []AssetAttachmentRef{{AssetID: "file_" + strings.Repeat("a", 124)}}},
		{name: "too many", refs: func() []AssetAttachmentRef {
			refs := make([]AssetAttachmentRef, MaxAssetAttachmentRefs+1)
			for i := range refs {
				refs[i].AssetID = "file_" + string(rune('a'+i))
			}
			return refs
		}()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got, err := ValidateAssetAttachmentRefs(tt.refs); err == nil || got != nil {
				t.Fatalf("refs=%#v accepted as %#v, err=%v", tt.refs, got, err)
			}
		})
	}
}

func TestBotRequestFamiliesSerializeReferenceOnlyAttachments(t *testing.T) {
	refs := []AssetAttachmentRef{{AssetID: "file_reads"}, {AssetID: "file_variants"}}
	tests := []struct {
		name  string
		value interface{}
	}{
		{
			name: "chat",
			value: ChatCompletionRequest{
				Model: "phyto-chat", Attachments: refs, OwnerSubject: "alice@example.com", DatasetDescription: "normalized dataset context",
			},
		},
		{
			name: "route",
			value: RouteQueryRequest{
				UserQuery: "analyze", Attachments: refs, OwnerSubject: "alice@example.com", DatasetDescription: "normalized dataset context",
			},
		},
		{
			name: "agent",
			value: AgentRunRequest{
				Arguments:          map[string]interface{}{"user_query": "analyze"},
				Attachments:        refs,
				OwnerSubject:       "alice@example.com",
				DatasetDescription: "normalized dataset context",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := json.Marshal(tt.value)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var decoded map[string]interface{}
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if decoded["owner_subject"] != "alice@example.com" {
				t.Fatalf("owner_subject=%v, want authenticated owner", decoded["owner_subject"])
			}
			if decoded["dataset_description"] != "normalized dataset context" {
				t.Fatalf("dataset_description=%v, want normalized structured value", decoded["dataset_description"])
			}
			if _, ok := decoded["obs_file_list"]; ok {
				t.Fatalf("request serialized legacy OBS paths: %s", raw)
			}
			if !strings.Contains(string(raw), `"attachments"`) || !strings.Contains(string(raw), `file_reads`) {
				t.Fatalf("request omitted asset references: %s", raw)
			}
		})
	}
}

func TestBotRequestFamiliesOmitEmptyDatasetDescription(t *testing.T) {
	tests := map[string]interface{}{
		"chat":  ChatCompletionRequest{Model: "phyto-chat"},
		"route": RouteQueryRequest{UserQuery: "analyze"},
		"agent": AgentRunRequest{Arguments: map[string]interface{}{"user_query": "analyze"}},
	}
	for name, value := range tests {
		t.Run(name, func(t *testing.T) {
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var decoded map[string]interface{}
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if _, ok := decoded["dataset_description"]; ok {
				t.Fatalf("empty dataset description serialized: %s", raw)
			}
		})
	}
}
