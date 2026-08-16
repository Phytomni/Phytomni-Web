package external_format

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/jung-kurt/gofpdf"
)

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
