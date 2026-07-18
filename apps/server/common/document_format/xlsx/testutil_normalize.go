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
