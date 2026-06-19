package utils

import (
	"crypto/subtle"
	"fmt"
	"regexp"
	"strings"

	"github.com/spf13/viper"
	"golang.org/x/crypto/bcrypt"
)

// minAllowedCost is our policy floor — above bcrypt.MinCost(4). A sub-floor cost
// is a silent security downgrade (bcrypt would coerce <MinCost to DefaultCost),
// so we refuse anything below DefaultCost. maxAllowedCost is bcrypt's hard max.
const (
	minAllowedCost = bcrypt.DefaultCost // 10
	maxAllowedCost = bcrypt.MaxCost     // 31
)

// legacyMD5Pattern matches the exact shape utils.MD5String emits: 32 lowercase
// hex chars. Anything else is NOT treated as a legacy hash (fails closed).
var legacyMD5Pattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// bcryptCost resolves the configured cost, defaulting to bcrypt.DefaultCost (10)
// when the bcrypt_cost key is unset/zero.
func bcryptCost() int {
	if c := viper.GetInt("bcrypt_cost"); c != 0 {
		return c
	}
	return bcrypt.DefaultCost
}

// ValidateBcryptCost fails closed at startup if bcrypt_cost is explicitly set
// outside the allowed [10,31] range. Call it once during boot.
func ValidateBcryptCost() error {
	c := viper.GetInt("bcrypt_cost")
	if c == 0 {
		return nil // unset -> DefaultCost
	}
	if c < minAllowedCost || c > maxAllowedCost {
		return fmt.Errorf("bcrypt_cost %d is outside the allowed range [%d,%d]", c, minAllowedCost, maxAllowedCost)
	}
	return nil
}

// HashPassword returns a bcrypt hash of plaintext at the configured cost.
// Returns an error for an out-of-range cost or a >72-byte password
// (bcrypt.ErrPasswordTooLong) — callers must treat that as a write failure.
func HashPassword(plaintext string) (string, error) {
	cost := bcryptCost()
	if cost < minAllowedCost || cost > maxAllowedCost {
		return "", fmt.Errorf("bcrypt_cost %d is outside the allowed range [%d,%d]", cost, minAllowedCost, maxAllowedCost)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plaintext), cost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword reports whether plaintext matches the stored hash, detecting the
// scheme from the stored value's shape. needsUpgrade is true ONLY when a legacy
// MD5 hash verified OK (the caller MAY re-hash with bcrypt). Never panics; any
// malformed/empty/NULL stored value yields (false, false, nil).
func VerifyPassword(stored, plaintext string) (ok bool, needsUpgrade bool, err error) {
	switch {
	case strings.HasPrefix(stored, "$2a$"), strings.HasPrefix(stored, "$2b$"), strings.HasPrefix(stored, "$2y$"):
		if cmpErr := bcrypt.CompareHashAndPassword([]byte(stored), []byte(plaintext)); cmpErr != nil {
			return false, false, nil
		}
		return true, false, nil
	case legacyMD5Pattern.MatchString(stored):
		if subtle.ConstantTimeCompare([]byte(MD5String(plaintext)), []byte(stored)) == 1 {
			return true, true, nil
		}
		return false, false, nil
	default:
		return false, false, nil
	}
}
