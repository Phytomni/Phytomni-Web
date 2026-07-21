package utils

import (
	"math/rand"
)

// GenerateRandomTwoNumber returns two random numbers in [1, max].
func GenerateRandomTwoNumber(max int) (num1 int, num2 int) {
	num1 = rand.Intn(max) + 1
	num2 = rand.Intn(max) + 1

	return
}
