package bot

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestAgentDescriptorDecodesExecutionEventCapability(t *testing.T) {
	raw := []byte(`{
		"object":"list",
		"data":[{
			"slug":"chat",
			"tool":"ChatAgent",
			"origin":"native",
			"capabilities":{
				"attachments":{},
				"artifacts":false,
				"streaming":true,
				"execution_events":{
					"major_version":1,
					"resumable_history":true,
					"custom_event":"phyto.run_event",
					"target_kinds":["event","artifact","report","todo","preview","download","trace"]
				},
				"work_trace":{
					"major_version":1,
					"state":"supported",
					"features":{
						"lifecycle":"supported",
						"semantic_phases":"supported",
						"semantic_tools":"supported",
						"public_reasoning":"supported",
						"trace_target":"supported"
					},
					"target":{"kind":"trace","major_version":1},
					"detail_endpoint":"/v2/executions/{execution_id}/targets/trace/{target_id}"
				}
			}
		}]
	}`)
	var response AgentsListResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatal(err)
	}
	got := response.Data[0].Capabilities.ExecutionEvents
	if got.MajorVersion != 1 || !got.ResumableHistory || got.CustomEvent != "phyto.run_event" {
		t.Fatalf("unexpected execution-event capability: %#v", got)
	}
	wantTargets := []string{"event", "artifact", "report", "todo", "preview", "download", "trace"}
	if !reflect.DeepEqual(got.TargetKinds, wantTargets) {
		t.Fatalf("target kinds = %#v, want %#v", got.TargetKinds, wantTargets)
	}
	workTrace := response.Data[0].Capabilities.WorkTrace
	if !SupportsAgentWorkTraceV1(workTrace) || workTrace.Features.PublicReasoning != "supported" {
		t.Fatalf("unexpected work-trace capability: %#v", workTrace)
	}
}

func TestAgentWorkTraceCapabilityFailsClosedForMissingAndUnknownContracts(t *testing.T) {
	for name, capability := range map[string]AgentDescriptorWorkTrace{
		"missing": {},
		"unknown version": {
			MajorVersion: 2, State: "supported",
			Features: AgentDescriptorWorkTraceFeatures{
				Lifecycle: "supported", SemanticPhases: "supported",
				SemanticTools: "supported", PublicReasoning: "supported", TraceTarget: "supported",
			},
			Target: &AgentDescriptorWorkTraceTarget{Kind: "trace", MajorVersion: 1},
		},
		"unknown state": {
			MajorVersion: 1, State: "future",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if SupportsAgentWorkTraceV1(capability) {
				t.Fatalf("unsupported capability was enabled: %#v", capability)
			}
		})
	}
}
