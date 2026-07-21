package utils

import "testing"

func TestGenerateRandomTwoNumberReturnsValuesWithinBounds(t *testing.T) {
	const max = 7
	for i := 0; i < 100; i++ {
		num1, num2 := GenerateRandomTwoNumber(max)
		if num1 < 1 || num1 > max || num2 < 1 || num2 > max {
			t.Fatalf("GenerateRandomTwoNumber(%d) = (%d, %d), values must be in [1,%d]", max, num1, num2, max)
		}
	}
}
