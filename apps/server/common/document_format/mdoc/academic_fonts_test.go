package mdoc

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestFontLoaderRejectsMissingFontsWithoutLeakingPath(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "private-font-location")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}

	_, err := LoadAcademicFonts(dir)
	assertAcademicFontError(t, err, "regular", "missing", dir)
}

func TestFontLoaderRejectsEachMissingRole(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	filenames := []string{"times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"}
	roles := []string{"regular", "bold", "italic", "bold_italic"}
	for missing := range filenames {
		t.Run(roles[missing], func(t *testing.T) {
			dir := t.TempDir()
			for i := 0; i < missing; i++ {
				copyTestFont(t, filepath.Join(sourceDir, filenames[i]), filepath.Join(dir, filenames[i]))
			}

			_, err := LoadAcademicFonts(dir)
			assertAcademicFontError(t, err, roles[missing], "missing", dir)
		})
	}
}

func TestFontLoaderRejectsTruncatedFontWithoutLeakingPath(t *testing.T) {
	dir := t.TempDir()
	writeTestFont(t, dir, "times.ttf", []byte("truncated-private-font"))

	_, err := LoadAcademicFonts(dir)
	assertAcademicFontError(t, err, "regular", "malformed", dir)
}

func TestFontLoaderRejectsMalformedTableBounds(t *testing.T) {
	raw := make([]byte, 28)
	binary.BigEndian.PutUint32(raw[0:4], 0x00010000)
	binary.BigEndian.PutUint16(raw[4:6], 1)
	copy(raw[12:16], "OS/2")
	binary.BigEndian.PutUint32(raw[20:24], 1024)
	binary.BigEndian.PutUint32(raw[24:28], 10)
	dir := t.TempDir()
	writeTestFont(t, dir, "times.ttf", raw)

	_, err := LoadAcademicFonts(dir)
	assertAcademicFontError(t, err, "regular", "malformed", dir)
}

func TestFontLoaderRejectsUnsupportedEmbeddingRights(t *testing.T) {
	for _, fsType := range []uint16{2, 0x100, 0x200, 0x204, 0xffff} {
		t.Run(fmt.Sprintf("0x%04x", fsType), func(t *testing.T) {
			dir := t.TempDir()
			writeTestFont(t, dir, "times.ttf", sfntFixture([]sfntTestTable{{tag: "OS/2", data: os2Fixture(fsType)}}))

			_, err := LoadAcademicFonts(dir)
			assertAcademicFontError(t, err, "regular", "embedding_rights", dir)
		})
	}
}

func TestFontLoaderAcceptsSupportedEmbeddingRightsAtBoundary(t *testing.T) {
	for _, fsType := range []uint16{0, 4, 8} {
		t.Run(fmt.Sprintf("0x%04x", fsType), func(t *testing.T) {
			raw := sfntFixture([]sfntTestTable{{tag: "OS/2", data: os2Fixture(fsType)}})
			if reason := validateAcademicSFNT(raw); reason != "" {
				t.Fatalf("supported fsType %#x rejected as %q", fsType, reason)
			}
		})
	}
}

func TestFontLoaderHandlesDependencyParserPanic(t *testing.T) {
	dir := t.TempDir()
	writeTestFont(t, dir, "times.ttf", parserPanicFixture())

	_, err := LoadAcademicFonts(dir)
	assertAcademicFontError(t, err, "regular", "parser", dir)
}

func TestFontParserUsesCapturedBytesAfterSourceReplacement(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "source.ttf")
	copyTestFont(t, filepath.Join(sourceDir, "times.ttf"), path)
	captured, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if reason := validateAcademicSFNT(captured); reason != "" {
		t.Fatalf("captured regular face rejected as %q", reason)
	}

	copyTestFont(t, filepath.Join(sourceDir, "timesbd.ttf"), path)
	replaced, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(captured, replaced) {
		t.Fatal("source replacement fixture did not change the file")
	}

	snapshotDir := useSnapshotTempDir(t)
	record, err := parseAcademicTTF(captured)
	if err != nil {
		t.Fatalf("parse captured snapshot: %v", err)
	}
	if record.PostScriptName != "TimesNewRomanPSMT" || record.Bold || record.Chars['A'] == 0 {
		t.Fatalf("metadata came from replaced source: name=%q bold=%v glyph=%d", record.PostScriptName, record.Bold, record.Chars['A'])
	}
	assertSnapshotDirEmpty(t, snapshotDir)
}

func TestFontParserSnapshotIsOwnerOnlyAndExact(t *testing.T) {
	snapshotDir := useSnapshotTempDir(t)
	want := []byte("captured-font-bytes")
	path, err := writeAcademicFontSnapshot(want)
	if err != nil {
		t.Fatalf("write snapshot: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("snapshot permissions = %#o, want 0600", info.Mode().Perm())
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("snapshot bytes differ from captured bytes")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	assertSnapshotDirEmpty(t, snapshotDir)
}

func TestFontParserRemovesSnapshotOnEveryOutcome(t *testing.T) {
	regular, err := os.ReadFile(filepath.Join(requiredAcademicFontDir(t), "times.ttf"))
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name    string
		data    []byte
		wantErr bool
	}{
		{name: "success", data: regular},
		{name: "parser error", data: []byte("not-a-font"), wantErr: true},
		{name: "parser panic", data: parserPanicFixture(), wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			snapshotDir := useSnapshotTempDir(t)
			_, err := parseAcademicTTF(tt.data)
			if (err != nil) != tt.wantErr {
				t.Fatalf("parse error = %v, wantErr=%v", err, tt.wantErr)
			}
			assertSnapshotDirEmpty(t, snapshotDir)
		})
	}
}

func TestFontLoaderRetainsMetadataForExactValidatedBytes(t *testing.T) {
	fonts := requireAcademicFonts(t)
	for name, face := range map[string]academicFace{
		"regular": fonts.regular, "bold": fonts.bold,
		"italic": fonts.italic, "bold_italic": fonts.boldItalic,
	} {
		t.Run(name, func(t *testing.T) {
			if reason := validateAcademicSFNT(face.data); reason != "" {
				t.Fatalf("retained bytes fail rights validation: %s", reason)
			}
			snapshotDir := useSnapshotTempDir(t)
			record, err := parseAcademicTTF(face.data)
			if err != nil {
				t.Fatalf("parse retained bytes: %v", err)
			}
			if record.PostScriptName != face.postScriptName || !reflect.DeepEqual(record.Chars, face.glyphs) {
				t.Fatal("retained metadata and glyphs do not describe retained bytes")
			}
			assertSnapshotDirEmpty(t, snapshotDir)
		})
	}
}

func TestFontLoaderCachesFailureUntilRestart(t *testing.T) {
	dir := t.TempDir()
	_, firstErr := LoadAcademicFonts(dir)
	assertAcademicFontError(t, firstErr, "regular", "missing", dir)

	writeTestFont(t, dir, "times.ttf", []byte("now-present-but-invalid"))
	_, secondErr := LoadAcademicFonts(dir)
	assertAcademicFontError(t, secondErr, "regular", "missing", dir)
	if firstErr.Error() != secondErr.Error() {
		t.Fatalf("cached failure changed: first=%q second=%q", firstErr, secondErr)
	}
}

func TestFontLoaderRejectsWrongFamily(t *testing.T) {
	dir := t.TempDir()
	copyTestFont(t, filepath.Join("..", "external_format", "msyh.ttf"), filepath.Join(dir, "times.ttf"))

	_, err := LoadAcademicFonts(dir)
	assertAcademicFontError(t, err, "regular", "wrong_family", dir)
}

func TestFontLoaderRejectsDuplicateRole(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	dir := t.TempDir()
	copyTestFont(t, filepath.Join(sourceDir, "times.ttf"), filepath.Join(dir, "times.ttf"))
	copyTestFont(t, filepath.Join(sourceDir, "times.ttf"), filepath.Join(dir, "timesbd.ttf"))

	_, err := LoadAcademicFonts(dir)
	assertAcademicFontError(t, err, "bold", "duplicate_role", dir)
}

func TestFontLoaderRejectsMismatchedRoleMetadata(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	tests := []struct {
		name, filename, table string
		fieldOffset           int
		mutate                func(uint16) uint16
	}{
		{name: "regular", filename: "times.ttf", table: "OS/2", fieldOffset: 62, mutate: func(value uint16) uint16 { return value | 32 }},
		{name: "bold", filename: "timesbd.ttf", table: "OS/2", fieldOffset: 62, mutate: func(value uint16) uint16 { return value &^ 32 }},
		{name: "italic", filename: "timesi.ttf", table: "post", fieldOffset: 4, mutate: func(uint16) uint16 { return 0 }},
		{name: "bold_italic", filename: "timesbi.ttf", table: "post", fieldOffset: 4, mutate: func(uint16) uint16 { return 0 }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			copyAcademicFontSet(t, sourceDir, dir)
			mutateTestFontU16(t, filepath.Join(dir, tt.filename), tt.table, tt.fieldOffset, tt.mutate)

			_, err := LoadAcademicFonts(dir)
			assertAcademicFontError(t, err, tt.name, "role_mismatch", dir)
		})
	}
}

func TestFontLoaderGenuineTimesNewRomanRoles(t *testing.T) {
	fonts := requireAcademicFonts(t)
	wants := []struct {
		got  academicFace
		name string
	}{
		{got: fonts.regular, name: "TimesNewRomanPSMT"},
		{got: fonts.bold, name: "TimesNewRomanPS-BoldMT"},
		{got: fonts.italic, name: "TimesNewRomanPS-ItalicMT"},
		{got: fonts.boldItalic, name: "TimesNewRomanPS-BoldItalicMT"},
	}
	for _, want := range wants {
		if want.got.postScriptName != want.name {
			t.Errorf("PostScript name = %q, want %q", want.got.postScriptName, want.name)
		}
		if len(want.got.data) == 0 {
			t.Errorf("%s has no retained bytes", want.name)
		}
	}
}

func TestFontLoaderGenuineGlyphCoverage(t *testing.T) {
	fonts := requireAcademicFonts(t)
	for name, face := range map[string]academicFace{
		"regular": fonts.regular, "bold": fonts.bold,
		"italic": fonts.italic, "bold_italic": fonts.boldItalic,
	} {
		if len(face.glyphs) == 0 || face.glyphs['A'] == 0 || face.glyphs['α'] == 0 {
			t.Errorf("%s lacks required Latin/Greek glyph coverage", name)
		}
	}
}

func TestFontLoaderCachedFontsRemainImmutable(t *testing.T) {
	dir := requiredAcademicFontDir(t)
	first, err := LoadAcademicFonts(dir)
	if err != nil {
		t.Fatalf("LoadAcademicFonts: %v", err)
	}
	originalByte := first.regular.data[0]
	originalGlyph := first.regular.glyphs['A']
	first.regular.data[0] ^= 0xff
	delete(first.regular.glyphs, 'A')

	second, err := LoadAcademicFonts(dir)
	if err != nil {
		t.Fatalf("LoadAcademicFonts cached: %v", err)
	}
	if second.regular.data[0] != originalByte || second.regular.glyphs['A'] != originalGlyph {
		t.Fatal("caller mutation changed the cached font resources")
	}
}

func TestFontLoaderCachesSuccessfulDirectoryUntilRestart(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	dir := t.TempDir()
	copyAcademicFontSet(t, sourceDir, dir)
	first, err := LoadAcademicFonts(dir)
	if err != nil {
		t.Fatalf("LoadAcademicFonts: %v", err)
	}
	writeTestFont(t, dir, "times.ttf", []byte("changed-after-validation"))

	second, err := LoadAcademicFonts(dir)
	if err != nil {
		t.Fatalf("cached LoadAcademicFonts: %v", err)
	}
	if second.regular.postScriptName != first.regular.postScriptName || len(second.regular.data) != len(first.regular.data) {
		t.Fatal("validated directory was reloaded without a process restart")
	}
}

func requireAcademicFonts(t *testing.T) AcademicFonts {
	t.Helper()
	dir := requiredAcademicFontDir(t)
	fonts, err := LoadAcademicFonts(dir)
	if err != nil {
		t.Fatalf("PHYTOMNI_REPORT_FONT_DIR is not a valid academic font resource: %v", err)
	}
	return fonts
}

func requiredAcademicFontDir(t *testing.T) string {
	t.Helper()
	dir := os.Getenv("PHYTOMNI_REPORT_FONT_DIR")
	if dir == "" {
		t.Fatal("PHYTOMNI_REPORT_FONT_DIR is required for genuine Times New Roman tests")
	}
	return dir
}

func assertAcademicFontError(t *testing.T, err error, role, reason, privatePath string) {
	t.Helper()
	if !errors.Is(err, ErrAcademicFontsUnavailable) {
		t.Fatalf("error %v does not wrap ErrAcademicFontsUnavailable", err)
	}
	want := "academic report fonts unavailable: role=" + role + " reason=" + reason
	if err.Error() != want {
		t.Fatalf("error = %q, want %q", err, want)
	}
	if strings.Contains(err.Error(), privatePath) || strings.Contains(err.Error(), filepath.Base(privatePath)) {
		t.Fatalf("font error leaks private path: %q", err)
	}
}

func writeTestFont(t *testing.T, dir, name string, data []byte) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func copyTestFont(t *testing.T, src, dst string) {
	t.Helper()
	raw, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("read test font: %v", err)
	}
	if err := os.WriteFile(dst, raw, 0o600); err != nil {
		t.Fatalf("write test font: %v", err)
	}
}

func copyAcademicFontSet(t *testing.T, srcDir, dstDir string) {
	t.Helper()
	for _, name := range []string{"times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"} {
		copyTestFont(t, filepath.Join(srcDir, name), filepath.Join(dstDir, name))
	}
}

func mutateTestFontU16(t *testing.T, path, table string, fieldOffset int, mutate func(uint16) uint16) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) < 12 {
		t.Fatal("test font has no SFNT directory")
	}
	numTables := int(binary.BigEndian.Uint16(raw[4:6]))
	for i := 0; i < numTables; i++ {
		record := 12 + i*16
		if record+16 > len(raw) {
			t.Fatal("test font has a truncated SFNT directory")
		}
		if string(raw[record:record+4]) != table {
			continue
		}
		offset := int(binary.BigEndian.Uint32(raw[record+8:record+12])) + fieldOffset
		if offset < 0 || offset+2 > len(raw) {
			t.Fatal("test font table field is out of bounds")
		}
		value := binary.BigEndian.Uint16(raw[offset : offset+2])
		binary.BigEndian.PutUint16(raw[offset:offset+2], mutate(value))
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
		return
	}
	t.Fatalf("test font table %q not found", table)
}

type sfntTestTable struct {
	tag  string
	data []byte
}

func sfntFixture(tables []sfntTestTable) []byte {
	headerLen := 12 + 16*len(tables)
	totalLen := headerLen
	for _, table := range tables {
		totalLen += len(table.data)
	}
	raw := make([]byte, totalLen)
	binary.BigEndian.PutUint32(raw[0:4], 0x00010000)
	binary.BigEndian.PutUint16(raw[4:6], uint16(len(tables)))
	offset := headerLen
	for i, table := range tables {
		record := 12 + 16*i
		copy(raw[record:record+4], table.tag)
		binary.BigEndian.PutUint32(raw[record+8:record+12], uint32(offset))
		binary.BigEndian.PutUint32(raw[record+12:record+16], uint32(len(table.data)))
		copy(raw[offset:], table.data)
		offset += len(table.data)
	}
	return raw
}

func os2Fixture(fsType uint16) []byte {
	raw := make([]byte, 10)
	binary.BigEndian.PutUint16(raw[8:10], fsType)
	return raw
}

func parserPanicFixture() []byte {
	head := make([]byte, 54)
	binary.BigEndian.PutUint32(head[12:16], 0x5f0f3cf5)
	hhea := make([]byte, 36)
	binary.BigEndian.PutUint16(hhea[34:36], 0)
	maxp := make([]byte, 6)
	binary.BigEndian.PutUint16(maxp[4:6], 1)
	return sfntFixture([]sfntTestTable{
		{tag: "head", data: head},
		{tag: "hhea", data: hhea},
		{tag: "maxp", data: maxp},
		{tag: "hmtx", data: nil},
		{tag: "OS/2", data: os2Fixture(0)},
	})
}

func useSnapshotTempDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)
	return dir
}

func assertSnapshotDirEmpty(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("font snapshot was not removed: %v", entries)
	}
}
