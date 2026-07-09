# Excelize v2 Document Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `release/0.1.3`, migrate the sole DataAgent `.xlsx` export from abandoned excelize v1 to `github.com/xuri/excelize/v2 v2.9.1` using StreamWriter (always), frozen header row, fixed >26-column cell refs, golden-byte regression tests, and `ExportToExecl` → `ExportToExcel` rename — without touching HTTP routes, gofpdf, or snowflake.

**Architecture:** New `apps/server/common/document_format/xlsx` subpackage owns all excelize v2 + StreamWriter logic. `data_agent` keeps `TableData` (JSON unmarshaling in `format.go`) and delegates `ExportToExcel` to `xlsx.ExportTable`. Golden tests normalize ZIP timestamps before SHA256 compare. Develop directly on `release/0.1.3` — no feature branch.

**Tech Stack:** Go 1.23 (`toolchain go1.23.6`), `github.com/xuri/excelize/v2 v2.9.1` (pinned), `archive/zip`, `crypto/sha256`, existing `gofpdf` unchanged in `data_agent`.

**Design doc:** `.codex/specs/2026-07-10-excelize-v2-document-export-design.md`

## Global Constraints

- **Branch:** develop directly on `release/0.1.3`. No feature branches.
- **excelize pin:** `github.com/xuri/excelize/v2 v2.9.1` only — do **not** bump to v2.10+ (requires Go 1.24).
- **Go toolchain:** stay on Go 1.23; do not change `go` / `toolchain` lines in `go.mod`.
- **StreamWriter:** all Xlsx exports use StreamWriter (including empty tables); `SetPanes` **before** any `SetRow`.
- **Frozen pane:** `Freeze: true`, `YSplit: 1`, `TopLeftCell: "A2"`, `ActivePane: "bottomLeft"`.
- **Column refs:** use `excelize.CoordinatesToCellName` only — never `rune('A'+i)`.
- **Row shape:** pad short rows with `""`; truncate long rows to `len(headers)`.
- **Errors:** wrap as `fmt.Errorf("export xlsx: %w", err)`; no new sentinel types.
- **Out of scope:** gofpdf migration, snowflake removal, jwt v5, frontend, API contract changes, Excel styling beyond freeze pane.
- **Single-language policy:** comments, string literals, tests, docs in **English**.
- **Commit style (sssxie):** `<emoji> Category: Capitalized imperative` subject + REQUIRED `- ` bullet body. English. No `Co-Authored-By`. No planning tokens in commit subjects/bodies.
- **`git add` explicit paths only**, never `-A`.
- **Local gate:** final task runs `./scripts/validate_web_local.sh` (includes G7.5 `go test ./...`).

---

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `apps/server/go.mod` | 2 | Add `xuri/excelize/v2 v2.9.1`; remove `360EntSecGroup-Skylar/excelize` |
| `apps/server/go.sum` | 2 | Updated by `go mod tidy` |
| `apps/server/common/document_format/xlsx/table_input.go` | 1 | `TableInput` struct (decoupled from `data_agent` to avoid import cycle) |
| `apps/server/common/document_format/xlsx/testutil_normalize.go` | 1 | ZIP timestamp strip + deterministic SHA256 (test-only) |
| `apps/server/common/document_format/xlsx/export_test.go` | 1 | Golden fixtures + `GOUPDATE_GOLDEN` workflow |
| `apps/server/common/document_format/xlsx/testdata/*.sha256` | 2 | Expected normalized hashes (generated) |
| `apps/server/common/document_format/xlsx/export.go` | 2 | `ExportTable` StreamWriter implementation |
| `apps/server/common/document_format/data_agent/data_agent.go` | 3 | Remove v1 excelize; delegate `ExportToExcel`; keep PDF/MD |
| `apps/server/common/document_format/format.go` | 3 | Call `ExportToExcel` instead of `ExportToExecl` |
| `apps/server/common/document_format/excelize_retired_test.go` | 4 | Assert v1 module path absent from `go.mod` |
| `AGENTS.md` | 5 | `document_format` excelize v2 invariant note |
| `.codex/specs/2026-07-06-development-roadmap.md` | 5 | Progress banner (local, gitignored) |

---

### Task 1: Golden test harness + failing tests (TDD)

**Files:**
- Create: `apps/server/common/document_format/xlsx/table_input.go`
- Create: `apps/server/common/document_format/xlsx/testutil_normalize.go`
- Create: `apps/server/common/document_format/xlsx/export_test.go`

**Interfaces:**
- Consumes: (none — first task)
- Produces:
  - `xlsx.TableInput` — `{ Headers []string; Rows [][]string }`
  - `normalizedSHA256(data []byte) (string, error)` — test helper in `testutil_normalize.go`
  - `ExportTable(data TableInput) ([]byte, error)` — **not yet implemented**; tests reference it

- [ ] **Step 1: Create `table_input.go`**

Create `apps/server/common/document_format/xlsx/table_input.go`:

```go
package xlsx

// TableInput is the excel export payload. data_agent.TableData maps to this
// struct to avoid an import cycle (data_agent imports xlsx).
type TableInput struct {
	Headers []string
	Rows    [][]string
}
```

- [ ] **Step 2: Create `testutil_normalize.go`**

Create `apps/server/common/document_format/xlsx/testutil_normalize.go`:

```go
package xlsx

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
)

var docPropsTimeRE = regexp.MustCompile(
	`(?s)<(?:dcterms:created|dcterms:modified|cp:lastModifiedBy|cp:lastPrinted|dcterms:creator)[^>]*>[^<]*</[^>]+>`,
)

// normalizedSHA256 strips non-deterministic docProps timestamps from an xlsx
// ZIP archive, then returns a hex SHA256 over sorted entry path+content pairs.
func normalizedSHA256(xlsxBytes []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(xlsxBytes), int64(len(xlsxBytes)))
	if err != nil {
		return "", fmt.Errorf("open zip: %w", err)
	}

	type entry struct {
		name    string
		content []byte
	}
	entries := make([]entry, 0, len(zr.File))
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			return "", fmt.Errorf("open entry %s: %w", f.Name, err)
		}
		body, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return "", fmt.Errorf("read entry %s: %w", f.Name, err)
		}
		if strings.HasPrefix(f.Name, "docProps/") {
			body = docPropsTimeRE.ReplaceAll(body, nil)
		}
		entries = append(entries, entry{name: f.Name, content: body})
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].name < entries[j].name })

	h := sha256.New()
	for _, e := range entries {
		h.Write([]byte(e.name))
		h.Write([]byte{0})
		h.Write(e.content)
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
```

- [ ] **Step 3: Create failing `export_test.go`**

Create `apps/server/common/document_format/xlsx/export_test.go`:

```go
package xlsx

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func fixturePath(name string) string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "testdata", name+".sha256")
}

func assertGolden(t *testing.T, name string, input TableInput) {
	t.Helper()
	out, err := ExportTable(input)
	if err != nil {
		t.Fatalf("ExportTable(%s): %v", name, err)
	}
	got, err := normalizedSHA256(out)
	if err != nil {
		t.Fatalf("normalizedSHA256(%s): %v", name, err)
	}

	path := fixturePath(name)
	if os.Getenv("GOUPDATE_GOLDEN") == "1" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("mkdir testdata: %v", err)
		}
		if err := os.WriteFile(path, []byte(got+"\n"), 0o644); err != nil {
			t.Fatalf("write golden %s: %v", path, err)
		}
		t.Logf("updated golden %s -> %s", name, got)
		return
	}

	wantBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden %s (run GOUPDATE_GOLDEN=1 go test ./common/document_format/xlsx/...): %v", path, err)
	}
	want := strings.TrimSpace(string(wantBytes))
	if got != want {
		t.Fatalf("golden %s mismatch\ngot:  %s\nwant: %s", name, got, want)
	}
}

func TestExportTableGoldenSmall3Col(t *testing.T) {
	assertGolden(t, "small_3col", TableInput{
		Headers: []string{"Gene", "Species", "E-value"},
		Rows: [][]string{
			{"Os01g01010", "rice", "1e-10"},
			{"At1g01010", "arabidopsis", "2e-8"},
		},
	})
}

func TestExportTableGoldenWide30Col(t *testing.T) {
	headers := make([]string, 30)
	row := make([]string, 30)
	for i := 0; i < 30; i++ {
		headers[i] = fmt.Sprintf("Col%d", i+1)
		row[i] = fmt.Sprintf("v%d", i+1)
	}
	assertGolden(t, "wide_30col", TableInput{
		Headers: headers,
		Rows:    [][]string{row},
	})
}

func TestExportTableGoldenUnicodeCJK(t *testing.T) {
	assertGolden(t, "unicode_cjk", TableInput{
		Headers: []string{"基因", "物种", "备注"},
		Rows: [][]string{
			{"Os01g01010", "水稻", "同源"},
		},
	})
}

func TestExportTableGoldenHeadersOnly(t *testing.T) {
	assertGolden(t, "headers_only", TableInput{
		Headers: []string{"A", "B", "C"},
		Rows:    nil,
	})
}

func TestExportTableGoldenEmpty(t *testing.T) {
	assertGolden(t, "empty", TableInput{})
}
```

Add missing import at top of `export_test.go`:

```go
import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)
```

- [ ] **Step 4: Run test to verify it fails**

Run:

```bash
cd apps/server && go test ./common/document_format/xlsx/... -count=1
```

Expected: FAIL — `ExportTable` undefined (or package build error).

- [ ] **Step 5: Commit**

```bash
cd apps/server
git add common/document_format/xlsx/table_input.go \
        common/document_format/xlsx/testutil_normalize.go \
        common/document_format/xlsx/export_test.go
git commit -m "$(cat <<'EOF'
🧪 Tests: Add xlsx golden harness before excelize v2 export

- TableInput struct and ZIP-normalized SHA256 test helper
- Golden fixtures for small, wide, unicode, headers-only, and empty tables
EOF
)"
```

---

### Task 2: excelize v2 dependency + StreamWriter `ExportTable`

**Files:**
- Create: `apps/server/common/document_format/xlsx/export.go`
- Modify: `apps/server/go.mod`
- Modify: `apps/server/go.sum`
- Create: `apps/server/common/document_format/xlsx/testdata/*.sha256` (5 files)

**Interfaces:**
- Consumes: `xlsx.TableInput`
- Produces: `func ExportTable(data TableInput) ([]byte, error)`

- [ ] **Step 1: Add excelize v2 dependency**

Run:

```bash
cd apps/server
go get github.com/xuri/excelize/v2@v2.9.1
```

Verify `go.mod` contains `github.com/xuri/excelize/v2 v2.9.1` and still has `go 1.23.0`.

- [ ] **Step 2: Implement `export.go`**

Create `apps/server/common/document_format/xlsx/export.go`:

```go
package xlsx

import (
	"bytes"
	"fmt"

	"github.com/xuri/excelize/v2"
)

// ExportTable writes an xlsx workbook for tabular agent data using StreamWriter.
func ExportTable(data TableInput) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()

	sw, err := f.NewStreamWriter("Sheet1")
	if err != nil {
		return nil, fmt.Errorf("export xlsx: %w", err)
	}

	if err := sw.SetPanes(&excelize.Panes{
		Freeze:      true,
		YSplit:      1,
		TopLeftCell: "A2",
		ActivePane:  "bottomLeft",
	}); err != nil {
		return nil, fmt.Errorf("export xlsx: %w", err)
	}

	colCount := len(data.Headers)
	if colCount > 0 {
		headerRow := make([]interface{}, colCount)
		for i, h := range data.Headers {
			headerRow[i] = h
		}
		if err := sw.SetRow("A1", headerRow); err != nil {
			return nil, fmt.Errorf("export xlsx: %w", err)
		}
	}

	for rowIdx, row := range data.Rows {
		if colCount == 0 {
			break
		}
		cell, err := excelize.CoordinatesToCellName(1, rowIdx+2)
		if err != nil {
			return nil, fmt.Errorf("export xlsx: %w", err)
		}
		if err := sw.SetRow(cell, normalizeRow(row, colCount)); err != nil {
			return nil, fmt.Errorf("export xlsx: %w", err)
		}
	}

	if err := sw.Flush(); err != nil {
		return nil, fmt.Errorf("export xlsx: %w", err)
	}

	buf := new(bytes.Buffer)
	if err := f.Write(buf); err != nil {
		return nil, fmt.Errorf("export xlsx: %w", err)
	}
	return buf.Bytes(), nil
}

func normalizeRow(row []string, colCount int) []interface{} {
	out := make([]interface{}, colCount)
	for i := 0; i < colCount; i++ {
		if i < len(row) {
			out[i] = row[i]
		} else {
			out[i] = ""
		}
	}
	return out
}
```

- [ ] **Step 3: Generate golden SHA256 files**

Run:

```bash
cd apps/server
GOUPDATE_GOLDEN=1 go test ./common/document_format/xlsx/... -count=1
```

Expected: PASS; creates:
- `common/document_format/xlsx/testdata/small_3col.sha256`
- `common/document_format/xlsx/testdata/wide_30col.sha256`
- `common/document_format/xlsx/testdata/unicode_cjk.sha256`
- `common/document_format/xlsx/testdata/headers_only.sha256`
- `common/document_format/xlsx/testdata/empty.sha256`

- [ ] **Step 4: Run tests without update flag**

Run:

```bash
cd apps/server && go test ./common/document_format/xlsx/... -count=1
```

Expected: PASS (all golden tests).

- [ ] **Step 5: Add pad/truncate semantic tests**

Append to `export_test.go`:

```go
import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestExportTablePadsShortRows(t *testing.T) {
	out, err := ExportTable(TableInput{
		Headers: []string{"H1", "H2", "H3"},
		Rows:    [][]string{{"only-one"}},
	})
	if err != nil {
		t.Fatalf("ExportTable: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("OpenReader: %v", err)
	}
	defer f.Close()
	v, _ := f.GetCellValue("Sheet1", "C2")
	if v != "" {
		t.Fatalf("C2 = %q, want empty padded cell", v)
	}
}

func TestExportTableTruncatesLongRows(t *testing.T) {
	out, err := ExportTable(TableInput{
		Headers: []string{"H1"},
		Rows:    [][]string{{"keep", "drop"}},
	})
	if err != nil {
		t.Fatalf("ExportTable: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("OpenReader: %v", err)
	}
	defer f.Close()
	b2, _ := f.GetCellValue("Sheet1", "B2")
	if b2 != "" {
		t.Fatalf("B2 = %q, want truncated-away cell", b2)
	}
}
```

Merge the new imports into the existing `export_test.go` import block (do not duplicate `testing`).

Run:

```bash
cd apps/server && go test ./common/document_format/xlsx/... -count=1
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd apps/server
git add go.mod go.sum \
        common/document_format/xlsx/export.go \
        common/document_format/xlsx/export_test.go \
        common/document_format/xlsx/testdata/
git commit -m "$(cat <<'EOF'
✨ Add: StreamWriter xlsx export on excelize v2

- Pin github.com/xuri/excelize/v2 v2.9.1 and implement ExportTable
- Freeze header row; fix wide-column coords; golden SHA256 fixtures
EOF
)"
```

---

### Task 3: Delegate from `data_agent` + rename + remove v1 usage

**Files:**
- Modify: `apps/server/common/document_format/data_agent/data_agent.go`
- Modify: `apps/server/common/document_format/format.go`

**Interfaces:**
- Consumes: `xlsx.ExportTable(xlsx.TableInput{Headers: data.Headers, Rows: data.Rows})`
- Produces: `data_agent.ExportToExcel(data TableData) ([]byte, error)` — replaces `ExportToExecl`

- [ ] **Step 1: Refactor `data_agent.go`**

Replace the excel import block and `ExportToExecl` with:

```go
import (
	"bytes"
	"fmt"
	"strings"

	"github.com/jung-kurt/gofpdf"
	"phytomni-server/common/document_format/xlsx"
)
```

Replace `ExportToExecl` function body with:

```go
func ExportToExcel(data TableData) ([]byte, error) {
	return xlsx.ExportTable(xlsx.TableInput{
		Headers: data.Headers,
		Rows:    data.Rows,
	})
}
```

Remove the entire old v1 excelize implementation (lines using `github.com/360EntSecGroup-Skylar/excelize`). Keep `ExportToPdf` and `ExportToMarkdown` unchanged.

- [ ] **Step 2: Update `format.go` call site**

In `apps/server/common/document_format/format.go`, change:

```go
content, err := data_agent.ExportToExecl(data)
```

to:

```go
content, err := data_agent.ExportToExcel(data)
```

- [ ] **Step 3: Remove abandoned v1 module**

Run:

```bash
cd apps/server
go mod tidy
```

Verify `go.mod` no longer lists `github.com/360EntSecGroup-Skylar/excelize`.

- [ ] **Step 4: Build and test**

Run:

```bash
cd apps/server && gofmt -l . && go vet ./... && go build && go test ./common/document_format/... -count=1
```

Expected: PASS; `gofmt -l .` prints nothing.

- [ ] **Step 5: Commit**

```bash
cd apps/server
git add common/document_format/data_agent/data_agent.go \
        common/document_format/format.go \
        go.mod go.sum
git commit -m "$(cat <<'EOF'
♻️ Reorg: Delegate DataAgent Excel export to xlsx package

- Rename ExportToExecl to ExportToExcel and drop excelize v1 import
- go mod tidy removes abandoned 360EntSecGroup-Skylar/excelize
EOF
)"
```

---

### Task 4: Module hygiene test

**Files:**
- Create: `apps/server/common/document_format/excelize_retired_test.go`

**Interfaces:**
- Consumes: `apps/server/go.mod` on disk
- Produces: compile-time/doc test that v1 path is gone

- [ ] **Step 1: Write hygiene test**

Create `apps/server/common/document_format/excelize_retired_test.go`:

```go
package document_format_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestExcelizeV1RetiredFromGoMod(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	modPath := filepath.Join(filepath.Dir(file), "..", "..", "go.mod")
	body, err := os.ReadFile(modPath)
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	if strings.Contains(string(body), "360EntSecGroup-Skylar/excelize") {
		t.Fatal("go.mod still references abandoned excelize v1 module path")
	}
	if !strings.Contains(string(body), "github.com/xuri/excelize/v2") {
		t.Fatal("go.mod missing github.com/xuri/excelize/v2")
	}
}
```

- [ ] **Step 2: Run test**

Run:

```bash
cd apps/server && go test ./common/document_format/ -run TestExcelizeV1Retired -count=1
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd apps/server
git add common/document_format/excelize_retired_test.go
git commit -m "$(cat <<'EOF'
🧪 Tests: Lock excelize v2 module path in go.mod

- Fail if abandoned 360EntSecGroup-Skylar/excelize reappears in go.mod
EOF
)"
```

---

### Task 5: Docs, roadmap banner, full gate

**Files:**
- Modify: `AGENTS.md`
- Modify: `.codex/specs/2026-07-06-development-roadmap.md` (local only)

**Interfaces:**
- Consumes: landed Tasks 1–4
- Produces: documentation + green `validate_web_local.sh`

- [ ] **Step 1: Update `AGENTS.md`**

In the `apps/server` / `document_format` section (near external integrations or architecture details), add a short invariant block:

```markdown
**DataAgent Xlsx export (don't regress):** Excel downloads use `common/document_format/xlsx.ExportTable` on `github.com/xuri/excelize/v2` (pinned v2.9.1) with **StreamWriter only** — `SetPanes` (freeze row 1) before `SetRow`, `CoordinatesToCellName` for cell refs (never `rune('A'+i)`). `data_agent.ExportToExcel` delegates; do not reintroduce `360EntSecGroup-Skylar/excelize` v1. Golden-byte tests live in `common/document_format/xlsx/`.
```

- [ ] **Step 2: Update local roadmap banner**

In `.codex/specs/2026-07-06-development-roadmap.md` progress line, add that excelize v2 is closed (mirror latent i18n banner style). Remove excelize v2 from the "仍开放" list.

- [ ] **Step 3: Run full local gate**

Run from repo root:

```bash
./scripts/validate_web_local.sh
```

Expected: `GATE_EXIT=0`

- [ ] **Step 4: Commit tracked docs only**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
📝 Docs: Document excelize v2 StreamWriter export invariant

- AGENTS.md records xlsx subpackage, v2 pin, freeze pane, and golden tests
EOF
)"
```

(Do not commit `.codex/specs/` — gitignored.)

---

## Plan Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| excelize v2 v2.9.1 pin | Task 2 |
| StreamWriter always | Task 2 `export.go` |
| Frozen header row | Task 2 `SetPanes` |
| >26 col fix | Task 2 + `wide_30col` golden |
| `ExportToExecl` → `ExportToExcel` | Task 3 |
| Golden-byte + normalization | Task 1–2 |
| Pad/truncate rows | Task 2 `normalizeRow` + Task 1 tests |
| Empty/headers-only fixtures | Task 1–2 goldens |
| No HTTP/frontend changes | Implicit (only `format.go` rename) |
| gofpdf/snowflake out of scope | Global Constraints |
| `AGENTS.md` + roadmap | Task 5 |
| `validate_web_local.sh` | Task 5 |

**2. Placeholder scan:** No TBD/TODO/"implement later" steps.

**3. Type consistency:** `TableInput` in xlsx; `TableData` stays in `data_agent`; `ExportToExcel` delegates with explicit field copy. `ExportTable` signature consistent across Tasks 1–3.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-10-excelize-v2-document-export.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
