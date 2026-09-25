package external_format

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
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

// Pinned Noto Sans Symbols 2 Regular v2.008 from notofonts/symbols
// (NotoSansSymbols2-v2.008.zip / NotoSansSymbols2/hinted/ttf/NotoSansSymbols2-Regular.ttf).
// SHA-256: c4a0a80f0041ce4be81e2478faad22776d23edb98ae3f0d19bd37044820ecf9d
func TestScientificSymbolFontBytesAreIsolated(t *testing.T) {
	first, err := ScientificSymbolFontBytes()
	if err != nil {
		t.Fatal(err)
	}
	original := append([]byte(nil), first...)
	if len(first) < 12 {
		t.Fatal("missing scientific symbol font")
	}
	if binary.BigEndian.Uint32(first[:4]) != 0x00010000 {
		t.Fatal("invalid SFNT header")
	}
	sum := sha256.Sum256(first)
	if hex.EncodeToString(sum[:]) != "c4a0a80f0041ce4be81e2478faad22776d23edb98ae3f0d19bd37044820ecf9d" {
		t.Fatal("unexpected scientific symbol font")
	}
	for _, r := range []rune{0x2218, 0x2219, 0x2299, 0x22C5, 0x22C6, 0x2609, 0x2622, 0x2623} {
		if !sfntContainsGlyph(first, r) {
			t.Fatalf("missing scientific symbol U+%04X", r)
		}
	}
	first[0] ^= 255
	second, err := ScientificSymbolFontBytes()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(second, original) {
		t.Fatal("caller mutated shared font")
	}
}

func sfntContainsGlyph(data []byte, r rune) bool {
	if len(data) < 12 || r < 0 {
		return false
	}
	numTables := int(binary.BigEndian.Uint16(data[4:6]))
	for i := 0; i < numTables; i++ {
		record := 12 + i*16
		if record+16 > len(data) {
			return false
		}
		if string(data[record:record+4]) != "cmap" {
			continue
		}
		offset := int(binary.BigEndian.Uint32(data[record+8 : record+12]))
		length := int(binary.BigEndian.Uint32(data[record+12 : record+16]))
		if offset < 0 || length < 4 || offset+length > len(data) {
			return false
		}
		return cmapContainsGlyph(data[offset:offset+length], uint32(r))
	}
	return false
}

func cmapContainsGlyph(cmap []byte, cp uint32) bool {
	numTables := int(binary.BigEndian.Uint16(cmap[2:4]))
	for i := 0; i < numTables; i++ {
		record := 4 + i*8
		if record+8 > len(cmap) {
			return false
		}
		sub := int(binary.BigEndian.Uint32(cmap[record+4 : record+8]))
		if sub < 0 || sub+2 > len(cmap) {
			continue
		}
		switch binary.BigEndian.Uint16(cmap[sub : sub+2]) {
		case 4:
			if cmapFormat4Glyph(cmap[sub:], cp) != 0 {
				return true
			}
		case 12:
			if cmapFormat12Glyph(cmap[sub:], cp) != 0 {
				return true
			}
		}
	}
	return false
}

func cmapFormat4Glyph(table []byte, cp uint32) uint16 {
	if cp > 0xFFFF || len(table) < 16 {
		return 0
	}
	segCount := int(binary.BigEndian.Uint16(table[6:8])) / 2
	endOff := 14
	startOff := endOff + 2*segCount + 2
	deltaOff := startOff + 2*segCount
	rangeOff := deltaOff + 2*segCount
	if rangeOff+2*segCount > len(table) {
		return 0
	}
	for i := 0; i < segCount; i++ {
		start := uint32(binary.BigEndian.Uint16(table[startOff+2*i : startOff+2*i+2]))
		end := uint32(binary.BigEndian.Uint16(table[endOff+2*i : endOff+2*i+2]))
		if cp < start || cp > end {
			continue
		}
		idDelta := int16(binary.BigEndian.Uint16(table[deltaOff+2*i : deltaOff+2*i+2]))
		idRangeOffset := binary.BigEndian.Uint16(table[rangeOff+2*i : rangeOff+2*i+2])
		if idRangeOffset == 0 {
			return uint16(int32(cp) + int32(idDelta))
		}
		index := rangeOff + 2*i + int(idRangeOffset) + 2*int(cp-start)
		if index < 0 || index+2 > len(table) {
			return 0
		}
		gid := binary.BigEndian.Uint16(table[index : index+2])
		if gid == 0 {
			return 0
		}
		return uint16(int32(gid) + int32(idDelta))
	}
	return 0
}

func cmapFormat12Glyph(table []byte, cp uint32) uint16 {
	if len(table) < 16 {
		return 0
	}
	nGroups := int(binary.BigEndian.Uint32(table[12:16]))
	for i := 0; i < nGroups; i++ {
		record := 16 + i*12
		if record+12 > len(table) {
			return 0
		}
		start := binary.BigEndian.Uint32(table[record : record+4])
		end := binary.BigEndian.Uint32(table[record+4 : record+8])
		if cp < start || cp > end {
			continue
		}
		gid := binary.BigEndian.Uint32(table[record+8:record+12]) + (cp - start)
		if gid == 0 || gid > 0xFFFF {
			return 0
		}
		return uint16(gid)
	}
	return 0
}
