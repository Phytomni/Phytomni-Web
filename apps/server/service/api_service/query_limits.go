package api_service

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const (
	queryControlBodyFloor     int64 = 2 << 20
	queryControlAuxiliaryRoom int64 = 1 << 20
)

var (
	ErrQueryEmpty         = errors.New("query is empty")
	ErrQueryLimitExceeded = errors.New("query limit exceeded")
)

func ValidateCurrentQuery(value string, maxChars int) error {
	if strings.TrimSpace(value) == "" {
		return ErrQueryEmpty
	}
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > maxChars {
		return ErrQueryLimitExceeded
	}
	return nil
}

func QueryControlBodyLimit(maxChars int) int64 {
	candidate := int64(maxChars)*utf8.UTFMax + queryControlAuxiliaryRoom
	if candidate < queryControlBodyFloor {
		return queryControlBodyFloor
	}
	return candidate
}
