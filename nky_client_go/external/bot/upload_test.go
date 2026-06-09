package bot

import "testing"

func TestUploadLimitsDefaults(t *testing.T) {
	BotConfig = nil // helper must fall back to package defaults
	fb, tb, n := UploadLimits()
	if fb != 25<<20 || tb != 50<<20 || n != 10 {
		t.Errorf("defaults = %d,%d,%d; want 26214400,52428800,10", fb, tb, n)
	}
}

func TestUploadLimitsFromConfig(t *testing.T) {
	BotConfig = &Config{MaxUploadFileBytes: 1 << 20, MaxUploadTotalBytes: 2 << 20, MaxUploadFileCount: 3}
	defer func() { BotConfig = nil }()
	fb, tb, n := UploadLimits()
	if fb != 1<<20 || tb != 2<<20 || n != 3 {
		t.Errorf("config override = %d,%d,%d", fb, tb, n)
	}
}

func TestCheckFiles(t *testing.T) {
	BotConfig = &Config{MaxUploadFileBytes: 100, MaxUploadTotalBytes: 250, MaxUploadFileCount: 2}
	defer func() { BotConfig = nil }()
	if err := CheckFiles([]int64{50, 50}); err != nil {
		t.Errorf("within limits should pass: %v", err)
	}
	if err := CheckFiles([]int64{50, 50, 50}); err == nil {
		t.Error("over count should fail")
	}
	if err := CheckFiles([]int64{200}); err == nil {
		t.Error("over per-file should fail")
	}
	if err := CheckFiles([]int64{90, 90, 90}); err == nil { // also trips count, but total guard must hold independently
		t.Error("over total should fail")
	}
}
