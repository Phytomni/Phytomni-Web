package utils

import (
	"reflect"
	"testing"
)

func TestRemoveDuplicatesPreservesFirstOccurrenceOrder(t *testing.T) {
	got := RemoveDuplicates([]int64{4, 2, 4, 1, 2, 4, 1})
	want := []int64{4, 2, 1}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RemoveDuplicates = %#v, want %#v", got, want)
	}
}
