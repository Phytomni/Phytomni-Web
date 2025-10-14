package utils

import (
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// SearchValue 查询值是否在数组，切片，map中
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

// RemoveDuplicateElement 数组去重
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

// SearchIndex 查找切片下标
func SearchIndex(slice []string, element string) int {
	for i, v := range slice {
		if v == element {
			return i
		}
	}
	return -1
}

// ArraySlice 返回切片中的选定部分
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

// TruncateString 截取指定的字符串
func TruncateString(s string, num int) string {
	runes := []rune(s)
	if len(runes) <= num {
		return s
	}
	return string(runes[:num])
}

// ClearMobileText 清除手机号
func ClearMobileText(text string) (cleanedText string) {
	// 定义手机号的正则表达式
	phoneRegex := regexp.MustCompile(`1[3456789]\d{9}`)

	// 查找所有匹配的手机号
	matches := phoneRegex.FindAllString(text, -1)

	if matches != nil {
		//fmt.Println("找到的手机号：", matches)
		// 将手机号去除
		cleanedText = phoneRegex.ReplaceAllString(text, "[手机号敏感数据不予显示]")
		//fmt.Println("去除手机号后的文本：", cleanedText)
	} else {
		cleanedText = text
		//fmt.Println("未找到手机号")
	}

	return
}

// RemoveDuplicates 切片去重
func RemoveDuplicates(slice []int64) []int64 {
	encountered := map[int64]bool{}
	result := []int64{}

	for v := range slice {
		if encountered[slice[v]] != true {
			encountered[slice[v]] = true
			result = append(result, slice[v])
		}
	}

	return result
}

// RegContent 正则匹配敏感词
func RegContent(matchContent string, sensitiveWords []string) string {
	if len(sensitiveWords) < 1 {
		return matchContent
	}
	banWords := make([]string, 0) // 收集匹配到的敏感词

	// 构造正则匹配字符
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
	//fmt.Println("srcText        -> ", matchContent)
	//fmt.Println("replaceText    -> ", string(textBytes))
	//fmt.Println("sensitiveWords -> ", banWords)
	return string(textBytes)
}

// ExistDir 创建目录
func ExistDir(path string) {
	// 判断路径是否存在
	_, err := os.ReadDir(path)
	if err != nil {
		// 不存在就创建
		err = os.MkdirAll(path, fs.ModePerm)
		if err != nil {
			fmt.Println(err)
		}
	}
}

func DownloadReader(url string, readerHelper func(reader io.Reader) error) (err error) {
	httpCli := http.Client{}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return
	}

	resp, err := httpCli.Do(req)
	if err != nil {
		return
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	return readerHelper(resp.Body)
}

func DownloadToDir(url string, name, outDir string) (path string, size int64, err error) {
	path = fmt.Sprintf("%s/%s", outDir, name)
	file, err := os.Create(path)
	if err != nil {
		return
	}

	defer func() {
		_ = file.Close()
	}()

	if err = DownloadReader(url, func(reader io.Reader) error {
		if size, err = io.Copy(file, reader); err != nil {
			return err
		}

		return nil
	}); err != nil {
		return
	}

	return
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

func GetFileSize(url string) (int, error) {
	resp, err := http.Get(url)
	if err != nil {
		os.Exit(1)
		return 0, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	contentLength, err := strconv.Atoi(resp.Header.Get("Content-Length"))
	if err != nil {
		os.Exit(1)
		return 0, err
	}
	return contentLength, nil
}

// IsDigits 检查字符串是否全是数字
func IsDigits(s string) bool {
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}
