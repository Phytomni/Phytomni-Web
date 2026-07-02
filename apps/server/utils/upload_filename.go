package utils

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ErrInvalidUploadFilename is returned when a filename is empty, contains
// path separators, traversal sequences, null bytes, or would escape its base
// directory after joining.
var ErrInvalidUploadFilename = errors.New("invalid upload filename")

// CleanUploadFilename validates that name is a safe basename for upload
// storage. It rejects empty names, absolute paths, traversal sequences,
// directory separators, and null bytes. The returned string is the original
// name when safe, or empty on error.
func CleanUploadFilename(name string) (string, error) {
	if name == "" || strings.TrimSpace(name) == "" {
		return "", ErrInvalidUploadFilename
	}
	if strings.ContainsRune(name, 0) {
		return "", ErrInvalidUploadFilename
	}
	if filepath.IsAbs(name) || name == "." || name == ".." {
		return "", ErrInvalidUploadFilename
	}
	if strings.Contains(name, "/") || strings.Contains(name, `\`) {
		return "", ErrInvalidUploadFilename
	}
	if filepath.Base(name) != name {
		return "", ErrInvalidUploadFilename
	}
	return name, nil
}

// SafeJoinUploadPath joins baseDir and filename into an absolute path and
// verifies the result stays inside baseDir. It delegates basename validation
// to CleanUploadFilename and adds a post-join containment check.
func SafeJoinUploadPath(baseDir, filename string) (string, error) {
	safeName, err := CleanUploadFilename(filename)
	if err != nil {
		return "", err
	}
	target := filepath.Join(baseDir, safeName)
	rel, err := filepath.Rel(baseDir, target)
	if err != nil {
		return "", err
	}
	if rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", ErrInvalidUploadFilename
	}
	return target, nil
}
