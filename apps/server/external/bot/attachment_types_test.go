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
				Model: "phyto-chat", Attachments: refs, OwnerSubject: "alice@example.com",
			},
		},
		{
			name: "route",
			value: RouteQueryRequest{
				UserQuery: "analyze", Attachments: refs, OwnerSubject: "alice@example.com",
			},
		},
		{
			name: "agent",
			value: AgentRunRequest{
				Arguments:    map[string]interface{}{"user_query": "analyze"},
				Attachments:  refs,
				OwnerSubject: "alice@example.com",
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
			if _, leaked := decoded["dataset_description"]; leaked {
				t.Fatalf("request serialized obsolete dataset_description: %s", raw)
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

func TestBotRequestFamiliesOmitDatasetDescriptionUnconditionally(t *testing.T) {
	tests := map[string]struct {
		value interface{}
	}{
		"chat":  {value: &ChatCompletionRequest{}},
		"route": {value: &RouteQueryRequest{}},
		"agent": {value: &AgentRunRequest{}},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			if err := json.Unmarshal([]byte(`{"dataset_description":"obsolete"}`), test.value); err != nil {
				t.Fatalf("decode crafted request: %v", err)
			}
			raw, err := json.Marshal(test.value)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var decoded map[string]interface{}
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if _, ok := decoded["dataset_description"]; ok {
				t.Fatalf("dataset description serialized: %s", raw)
			}
		})
	}
}
