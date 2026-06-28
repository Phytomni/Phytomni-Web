package bot

import "fmt"

// Built-in upload bounds, overridable via app.yml bot.max_upload_*.
// 25 MiB per file matches Bot /v1/files, which 413s above that — failing
// fast in Web Go avoids a wasted round trip.
const (
	defaultMaxUploadFileBytes  int64 = 25 << 20
	defaultMaxUploadTotalBytes int64 = 50 << 20
	defaultMaxUploadFileCount  int   = 10
)

// UploadLimits returns the effective (per-file, total, count) upload bounds,
// reading app.yml overrides when set and otherwise the built-in defaults. It
// tolerates a nil BotConfig so callers and tests need no special-casing.
func UploadLimits() (fileBytes int64, totalBytes int64, count int) {
	fileBytes, totalBytes, count = defaultMaxUploadFileBytes, defaultMaxUploadTotalBytes, defaultMaxUploadFileCount
	if BotConfig == nil {
		return
	}
	if BotConfig.MaxUploadFileBytes > 0 {
		fileBytes = BotConfig.MaxUploadFileBytes
	}
	if BotConfig.MaxUploadTotalBytes > 0 {
		totalBytes = BotConfig.MaxUploadTotalBytes
	}
	if BotConfig.MaxUploadFileCount > 0 {
		count = BotConfig.MaxUploadFileCount
	}
	return
}

// CheckFiles validates an upload batch against the effective limits, returning
// a user-readable error on the first violation. sizes are per-file
// byte counts from the multipart headers.
func CheckFiles(sizes []int64) error {
	fileBytes, totalBytes, count := UploadLimits()
	if len(sizes) > count {
		return fmt.Errorf("number of uploaded files %d exceeds the limit %d", len(sizes), count)
	}
	var total int64
	for _, s := range sizes {
		if s > fileBytes {
			return fmt.Errorf("a single file exceeds the limit of %d bytes", fileBytes)
		}
		total += s
	}
	if total > totalBytes {
		return fmt.Errorf("total upload exceeds the limit of %d bytes", totalBytes)
	}
	return nil
}
