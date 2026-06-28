package utils

func DefaultIntOne(number *int) {
	if *number < 1 {
		*number = 1
	}
}

func DefaultIntFifty(number *int) {
	if *number < 1 {
		*number = 50
	}
}

// ValidatePasswordComplexity checks password complexity:
// requires uppercase, lowercase, digits, and punctuation/special characters.
func ValidatePasswordComplexity(password string) bool {
	if len(password) < 8 {
		return false
	}
	var (
		hasUpper   bool
		hasLower   bool
		hasNumber  bool
		hasSpecial bool
	)
	for _, char := range password {
		switch {
		case 'A' <= char && char <= 'Z':
			hasUpper = true
		case 'a' <= char && char <= 'z':
			hasLower = true
		case '0' <= char && char <= '9':
			hasNumber = true
		default:
			// treat any non-alphanumeric rune as a special/punctuation character
			hasSpecial = true
		}
	}
	return hasUpper && hasLower && hasNumber && hasSpecial
}
