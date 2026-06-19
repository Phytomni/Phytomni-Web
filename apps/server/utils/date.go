package utils

import (
	"fmt"
	"log"
	"strconv"
	"time"
)

const (
	DEFAULT_LAYOUT_DATE_TIME   = "2006-01-02 15:04:05"
	DEFAULT_LAYOUT_DATE_TIME_1 = "2006-01-02 15:04"
	DEFAULT_LAYOUT_DATE        = "2006-01-02"
	DEFAULT_LAYOUT_DATE_YMD    = "20060102"
)

func Validate(date string) bool {
	if _, err := time.ParseInLocation("2006/01/02", date, time.Local); err != nil {
		if _, err := time.ParseInLocation("2006/01", date, time.Local); err != nil {
			return false
		}
	}

	return true
}

// GetCurrentDateTime 获取当前日期时间
func GetCurrentDateTime() (dateTime string) {
	dateTime = time.Now().Format(DEFAULT_LAYOUT_DATE_TIME)
	return
}

// GetCurrentDate 获取当前日期Y-M-D
func GetCurrentDate() (dateTime string) {
	dateTime = time.Now().Format(DEFAULT_LAYOUT_DATE)
	return
}

// GetCurrentDateYMD 获取当前日期YMD
func GetCurrentDateYMD() (dateTime string) {
	dateTime = time.Now().Format(DEFAULT_LAYOUT_DATE_YMD)
	return
}

// CalculateAfterDate 几天后的日期
func CalculateAfterDate(dateInt int, days int) (result int) {
	// 待处理的日期字符串
	dateStr := strconv.Itoa(dateInt)
	// 解析日期字符串
	date, err := time.Parse(DEFAULT_LAYOUT_DATE_YMD, dateStr)
	if err != nil {
		fmt.Println("日期解析错误:", err)
		return
	}
	// 增加7天
	sevenDaysLater := date.AddDate(0, 0, days)
	// 格式化为指定格式
	result, _ = strconv.Atoi(sevenDaysLater.Format(DEFAULT_LAYOUT_DATE_YMD))
	return
}

// CalculateBeforeDate 几天前的日期
func CalculateBeforeDate(dateInt int, days int) (result string) {
	// 待处理的日期字符串
	dateStr := strconv.Itoa(dateInt)
	// 解析日期字符串
	t, err := time.Parse(DEFAULT_LAYOUT_DATE_YMD, dateStr)
	if err != nil {
		fmt.Println("日期解析错误:", err)
		return
	}
	// 计算7天前的日期
	before7Days := t.AddDate(0, 0, -days)
	// 格式化输出
	fmt.Println(before7Days.Format(DEFAULT_LAYOUT_DATE_YMD))

	result = before7Days.Format(DEFAULT_LAYOUT_DATE_YMD)
	return result
}

// GetCurrentUnixTimestamp 获取当前的时间戳
func GetCurrentUnixTimestamp() (timestamp int64) {
	timestamp = time.Now().Unix()
	return
}

// GetCurrentMilliseconds 获取当前的时间戳-毫秒
func GetCurrentMilliseconds() (timestamp int64) {
	// 获取当前时间
	now := time.Now()
	// 转换为Unix时间戳，单位为秒
	seconds := now.Unix()
	// 转换为毫秒时间戳
	milliseconds := seconds * 1000
	// 加上当前时间的纳秒部分，转换为毫秒
	milliseconds += int64(now.Nanosecond()) / 1e6
	return milliseconds
}

// GetDateToUnixTimestamp 日期时间格式转换成秒时间戳
func GetDateToUnixTimestamp(inputDateTime string) (timestamp int64) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai") //指定时区
	dateTime, err := time.ParseInLocation(DEFAULT_LAYOUT_DATE_TIME, inputDateTime, TimeLocation)
	if err != nil {
		return
	}
	timestamp = dateTime.Unix()
	return
}

// GetDateToUnixNanoTimestamp 日期时间格式转换成秒时间戳
func GetDateToUnixNanoTimestamp(inputDateTime string) (timestamp int64) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai") //指定时区
	dateTime, err := time.ParseInLocation(DEFAULT_LAYOUT_DATE_TIME, inputDateTime, TimeLocation)
	if err != nil {
		return
	}
	timestamp = dateTime.UnixNano()
	return
}

// GetUnixTimeToDate 时间戳转日期时间
func GetUnixTimeToDateTime(timestamp int64) (dateTime string) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai") //指定时区
	dateTime = time.Unix(timestamp, 0).In(TimeLocation).Format(DEFAULT_LAYOUT_DATE_TIME)
	return
}

// GetUnixTimeToDate 时间戳转日期时间
func GetUnixTimeToDateTime1(timestamp int64) (dateTime string) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai") //指定时区
	dateTime = time.Unix(timestamp, 0).In(TimeLocation).Format(DEFAULT_LAYOUT_DATE_TIME_1)
	return
}

// GetUnixTimeToDate 时间戳转日期Y-M-D
func GetUnixTimeToDate(timestamp int64) (dateTime string) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai") //指定时区
	dateTime = time.Unix(timestamp, 0).In(TimeLocation).Format(DEFAULT_LAYOUT_DATE)
	return
}

// GetUnixTimeToDateYMD 时间戳转日期YMD
func GetUnixTimeToDateYMD(timestamp int64) (dateTime string) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai") //指定时区
	dateTime = time.Unix(timestamp, 0).In(TimeLocation).Format(DEFAULT_LAYOUT_DATE_YMD)
	return
}

// defer GetTimeCost(time.Now(), "GetUnixTimeToDateYMD")
func GetTimeCost(start time.Time, tips string) {
	tc := time.Since(start)
	log.Printf("%s Time Const --> %#v \n", tips, tc)
}
