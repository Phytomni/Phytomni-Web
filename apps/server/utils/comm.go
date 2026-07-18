package utils

import (
	"fmt"
	"math/rand"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm/schema"
)

func GenDefaultPwd(n int) string {
	var letter = []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
	rnd := rand.New(rand.NewSource(time.Now().UnixNano()))

	b := make([]rune, n-2)
	for i := range b {
		b[i] = letter[rnd.Intn(len(letter))]
	}

	number := RandomStringNumber(2)
	return fmt.Sprintf("%s%s", string(b), number)
}

func GetStructRequiredMsg(s any) string {

	var strList []string
	refType := reflect.TypeOf(s)
	for i := 0; i < refType.NumField(); i++ {
		validate := refType.Field(i).Tag.Get("validate")
		gorm := refType.Field(i).Tag.Get("gorm")
		if strings.HasPrefix(validate, "required") {
			mapString := schema.ParseTagSetting(gorm, ";")
			if mapString["COMMENT"] != "" {
				mapString["COMMENT"] = strings.Replace(mapString["COMMENT"], "type ID", "type", 1)
				mapString["COMMENT"] = strings.Replace(mapString["COMMENT"], "section ID", "section", 1)
				strList = append(strList, mapString["COMMENT"])
			}
		}
	}

	return fmt.Sprintf("\nImport notes:\n1. %s are required fields;\n", strings.Join(strList, ", "))
}

// SliceOffset returns a selected sub-slice.
func SliceOffset[T any](s []T, offset, length uint) []T {
	if offset > uint(len(s)) {
		offset = uint(len(s)) - 1
	}
	end := offset + length
	if end < uint(len(s)) {
		return s[offset:end]
	}
	return s[offset:]
}

// ReplaceHtml strips HTML tags.
func ReplaceHtml(text string) string {
	return regexp.MustCompile("<[^>]*>").ReplaceAllString(text, "")
}

func FormatSliceUintString(idS []uint) (str string) {
	strS := make([]string, len(idS))
	for i, number := range idS {
		strS[i] = strconv.Itoa(int(number))
	}
	str = strings.Join(strS, ",")
	return
}

// Contains reports whether the slice contains the element.
func Contains[T comparable](s []T, e T) bool {
	for _, v := range s {
		if v == e {
			return true
		}
	}
	return false
}
