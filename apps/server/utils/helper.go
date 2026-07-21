package utils

import (
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"unicode"
)

func SearchValue(needle interface{}, haystack interface{}) bool {
	val := reflect.ValueOf(haystack)
	switch val.Kind() {
	case reflect.Slice, reflect.Array:
		for i := 0; i < val.Len(); i++ {
			if reflect.DeepEqual(needle, val.Index(i).Interface()) {
				return true
			}
		}
	case reflect.Map:
		for _, k := range val.MapKeys() {
			if reflect.DeepEqual(needle, val.MapIndex(k).Interface()) {
				return true
			}
		}
	default:
		return false
	}

	return false
}

func RemoveDuplicateElement[T comparable](list []T) []T {
	var result = make([]T, 0, len(list))
	var m = map[T]struct{}{}

	for _, v := range list {
		if _, ok := m[v]; !ok {
			m[v] = struct{}{}
			result = append(result, v)
		}
	}

	return result
}

func SearchIndex(slice []string, element string) int {
	for i, v := range slice {
		if v == element {
			return i
		}
	}
	return -1
}

func ArraySlice[T any](s []T, offset, length uint) []T {
	if offset > uint(len(s)) {
		offset = uint(len(s)) - 1
	}
	end := offset + length
	if end < uint(len(s)) {
		return s[offset:end]
	}
	return s[offset:]
}

func TruncateString(s string, num int) string {
	runes := []rune(s)
	if len(runes) <= num {
		return s
	}
	return string(runes[:num])
}

func ClearMobileText(text string) (cleanedText string) {
	phoneRegex := regexp.MustCompile(`1[3456789]\d{9}`)
	matches := phoneRegex.FindAllString(text, -1)

	if matches != nil {
		cleanedText = phoneRegex.ReplaceAllString(text, "[phone number redacted]")
	} else {
		cleanedText = text
	}

	return
}

func RemoveDuplicates(slice []int64) []int64 {
	encountered := map[int64]bool{}
	result := []int64{}

	for v := range slice {
		if !encountered[slice[v]] {
			encountered[slice[v]] = true
			result = append(result, slice[v])
		}
	}

	return result
}

func RegContent(matchContent string, sensitiveWords []string) string {
	if len(sensitiveWords) < 1 {
		return matchContent
	}
	banWords := make([]string, 0)
	regStr := strings.Join(sensitiveWords, "|")
	wordReg := regexp.MustCompile(regStr)
	//println("regStr -> ", regStr)

	textBytes := wordReg.ReplaceAllFunc([]byte(matchContent), func(bytes []byte) []byte {
		banWords = append(banWords, string(bytes))
		textRunes := []rune(string(bytes))
		replaceBytes := make([]byte, 0)
		for i, runeLen := 0, len(textRunes); i < runeLen; i++ {
			replaceBytes = append(replaceBytes, byte('*'))
		}
		return replaceBytes
	})
	return string(textBytes)
}

func ExistDir(path string) {
	_, err := os.ReadDir(path)
	if err != nil {
		_ = os.MkdirAll(path, fs.ModePerm)
	}
}

func SplitFilePath(path string) (dir, name, suffix string) {
	dir = filepath.Dir(path)
	baseName := filepath.Base(path)
	if suffix = filepath.Ext(baseName); suffix != "" {
		name = baseName[:len(baseName)-len(suffix)]
		suffix = strings.ReplaceAll(suffix, ".", "")
		return
	}
	name = baseName
	return
}

func IsDigits(s string) bool {
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}
