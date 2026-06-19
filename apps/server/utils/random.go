package utils

import (
	"math/rand"
	"time"
)

func RandomString(n int) string {
	var letter = []rune("AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789")
	rnd := rand.New(rand.NewSource(time.Now().UnixNano()))

	b := make([]rune, n)
	for i := range b {
		b[i] = letter[rnd.Intn(len(letter))]
	}
	return string(b)
}

func RandomStringNumber(n int) string {
	var letter = []rune("0123456789")
	rnd := rand.New(rand.NewSource(time.Now().UnixNano()))

	b := make([]rune, n)
	for i := range b {
		b[i] = letter[rnd.Intn(len(letter))]
	}
	return string(b)
}
