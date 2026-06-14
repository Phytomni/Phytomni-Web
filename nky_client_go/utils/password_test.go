package utils

import (
	"strings"
	"testing"

	"github.com/spf13/viper"
	"golang.org/x/crypto/bcrypt"
)

func TestHashPassword_ProducesVerifiableBcrypt(t *testing.T) {
	hash, err := HashPassword("goodpass")
	if err != nil {
		t.Fatalf("HashPassword error: %v", err)
	}
	if !strings.HasPrefix(hash, "$2a$") || len(hash) != 60 {
		t.Fatalf("expected a 60-char $2a$ bcrypt hash, got len=%d %q", len(hash), hash)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte("goodpass")); err != nil {
		t.Errorf("produced hash does not verify its own password: %v", err)
	}
}

func TestHashPassword_RejectsOver72Bytes(t *testing.T) {
	// bcrypt v0.36.0 returns ErrPasswordTooLong for >72 bytes (it does NOT truncate).
	_, err := HashPassword(strings.Repeat("a", 73))
	if err == nil {
		t.Fatal("expected an error for a 73-byte password, got nil")
	}
}

func TestVerifyPassword_BcryptBranch(t *testing.T) {
	hash, _ := HashPassword("goodpass")
	ok, needsUpgrade, err := VerifyPassword(hash, "goodpass")
	if err != nil || !ok || needsUpgrade {
		t.Fatalf("bcrypt correct: want ok=true upgrade=false err=nil, got ok=%v upgrade=%v err=%v", ok, needsUpgrade, err)
	}
	ok, _, _ = VerifyPassword(hash, "wrong")
	if ok {
		t.Error("bcrypt wrong password verified true")
	}
}

func TestVerifyPassword_LegacyMD5Branch(t *testing.T) {
	stored := MD5String("goodpass") // 32-char lowercase hex
	ok, needsUpgrade, err := VerifyPassword(stored, "goodpass")
	if err != nil || !ok || !needsUpgrade {
		t.Fatalf("md5 correct: want ok=true upgrade=true err=nil, got ok=%v upgrade=%v err=%v", ok, needsUpgrade, err)
	}
	ok, needsUpgrade, _ = VerifyPassword(stored, "wrong")
	if ok || needsUpgrade {
		t.Errorf("md5 wrong: want ok=false upgrade=false, got ok=%v upgrade=%v", ok, needsUpgrade)
	}
}

func TestVerifyPassword_FailsClosedOnMalformed(t *testing.T) {
	for _, stored := range []string{
		"",                                  // empty (NULL maps to "" in Go)
		"ABCDEF0123456789ABCDEF0123456789",  // uppercase hex
		"0123456789abcdef",                  // too short
		"0123456789abcdef0123456789abcdef0", // 33 chars
		"not-a-hash",                        // garbage
		"$1$xyz",                            // non-bcrypt $ prefix
	} {
		ok, needsUpgrade, err := VerifyPassword(stored, "anything")
		if ok || needsUpgrade || err != nil {
			t.Errorf("malformed %q: want ok=false upgrade=false err=nil, got ok=%v upgrade=%v err=%v", stored, ok, needsUpgrade, err)
		}
	}
}

func TestValidateBcryptCost(t *testing.T) {
	defer viper.Set("bcrypt_cost", 0)

	viper.Set("bcrypt_cost", 0) // unset -> ok (defaults to DefaultCost)
	if err := ValidateBcryptCost(); err != nil {
		t.Errorf("unset cost should be valid, got %v", err)
	}
	viper.Set("bcrypt_cost", 12)
	if err := ValidateBcryptCost(); err != nil {
		t.Errorf("cost 12 should be valid, got %v", err)
	}
	viper.Set("bcrypt_cost", 4) // below our policy floor of 10
	if err := ValidateBcryptCost(); err == nil {
		t.Error("cost 4 should be rejected (below policy floor 10)")
	}
	viper.Set("bcrypt_cost", 99) // above bcrypt.MaxCost
	if err := ValidateBcryptCost(); err == nil {
		t.Error("cost 99 should be rejected (above MaxCost)")
	}
}
