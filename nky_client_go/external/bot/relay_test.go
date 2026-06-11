package bot

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListObsKeysSendsPrefixAndAuth(t *testing.T) {
	var gotPrefix, gotAuth, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotPrefix = r.URL.Query().Get("prefix")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":["agent_data/user_data/web/runs/r1/out.zip","agent_data/user_data/web/runs/r1/p.png"]}`))
	}))
	defer srv.Close()

	keys, err := newTestClient(srv.URL).ListObsKeys(context.Background(), "/obs/phytomni/agent_data/user_data/web/runs/r1/")
	if err != nil {
		t.Fatalf("ListObsKeys error: %v", err)
	}
	if gotPath != "/v1/relay/obs/list" {
		t.Errorf("path = %q, want /v1/relay/obs/list", gotPath)
	}
	if gotPrefix != "/obs/phytomni/agent_data/user_data/web/runs/r1/" {
		t.Errorf("prefix = %q", gotPrefix)
	}
	if gotAuth != "Bearer ptm_test" {
		t.Errorf("Authorization = %q, want Bearer ptm_test", gotAuth)
	}
	if len(keys) != 2 || keys[0] != "agent_data/user_data/web/runs/r1/out.zip" {
		t.Errorf("keys = %v", keys)
	}
}

func TestGetObsObjectStreamRoundTrip(t *testing.T) {
	var gotObjPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotObjPath = r.URL.Query().Get("path")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("zip-bytes"))
	}))
	defer srv.Close()

	rc, n, err := newTestClient(srv.URL).GetObsObjectStream(context.Background(), "agent_data/user_data/web/runs/r1/out.zip")
	if err != nil {
		t.Fatalf("GetObsObjectStream error: %v", err)
	}
	defer rc.Close()
	body, _ := io.ReadAll(rc)
	if string(body) != "zip-bytes" {
		t.Errorf("body = %q, want zip-bytes", body)
	}
	if n != int64(len("zip-bytes")) {
		t.Errorf("content length = %d, want %d", n, len("zip-bytes"))
	}
	if gotObjPath != "agent_data/user_data/web/runs/r1/out.zip" {
		t.Errorf("path = %q", gotObjPath)
	}
	if gotAuth != "Bearer ptm_test" {
		t.Errorf("Authorization = %q", gotAuth)
	}
}

func TestGetObsObjectStreamErrorEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"message":"list prefix outside the output root"}}`))
	}))
	defer srv.Close()

	_, _, err := newTestClient(srv.URL).GetObsObjectStream(context.Background(), "legacy/old-bucket/r.zip")
	if err == nil {
		t.Fatal("want error on 403")
	}
	if !IsLegacyPathErr(err) {
		t.Errorf("403 should classify as legacy-path error, got %v", err)
	}
}

func TestIsLegacyPathErr(t *testing.T) {
	if !IsLegacyPathErr(&APIError{Status: http.StatusBadRequest}) {
		t.Error("400 should be legacy-path")
	}
	if !IsLegacyPathErr(&APIError{Status: http.StatusForbidden}) {
		t.Error("403 should be legacy-path")
	}
	if IsLegacyPathErr(&APIError{Status: http.StatusNotFound}) {
		t.Error("404 should NOT be legacy-path (relay disabled is an ops error)")
	}
	if IsLegacyPathErr(io.EOF) {
		t.Error("non-APIError should not be legacy-path")
	}
}
