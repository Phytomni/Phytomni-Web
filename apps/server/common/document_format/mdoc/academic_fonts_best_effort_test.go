package mdoc

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestFontLoaderBestEffortEmptyDirectoryReturnsEmptySet(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "private-font-location")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}

	fonts := callAcademicFontsBestEffort(t, dir)
	assertAcademicFaceEmpty(t, fonts.regular, "regular")
	assertAcademicFaceEmpty(t, fonts.bold, "bold")
	assertAcademicFaceEmpty(t, fonts.italic, "italic")
	assertAcademicFaceEmpty(t, fonts.boldItalic, "bold_italic")
}

func TestFontLoaderBestEffortEmptyStringReturnsPromptly(t *testing.T) {
	fonts := callAcademicFontsBestEffort(t, "")
	assertAcademicFaceEmpty(t, fonts.regular, "regular")
	assertAcademicFaceEmpty(t, fonts.bold, "bold")
	assertAcademicFaceEmpty(t, fonts.italic, "italic")
	assertAcademicFaceEmpty(t, fonts.boldItalic, "bold_italic")
}

func TestFontLoaderBestEffortSkipsOneMissingStyle(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	dir := t.TempDir()
	copyTestFont(t, filepath.Join(sourceDir, "times.ttf"), filepath.Join(dir, "times.ttf"))
	copyTestFont(t, filepath.Join(sourceDir, "timesbd.ttf"), filepath.Join(dir, "timesbd.ttf"))
	copyTestFont(t, filepath.Join(sourceDir, "timesbi.ttf"), filepath.Join(dir, "timesbi.ttf"))

	fonts := callAcademicFontsBestEffort(t, dir)
	assertAcademicFaceLoaded(t, fonts.regular, "TimesNewRomanPSMT")
	assertAcademicFaceLoaded(t, fonts.bold, "TimesNewRomanPS-BoldMT")
	assertAcademicFaceEmpty(t, fonts.italic, "italic")
	assertAcademicFaceLoaded(t, fonts.boldItalic, "TimesNewRomanPS-BoldItalicMT")
	assertAcademicFaceGlyphsPreserved(t, fonts.regular, requireAcademicFonts(t).regular)
}

func TestFontLoaderBestEffortSkipsMalformedIndividualFiles(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	dir := t.TempDir()
	copyTestFont(t, filepath.Join(sourceDir, "times.ttf"), filepath.Join(dir, "times.ttf"))
	writeTestFont(t, dir, "timesbd.ttf", []byte("truncated-private-font"))
	writeTestFont(t, dir, "timesi.ttf", parserPanicFixture())
	copyTestFont(t, filepath.Join(sourceDir, "timesbi.ttf"), filepath.Join(dir, "timesbi.ttf"))

	fonts := callAcademicFontsBestEffort(t, dir)
	assertAcademicFaceLoaded(t, fonts.regular, "TimesNewRomanPSMT")
	assertAcademicFaceEmpty(t, fonts.bold, "bold")
	assertAcademicFaceEmpty(t, fonts.italic, "italic")
	assertAcademicFaceLoaded(t, fonts.boldItalic, "TimesNewRomanPS-BoldItalicMT")
	assertAcademicFaceGlyphsPreserved(t, fonts.regular, requireAcademicFonts(t).regular)
	assertAcademicFaceGlyphsPreserved(t, fonts.boldItalic, requireAcademicFonts(t).boldItalic)
}

func TestFontLoaderBestEffortLoadsCompleteValidSet(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	dir := t.TempDir()
	copyAcademicFontSet(t, sourceDir, dir)

	strict, err := LoadAcademicFonts(dir)
	if err != nil {
		t.Fatalf("strict loader: %v", err)
	}
	fonts := callAcademicFontsBestEffort(t, dir)
	wants := []struct {
		got, want academicFace
		role      string
	}{
		{got: fonts.regular, want: strict.regular, role: "regular"},
		{got: fonts.bold, want: strict.bold, role: "bold"},
		{got: fonts.italic, want: strict.italic, role: "italic"},
		{got: fonts.boldItalic, want: strict.boldItalic, role: "bold_italic"},
	}
	for _, want := range wants {
		if want.got.postScriptName != want.want.postScriptName {
			t.Errorf("%s PostScript name = %q, want %q", want.role, want.got.postScriptName, want.want.postScriptName)
		}
		if !reflect.DeepEqual(want.got.glyphs, want.want.glyphs) {
			t.Errorf("%s glyph map diverged from the strict loader", want.role)
		}
		if len(want.got.data) == 0 {
			t.Errorf("%s has no retained bytes", want.role)
		}
	}
}

func TestFontLoaderBestEffortDoesNotShareStrictFailureCache(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	dir := t.TempDir()
	copyTestFont(t, filepath.Join(sourceDir, "times.ttf"), filepath.Join(dir, "times.ttf"))

	_, err := LoadAcademicFonts(dir)
	assertAcademicFontError(t, err, "bold", "missing", dir)

	fonts := callAcademicFontsBestEffort(t, dir)
	assertAcademicFaceLoaded(t, fonts.regular, "TimesNewRomanPSMT")
	assertAcademicFaceEmpty(t, fonts.bold, "bold")
	assertAcademicFaceGlyphsPreserved(t, fonts.regular, requireAcademicFonts(t).regular)
}

func TestFontLoaderBestEffortDoesNotWeakenStrictValidation(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	dir := t.TempDir()
	copyTestFont(t, filepath.Join(sourceDir, "times.ttf"), filepath.Join(dir, "times.ttf"))

	_ = callAcademicFontsBestEffort(t, dir)
	_, err := LoadAcademicFonts(dir)
	assertAcademicFontError(t, err, "bold", "missing", dir)
}

func TestFontLoaderBestEffortCachesPartialSetUntilRestart(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	dir := t.TempDir()
	copyTestFont(t, filepath.Join(sourceDir, "times.ttf"), filepath.Join(dir, "times.ttf"))

	first := callAcademicFontsBestEffort(t, dir)
	assertAcademicFaceLoaded(t, first.regular, "TimesNewRomanPSMT")
	assertAcademicFaceEmpty(t, first.bold, "bold")

	copyTestFont(t, filepath.Join(sourceDir, "timesbd.ttf"), filepath.Join(dir, "timesbd.ttf"))
	second := LoadAcademicFontsBestEffort(dir)
	assertAcademicFaceEmpty(t, second.bold, "bold")
	if second.regular.postScriptName != first.regular.postScriptName || len(second.regular.data) != len(first.regular.data) {
		t.Fatal("best-effort directory was reloaded without a process restart")
	}
}

func TestFontLoaderBestEffortReturnedFontsRemainImmutable(t *testing.T) {
	sourceDir := requiredAcademicFontDir(t)
	dir := t.TempDir()
	copyTestFont(t, filepath.Join(sourceDir, "times.ttf"), filepath.Join(dir, "times.ttf"))

	first := callAcademicFontsBestEffort(t, dir)
	originalByte := first.regular.data[0]
	originalGlyph := first.regular.glyphs['A']
	first.regular.data[0] ^= 0xff
	delete(first.regular.glyphs, 'A')

	second := LoadAcademicFontsBestEffort(dir)
	if second.regular.data[0] != originalByte || second.regular.glyphs['A'] != originalGlyph {
		t.Fatal("caller mutation changed the cached best-effort font resources")
	}
}

func callAcademicFontsBestEffort(t *testing.T, dir string) AcademicFonts {
	t.Helper()
	done := make(chan AcademicFonts, 1)
	var panicValue any
	go func() {
		defer func() {
			if err := recover(); err != nil {
				panicValue = err
				close(done)
			}
		}()
		done <- LoadAcademicFontsBestEffort(dir)
	}()
	select {
	case fonts, ok := <-done:
		if !ok {
			msg := fmt.Sprint(panicValue)
			if dir != "" && (strings.Contains(msg, dir) || strings.Contains(msg, filepath.Base(dir))) {
				t.Fatalf("best-effort loader leaked private path: %v", panicValue)
			}
			t.Fatalf("best-effort loader panicked: %v", panicValue)
		}
		return fonts
	case <-time.After(2 * time.Second):
		t.Fatal("best-effort loader did not return promptly")
		return AcademicFonts{}
	}
}

func assertAcademicFaceEmpty(t *testing.T, face academicFace, role string) {
	t.Helper()
	if face.postScriptName != "" || len(face.data) != 0 || len(face.glyphs) != 0 {
		t.Fatalf("%s face loaded unexpectedly: name=%q bytes=%d glyphs=%d", role, face.postScriptName, len(face.data), len(face.glyphs))
	}
}

func assertAcademicFaceLoaded(t *testing.T, face academicFace, postScriptName string) {
	t.Helper()
	if face.postScriptName != postScriptName {
		t.Fatalf("PostScript name = %q, want %q", face.postScriptName, postScriptName)
	}
	if len(face.data) == 0 {
		t.Fatalf("%s has no retained bytes", postScriptName)
	}
	if len(face.glyphs) == 0 || face.glyphs['A'] == 0 {
		t.Fatalf("%s lost valid glyph map", postScriptName)
	}
}

func assertAcademicFaceGlyphsPreserved(t *testing.T, got, want academicFace) {
	t.Helper()
	if got.glyphs['A'] != want.glyphs['A'] || got.glyphs['α'] != want.glyphs['α'] {
		t.Fatalf("glyph map was not preserved: A=%d α=%d, want A=%d α=%d", got.glyphs['A'], got.glyphs['α'], want.glyphs['A'], want.glyphs['α'])
	}
	if !reflect.DeepEqual(got.glyphs, want.glyphs) {
		t.Fatal("valid face glyph map diverged from the strict loader")
	}
}
