package utils

import (
	"math/rand"
	"time"
)

// GenerateRandomTwoNumber 生成两个随机数
func GenerateRandomTwoNumber(max int) (num1 int, num2 int) {
	rand.Seed(time.Now().UnixNano())

	num1 = rand.Intn(max) + 1
	num2 = rand.Intn(max) + 1

	return
}
