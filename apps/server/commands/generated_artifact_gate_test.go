package commands

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestGeneratedArtifactIgnoreRulesAreScoped(t *testing.T) {
	_, currentFile, _, _ := runtime.Caller(0)
	repo := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", ".."))
	for _, path := range []string{
		".gocache/probe",
		".codex-runtime/service/server.pid",
		".codex-test-cache/vitest-results.json",
		"apps/web/node_modules/.vite/deps/chunk.js",
		"apps/web/coverage/index.html",
		"apps/server/test-results/result.json",
	} {
		command := exec.Command("git", "check-ignore", "--no-index", path)
		command.Dir = repo
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("generated path %q is exposed: %v %s", path, err, output)
		}
	}
	for _, path := range []string{
		"apps/server/service/api_service/new_source.go",
		"apps/server/migrations/20260824_dispatch_integrity.sql",
		"docs/reference/execution-runtime-v2.md",
		"docs/contracts/fixture.json",
		"apps/web/package-lock.json",
		"apps/server/go.sum",
	} {
		command := exec.Command("git", "check-ignore", "--no-index", path)
		command.Dir = repo
		if output, err := command.CombinedOutput(); err == nil {
			t.Fatalf("business path %q was hidden: %s", path, output)
		}
	}
}
