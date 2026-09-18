package mdoc

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/jung-kurt/gofpdf"
)

var ErrAcademicFontsUnavailable = errors.New("academic report fonts unavailable")

type academicFace struct {
	postScriptName string
	data           []byte
	glyphs         map[uint16]uint16
}

type AcademicFonts struct {
	regular    academicFace
	bold       academicFace
	italic     academicFace
	boldItalic academicFace
}

type academicFontCacheEntry struct {
	once  sync.Once
	fonts AcademicFonts
	err   error
}

type academicFontSpec struct {
	role, filename, postScriptName string
	bold, italic                   bool
	assign                         func(*AcademicFonts, academicFace)
}

var academicFontCache sync.Map
var academicFontBestEffortCache sync.Map

var academicFontSpecs = []academicFontSpec{
	{
		role: "regular", filename: "times.ttf", postScriptName: "TimesNewRomanPSMT",
		assign: func(fonts *AcademicFonts, face academicFace) { fonts.regular = face },
	},
	{
		role: "bold", filename: "timesbd.ttf", postScriptName: "TimesNewRomanPS-BoldMT", bold: true,
		assign: func(fonts *AcademicFonts, face academicFace) { fonts.bold = face },
	},
	{
		role: "italic", filename: "timesi.ttf", postScriptName: "TimesNewRomanPS-ItalicMT", italic: true,
		assign: func(fonts *AcademicFonts, face academicFace) { fonts.italic = face },
	},
	{
		role: "bold_italic", filename: "timesbi.ttf", postScriptName: "TimesNewRomanPS-BoldItalicMT", bold: true, italic: true,
		assign: func(fonts *AcademicFonts, face academicFace) { fonts.boldItalic = face },
	},
}

// LoadAcademicFonts validates one immutable Times New Roman resource set.
// Results, including failures, are cached by configured directory until restart.
func LoadAcademicFonts(dir string) (AcademicFonts, error) {
	if dir == "" {
		return AcademicFonts{}, academicFontError("all", "missing_directory")
	}
	key := filepath.Clean(dir)
	value, _ := academicFontCache.LoadOrStore(key, &academicFontCacheEntry{})
	entry := value.(*academicFontCacheEntry)
	entry.once.Do(func() {
		entry.fonts, entry.err = loadAcademicFonts(key)
	})
	if entry.err != nil {
		return AcademicFonts{}, entry.err
	}
	return cloneAcademicFonts(entry.fonts), nil
}

// LoadAcademicFontsBestEffort loads any individually valid Times New Roman faces.
// Missing or invalid faces are skipped. Results are cached by directory until restart.
func LoadAcademicFontsBestEffort(dir string) AcademicFonts {
	if dir == "" {
		return AcademicFonts{}
	}
	key := filepath.Clean(dir)
	value, _ := academicFontBestEffortCache.LoadOrStore(key, &academicFontCacheEntry{})
	entry := value.(*academicFontCacheEntry)
	entry.once.Do(func() {
		entry.fonts = loadAcademicFontsBestEffort(key)
	})
	return cloneAcademicFonts(entry.fonts)
}

func loadAcademicFonts(dir string) (AcademicFonts, error) {
	var fonts AcademicFonts
	seen := make(map[string]struct{}, len(academicFontSpecs))
	for _, spec := range academicFontSpecs {
		face, err := evaluateAcademicFace(dir, spec, seen)
		if err != nil {
			return AcademicFonts{}, err
		}
		seen[face.postScriptName] = struct{}{}
		spec.assign(&fonts, face)
	}
	return fonts, nil
}

func loadAcademicFontsBestEffort(dir string) AcademicFonts {
	var fonts AcademicFonts
	seen := make(map[string]struct{}, len(academicFontSpecs))
	for _, spec := range academicFontSpecs {
		face, ok := loadAcademicFace(dir, spec, seen)
		if !ok {
			continue
		}
		spec.assign(&fonts, face)
	}
	return fonts
}

func loadAcademicFace(dir string, spec academicFontSpec, seen map[string]struct{}) (academicFace, bool) {
	face, err := evaluateAcademicFace(dir, spec, seen)
	if err != nil {
		return academicFace{}, false
	}
	seen[face.postScriptName] = struct{}{}
	return face, true
}

func evaluateAcademicFace(dir string, spec academicFontSpec, seen map[string]struct{}) (academicFace, error) {
	path := filepath.Join(dir, spec.filename)
	data, err := os.ReadFile(path)
	if err != nil {
		reason := "unreadable"
		if errors.Is(err, os.ErrNotExist) {
			reason = "missing"
		}
		return academicFace{}, academicFontError(spec.role, reason)
	}
	if reason := validateAcademicSFNT(data); reason != "" {
		return academicFace{}, academicFontError(spec.role, reason)
	}

	record, err := parseAcademicTTF(data)
	if err != nil {
		return academicFace{}, academicFontError(spec.role, "parser")
	}
	if _, duplicate := seen[record.PostScriptName]; duplicate {
		return academicFace{}, academicFontError(spec.role, "duplicate_role")
	}
	if record.PostScriptName != spec.postScriptName {
		return academicFace{}, academicFontError(spec.role, "wrong_family")
	}
	if record.Bold != spec.bold || (record.ItalicAngle != 0) != spec.italic {
		return academicFace{}, academicFontError(spec.role, "role_mismatch")
	}
	if !record.Embeddable {
		return academicFace{}, academicFontError(spec.role, "embedding_rights")
	}
	if len(record.Chars) == 0 {
		return academicFace{}, academicFontError(spec.role, "missing_glyphs")
	}

	return academicFace{
		postScriptName: record.PostScriptName,
		data:           data,
		glyphs:         cloneGlyphs(record.Chars),
	}, nil
}

func academicFontError(role, reason string) error {
	return fmt.Errorf("%w: role=%s reason=%s", ErrAcademicFontsUnavailable, role, reason)
}

func parseAcademicTTF(data []byte) (record gofpdf.TtfType, err error) {
	path, err := writeAcademicFontSnapshot(data)
	if err != nil {
		return gofpdf.TtfType{}, err
	}
	defer func() {
		if removeErr := os.Remove(path); removeErr != nil && err == nil {
			record = gofpdf.TtfType{}
			err = errors.New("font snapshot cleanup failed")
		}
	}()
	defer func() {
		if recover() != nil {
			record = gofpdf.TtfType{}
			err = errors.New("font parser panic")
		}
	}()
	return gofpdf.TtfParse(path)
}

func writeAcademicFontSnapshot(data []byte) (path string, err error) {
	file, err := os.CreateTemp("", "phytomni-report-font-*.ttf")
	if err != nil {
		return "", err
	}
	path = file.Name()
	defer func() {
		if closeErr := file.Close(); closeErr != nil && err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(path)
			path = ""
		}
	}()
	if err = file.Chmod(0o600); err != nil {
		return path, err
	}
	n, err := file.Write(data)
	if err != nil {
		return path, err
	}
	if n != len(data) {
		return path, io.ErrShortWrite
	}
	return path, nil
}

func validateAcademicSFNT(data []byte) string {
	if len(data) < 12 || binary.BigEndian.Uint32(data[0:4]) != 0x00010000 {
		return "malformed"
	}
	numTables := uint64(binary.BigEndian.Uint16(data[4:6]))
	directoryEnd := uint64(12) + numTables*16
	if directoryEnd > uint64(len(data)) {
		return "malformed"
	}

	foundOS2 := false
	var fsType uint16
	for i := uint64(0); i < numTables; i++ {
		record := uint64(12) + i*16
		offset := uint64(binary.BigEndian.Uint32(data[record+8 : record+12]))
		length := uint64(binary.BigEndian.Uint32(data[record+12 : record+16]))
		if offset > uint64(len(data)) || length > uint64(len(data))-offset {
			return "malformed"
		}
		if string(data[record:record+4]) != "OS/2" {
			continue
		}
		if foundOS2 || length < 10 {
			return "malformed"
		}
		foundOS2 = true
		fsType = binary.BigEndian.Uint16(data[offset+8 : offset+10])
	}
	if !foundOS2 {
		return "malformed"
	}
	switch fsType {
	case 0, 4, 8:
		return ""
	default:
		return "embedding_rights"
	}
}

func cloneAcademicFonts(fonts AcademicFonts) AcademicFonts {
	return AcademicFonts{
		regular:    cloneAcademicFace(fonts.regular),
		bold:       cloneAcademicFace(fonts.bold),
		italic:     cloneAcademicFace(fonts.italic),
		boldItalic: cloneAcademicFace(fonts.boldItalic),
	}
}

func cloneAcademicFace(face academicFace) academicFace {
	return academicFace{
		postScriptName: face.postScriptName,
		data:           append([]byte(nil), face.data...),
		glyphs:         cloneGlyphs(face.glyphs),
	}
}

func cloneGlyphs(glyphs map[uint16]uint16) map[uint16]uint16 {
	cloned := make(map[uint16]uint16, len(glyphs))
	for code, glyph := range glyphs {
		cloned[code] = glyph
	}
	return cloned
}
