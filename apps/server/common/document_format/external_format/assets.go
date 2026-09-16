package external_format

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jung-kurt/gofpdf"
)

// CJKFontBytes returns an isolated copy of the existing fixed Microsoft YaHei
// resource. Callers cannot choose a resource name or mutate shared font bytes.
func CJKFontBytes() ([]byte, error) {
	data, err := files.ReadFile("msyh.ttf")
	if err != nil {
		return nil, fmt.Errorf("embedded CJK font unavailable")
	}
	return bytes.Clone(data), nil
}

// ScientificSymbolFontBytes returns an isolated copy of the embedded Noto Sans
// Symbols 2 resource. Callers cannot choose a resource name or mutate shared
// font bytes.
func ScientificSymbolFontBytes() ([]byte, error) {
	data, err := files.ReadFile("noto_sans_symbols_2.ttf")
	if err != nil {
		return nil, fmt.Errorf("embedded scientific symbol font unavailable")
	}
	return bytes.Clone(data), nil
}

func materialize(name string) (string, func(), error) {
	data, err := files.ReadFile(name)
	if err != nil {
		return "", func() {}, fmt.Errorf("missing embedded document asset %s: %w", name, err)
	}
	temp, err := os.CreateTemp("", "phytomni-doc-*"+filepath.Ext(name))
	if err != nil {
		return "", func() {}, err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		os.Remove(temp.Name())
		return "", func() {}, err
	}
	if err := temp.Close(); err != nil {
		os.Remove(temp.Name())
		return "", func() {}, err
	}
	return temp.Name(), func() { os.Remove(temp.Name()) }, nil
}

// WordTemplatePath writes the embedded Word shell to a temp file.
func WordTemplatePath() (string, func(), error) {
	return materialize("template.docx")
}

// EmptyWordPath writes the embedded empty Word shell to a temp file.
func EmptyWordPath() (string, func(), error) {
	return materialize("empty.docx")
}

// RegisterCJKFont loads an embedded TTF into the PDF without CWD paths.
func RegisterCJKFont(pdf *gofpdf.Fpdf, family, style, name string) error {
	data, err := files.ReadFile(name)
	if err != nil {
		return fmt.Errorf("missing embedded font %s: %w", name, err)
	}
	pdf.AddUTF8FontFromBytes(family, style, data)
	return nil
}
