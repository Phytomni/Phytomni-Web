package external_format

import (
	"bytes"
	"testing"
)

func TestFixedCJKFontBytesAreIsolated(t *testing.T) {
	first, err := CJKFontBytes()
	if err != nil {
		t.Fatal(err)
	}
	original := append([]byte(nil), first...)
	if len(first) < 12 {
		t.Fatal("missing fixed font")
	}
	first[0] ^= 255
	second, err := CJKFontBytes()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(second, original) {
		t.Fatal("caller mutated shared font")
	}
}
