package utils

import "testing"

func TestCalculateAfterDate(t *testing.T) {
	if got := CalculateAfterDate(20260801, 7); got != 20260808 {
		t.Fatalf("CalculateAfterDate() = %d, want %d", got, 20260808)
	}
}

func TestCalculateBeforeDate(t *testing.T) {
	if got := CalculateBeforeDate(20260808, 7); got != "20260801" {
		t.Fatalf("CalculateBeforeDate() = %q, want %q", got, "20260801")
	}
}

func TestCalculateDateInvalidInput(t *testing.T) {
	if got := CalculateAfterDate(20261301, 7); got != 0 {
		t.Fatalf("CalculateAfterDate() invalid input = %d, want 0", got)
	}
	if got := CalculateBeforeDate(20261301, 7); got != "" {
		t.Fatalf("CalculateBeforeDate() invalid input = %q, want empty result", got)
	}
}
