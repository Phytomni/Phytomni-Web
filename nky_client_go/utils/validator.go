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

// ValidatePasswordComplexity 校验密码复杂度
// 要求包含：大小写字母、数字及标点符号
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
			// 假设非字母数字即为特殊字符/标点符号
			hasSpecial = true
		}
	}
	return hasUpper && hasLower && hasNumber && hasSpecial
}
