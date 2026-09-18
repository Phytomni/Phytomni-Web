package bot

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestDecodeRunExecutionDeliveryRetainsScientificReport(t *testing.T) {
	raw := encodeDeliveryPayload(t, map[string]interface{}{
		"report": map[string]interface{}{"state": "degraded", "degraded": true, "source_artifact_count": 3},
		"warnings": []interface{}{
			map[string]interface{}{"code": "report_synthesis_failed", "message": "private diagnostic", "stage": "report"},
			map[string]interface{}{"code": "unknown_private_warning", "message": "private diagnostic"},
			map[string]interface{}{"code": "report_synthesis_failed"},
		},
		"tracking":    map[string]interface{}{"degraded": false},
		"output_dirs": []string{"obs://bucket/owner/run"},
		"delivery":    readyDeliveryPayload("design"),
	})
	got, err := DecodeRunExecutionDelivery(raw, "design")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var retained struct {
		Report *struct {
			State               string `json:"state"`
			Degraded            bool   `json:"degraded"`
			SourceArtifactCount int64  `json:"source_artifact_count"`
		}
		ReportWarningCodes []string
	}
	if err := json.Unmarshal(encoded, &retained); err != nil {
		t.Fatal(err)
	}
	if retained.Report == nil || retained.Report.State != "degraded" || !retained.Report.Degraded || retained.Report.SourceArtifactCount != 3 {
		t.Fatalf("scientific report facts lost: %s", encoded)
	}
	if !reflect.DeepEqual(retained.ReportWarningCodes, []string{"report_synthesis_failed"}) {
		t.Fatalf("unexpected warnings: %#v", retained.ReportWarningCodes)
	}
	if got.TrackingDegraded || got.Delivery == nil || got.Delivery.Status != "ready" {
		t.Fatalf("report changed tracking/delivery: %#v", got)
	}
	if strings.Contains(string(encoded), "private") {
		t.Fatal("private warning text crossed projection boundary")
	}
}

func TestDecodeRunExecutionDeliveryRejectsMalformedReport(t *testing.T) {
	cases := []string{
		`{"report":[]}`,
		`{"report":{"state":"complete","degraded":false,"source_artifact_count":0}}`,
		`{"report":{"state":"final","degraded":"false","source_artifact_count":0}}`,
		`{"report":{"state":"final","degraded":false,"source_artifact_count":-1}}`,
		`{"report":{"state":"final","degraded":false,"source_artifact_count":1.5}}`,
		`{"report":{"state":"final","degraded":false,"source_artifact_count":9007199254740992}}`,
		`{"report":{"state":"final"}}`,
		`{"report":{"state":"final","state":"degraded","degraded":false,"source_artifact_count":0}}`,
		`{"warnings":{}}`,
		`{"warnings":[null]}`,
		`{"warnings":[{"code":3}]}`,
		`{"warnings":[{"code":"report_synthesis_failed","code":"private"}]}`,
		`{"warnings":[` + strings.Repeat(`{"code":"report_synthesis_failed"},`, MaxProjectionArtifactCount) + `{"code":"report_synthesis_failed"}]}`,
	}
	for _, raw := range cases {
		t.Run(raw[:min(len(raw), 90)], func(t *testing.T) {
			if _, err := DecodeRunExecutionDelivery(json.RawMessage(raw), "design"); err == nil {
				t.Fatal("malformed scientific metadata accepted")
			}
		})
	}
}

func TestDecodeRunExecutionDeliveryReportPresenceAndStates(t *testing.T) {
	for _, state := range []string{"none", "intermediate", "final", "degraded"} {
		t.Run(state, func(t *testing.T) {
			raw := encodeDeliveryPayload(t, map[string]interface{}{
				"report": map[string]interface{}{
					"state": state, "degraded": state == "degraded",
					"source_artifact_count": MaxProjectionProgressCounter,
				},
				"warnings": []interface{}{},
			})
			got, err := DecodeRunExecutionDelivery(raw, "deep_genome")
			if err != nil || got.Report == nil || got.Report.State != state {
				t.Fatalf("report state lost: %#v, %v", got, err)
			}
			if got.ReportWarningCodes == nil || len(got.ReportWarningCodes) != 0 {
				t.Fatal("explicit warning clear must survive decoding")
			}
		})
	}
	for _, raw := range []string{`{}`, `{"report":null,"warnings":null}`} {
		got, err := DecodeRunExecutionDelivery(json.RawMessage(raw), "design")
		if err != nil || got.Report != nil || got.ReportWarningCodes != nil {
			t.Fatalf("missing report is not an explicit empty report: %#v, %v", got, err)
		}
	}
}
