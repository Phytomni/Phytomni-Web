package utils

import (
	"fmt"
	"math/rand"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/bwmarrin/snowflake"
	"gorm.io/gorm/schema"
)

// node 实例
var node, _ = snowflake.NewNode(1)

// SnowflakeGenUUID 雪花算法UUID
func SnowflakeGenUUID() string {
	return node.Generate().String()
}

// GenDefaultPwd 生成默认密码
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

// GetStructRequiredMsg 获取结构体必填项
func GetStructRequiredMsg(s any) string {

	var strList []string
	refType := reflect.TypeOf(s)
	for i := 0; i < refType.NumField(); i++ {
		validate := refType.Field(i).Tag.Get("validate")
		gorm := refType.Field(i).Tag.Get("gorm")
		if strings.HasPrefix(validate, "required") {
			mapString := schema.ParseTagSetting(gorm, ";")
			if mapString["COMMENT"] != "" {
				mapString["COMMENT"] = strings.Replace(mapString["COMMENT"], "类型ID", "类型", 1)
				mapString["COMMENT"] = strings.Replace(mapString["COMMENT"], "栏目ID", "栏目", 1)
				strList = append(strList, mapString["COMMENT"])
			}
		}
	}

	return fmt.Sprintf("\n导入说明：\n1、其中%s为必填字段；\n", strings.Join(strList, "、"))
}

// SliceOffset 返回切片中的选定部分
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

// ReplaceHtml 替换html标签
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

// Contains 判断切片是否存在元素
func Contains[T comparable](s []T, e T) bool {
	for _, v := range s {
		if v == e {
			return true
		}
	}
	return false
}
