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

func GetCurrentDateTime() (dateTime string) {
	dateTime = time.Now().Format(DEFAULT_LAYOUT_DATE_TIME)
	return
}

func GetCurrentDate() (dateTime string) {
	dateTime = time.Now().Format(DEFAULT_LAYOUT_DATE)
	return
}

func GetCurrentDateYMD() (dateTime string) {
	dateTime = time.Now().Format(DEFAULT_LAYOUT_DATE_YMD)
	return
}

func CalculateAfterDate(dateInt int, days int) (result int) {
	dateStr := strconv.Itoa(dateInt)
	date, err := time.Parse(DEFAULT_LAYOUT_DATE_YMD, dateStr)
	if err != nil {
		fmt.Println("date parse error:", err)
		return
	}
	sevenDaysLater := date.AddDate(0, 0, days)
	result, _ = strconv.Atoi(sevenDaysLater.Format(DEFAULT_LAYOUT_DATE_YMD))
	return
}

func CalculateBeforeDate(dateInt int, days int) (result string) {
	dateStr := strconv.Itoa(dateInt)
	t, err := time.Parse(DEFAULT_LAYOUT_DATE_YMD, dateStr)
	if err != nil {
		fmt.Println("date parse error:", err)
		return
	}
	before7Days := t.AddDate(0, 0, -days)
	fmt.Println(before7Days.Format(DEFAULT_LAYOUT_DATE_YMD))

	result = before7Days.Format(DEFAULT_LAYOUT_DATE_YMD)
	return result
}

func GetCurrentUnixTimestamp() (timestamp int64) {
	timestamp = time.Now().Unix()
	return
}

func GetCurrentMilliseconds() (timestamp int64) {
	now := time.Now()
	seconds := now.Unix()
	milliseconds := seconds * 1000
	milliseconds += int64(now.Nanosecond()) / 1e6
	return milliseconds
}

func GetDateToUnixTimestamp(inputDateTime string) (timestamp int64) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai")
	dateTime, err := time.ParseInLocation(DEFAULT_LAYOUT_DATE_TIME, inputDateTime, TimeLocation)
	if err != nil {
		return
	}
	timestamp = dateTime.Unix()
	return
}

func GetDateToUnixNanoTimestamp(inputDateTime string) (timestamp int64) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai")
	dateTime, err := time.ParseInLocation(DEFAULT_LAYOUT_DATE_TIME, inputDateTime, TimeLocation)
	if err != nil {
		return
	}
	timestamp = dateTime.UnixNano()
	return
}

func GetUnixTimeToDateTime(timestamp int64) (dateTime string) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai")
	dateTime = time.Unix(timestamp, 0).In(TimeLocation).Format(DEFAULT_LAYOUT_DATE_TIME)
	return
}

func GetUnixTimeToDateTime1(timestamp int64) (dateTime string) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai")
	dateTime = time.Unix(timestamp, 0).In(TimeLocation).Format(DEFAULT_LAYOUT_DATE_TIME_1)
	return
}

func GetUnixTimeToDate(timestamp int64) (dateTime string) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai")
	dateTime = time.Unix(timestamp, 0).In(TimeLocation).Format(DEFAULT_LAYOUT_DATE)
	return
}

func GetUnixTimeToDateYMD(timestamp int64) (dateTime string) {
	TimeLocation, _ := time.LoadLocation("Asia/Shanghai")
	dateTime = time.Unix(timestamp, 0).In(TimeLocation).Format(DEFAULT_LAYOUT_DATE_YMD)
	return
}

func GetTimeCost(start time.Time, tips string) {
	tc := time.Since(start)
	log.Printf("%s Time Const --> %#v \n", tips, tc)
}
