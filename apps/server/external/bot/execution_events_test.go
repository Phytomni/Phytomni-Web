package bot

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type executionEventFixtures struct {
	Contract struct {
		SchemaVersion     int                    `json:"schema_version"`
		EventKinds        []string               `json:"event_kinds"`
		TargetKinds       []string               `json:"target_kinds"`
		Limits            ExecutionEventLimitsV1 `json:"limits"`
		ExecutionIdentity struct {
			SourceField             string `json:"source_field"`
			PublicField             string `json:"public_field"`
			TransportHeader         string `json:"transport_header"`
			OpaquePattern           string `json:"opaque_pattern"`
			StableRetry             string `json:"stable_retry"`
			Replacement             string `json:"replacement"`
			SecondClientUUIDAllowed bool   `json:"second_client_uuid_allowed"`
		} `json:"execution_identity"`
	} `json:"contract"`
	BaseEvent          map[string]any `json:"base_event"`
	ValidEvents        []fixtureCase  `json:"valid_events"`
	Projection         map[string]any `json:"projection"`
	IgnorableExtension map[string]any `json:"ignorable_extension"`
	InvalidEvents      []fixtureCase  `json:"invalid_events"`
}

type fixtureCase struct {
	Name   string         `json:"name"`
	Event  map[string]any `json:"event"`
	Reason string         `json:"reason"`
}

func loadExecutionEventFixtures(t *testing.T) executionEventFixtures {
	t.Helper()
	path := filepath.Join(
		"..", "..", "..", "..", "docs", "reference",
		"execution-events.v1.fixtures.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read execution-event fixtures: %v", err)
	}
	var fixtures executionEventFixtures
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatalf("decode execution-event fixtures: %v", err)
	}
	return fixtures
}

func fixtureEvent(
	t *testing.T,
	fixtures executionEventFixtures,
	override map[string]any,
	index int,
) []byte {
	t.Helper()
	event := make(map[string]any, len(fixtures.BaseEvent)+len(override))
	for key, value := range fixtures.BaseEvent {
		event[key] = value
	}
	for key, value := range override {
		event[key] = value
	}
	event["seq"] = index
	event["event_id"] = "evt-fixture"
	event["idempotency_key"] = "fixture:event"
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("encode fixture event: %v", err)
	}
	return raw
}

func TestExecutionEventFixtureCoversFiniteVocabulary(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	got := append([]string(nil), KnownExecutionEventKinds...)
	if !reflect.DeepEqual(got, fixtures.Contract.EventKinds) {
		t.Fatalf("event kinds drift:\n got: %#v\nwant: %#v", got, fixtures.Contract.EventKinds)
	}
}

func TestExecutionEventLimitsMatchSharedContract(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	if !reflect.DeepEqual(DefaultExecutionEventLimits, fixtures.Contract.Limits) {
		t.Fatalf(
			"execution event limits drift:\n got: %#v\nwant: %#v",
			DefaultExecutionEventLimits,
			fixtures.Contract.Limits,
		)
	}
}

func TestExecutionIdentityMatchesSharedContract(t *testing.T) {
	identity := loadExecutionEventFixtures(t).Contract.ExecutionIdentity
	if identity.SourceField != "client_turn_id" ||
		identity.PublicField != "execution_id" ||
		identity.TransportHeader != "X-Phyto-Execution-Id" ||
		identity.OpaquePattern != `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` ||
		identity.StableRetry != "same_fingerprint" ||
		identity.Replacement != "new_identity" || identity.SecondClientUUIDAllowed {
		t.Fatalf("execution identity contract drift: %#v", identity)
	}
}

func TestParseExecutionEventV1AcceptsEverySharedFixture(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	for index, fixture := range fixtures.ValidEvents {
		t.Run(fixture.Name, func(t *testing.T) {
			raw := fixtureEvent(t, fixtures, fixture.Event, index+1)
			event, err := ParseExecutionEventV1(raw)
			if err != nil {
				t.Fatalf("parse valid fixture: %v", err)
			}
			if event.Seq != int64(index+1) || !event.IsKnown() {
				t.Fatalf("unexpected decoded event: %#v", event)
			}
		})
	}
}

func TestParseExecutionEventV1PreservesIgnorableExtensionCursor(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	raw := fixtureEvent(t, fixtures, fixtures.IgnorableExtension, 22)
	event, err := ParseExecutionEventV1(raw)
	if err != nil {
		t.Fatalf("parse ignorable fixture: %v", err)
	}
	if event.Seq != 22 || !event.Ignorable || event.IsKnown() {
		t.Fatalf("unexpected extension event: %#v", event)
	}
}

func TestParseRunEventProjectionV1AcceptsSharedFixture(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	raw, err := json.Marshal(fixtures.Projection)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := ParseRunEventProjectionV1(raw)
	if err != nil {
		t.Fatalf("parse projection fixture: %v", err)
	}
	if projection.LatestSeq != 21 || len(projection.Results) != 1 {
		t.Fatalf("unexpected projection: %#v", projection)
	}
}

func TestParseExecutionEventPageV1ValidatesItemsAndCursor(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	first := json.RawMessage(fixtureEvent(t, fixtures, fixtures.ValidEvents[0].Event, 1))
	second := json.RawMessage(fixtureEvent(t, fixtures, fixtures.ValidEvents[1].Event, 2))
	raw, err := json.Marshal(map[string]any{
		"schema_version": 1,
		"run_id":         "run-fixture",
		"items":          []json.RawMessage{first, second},
		"next_after_seq": 2,
		"has_more":       false,
	})
	if err != nil {
		t.Fatal(err)
	}
	page, err := ParseExecutionEventPageV1(raw)
	if err != nil || len(page.Items) != 2 || page.NextAfterSeq != 2 {
		t.Fatalf("page=%#v err=%v", page, err)
	}

	var invalid map[string]any
	if err := json.Unmarshal(raw, &invalid); err != nil {
		t.Fatal(err)
	}
	invalid["next_after_seq"] = 99
	bad, _ := json.Marshal(invalid)
	if _, err := ParseExecutionEventPageV1(bad); err == nil {
		t.Fatal("expected mismatched cursor to fail")
	}
}

func TestParseExecutionEventV1AcceptsExplicitZeroUTCOffset(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	var event map[string]any
	if err := json.Unmarshal(fixtureEvent(t, fixtures, fixtures.ValidEvents[0].Event, 1), &event); err != nil {
		t.Fatal(err)
	}
	event["occurred_at"] = "2026-08-19T04:35:03.819595+00:00"
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseExecutionEventV1(raw); err != nil {
		t.Fatalf("explicit RFC3339 UTC offset was rejected: %v", err)
	}
}

func TestParseExecutionEventV1RejectsInvalidSharedFixtures(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	for _, fixture := range fixtures.InvalidEvents {
		t.Run(fixture.Name, func(t *testing.T) {
			raw := fixtureEvent(t, fixtures, fixture.Event, 1)
			_, err := ParseExecutionEventV1(raw)
			if err == nil || !strings.Contains(err.Error(), fixture.Reason) {
				t.Fatalf("got error %v, want reason %q", err, fixture.Reason)
			}
		})
	}
}

func TestParseExecutionEventV1RejectsSensitiveValuesInAllowedFields(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	tests := []struct {
		name     string
		override map[string]any
		reason   string
	}{
		{
			name: "credential value",
			override: map[string]any{
				"kind": "decision.note", "payload": map[string]any{"text": "password=hunter2"},
			},
			reason: "forbidden_public_value",
		},
		{
			name: "authorization value",
			override: map[string]any{
				"kind": "reasoning.summary", "payload": map[string]any{"text": "Bearer private-token"},
			},
			reason: "forbidden_public_value",
		},
		{
			name: "absolute path",
			override: map[string]any{
				"kind": "decision.note", "payload": map[string]any{"text": `C:\private\result.csv`},
			},
			reason: "forbidden_public_value",
		},
		{
			name: "arbitrary URL",
			override: map[string]any{
				"summary": map[string]any{"key": "activity.run.started", "text": "https://storage.invalid/private"},
			},
			reason: "forbidden_public_value",
		},
		{
			name: "unbounded exception",
			override: map[string]any{
				"kind": "run.failed", "status": "failed",
				"payload": map[string]any{"code": strings.Repeat("x", 513), "retryable": false},
			},
			reason: "public_string_too_large",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			raw := fixtureEvent(t, fixtures, test.override, 1)
			_, err := ParseExecutionEventV1(raw)
			if err == nil || !strings.Contains(err.Error(), test.reason) {
				t.Fatalf("got error %v, want reason %q", err, test.reason)
			}
		})
	}
}
