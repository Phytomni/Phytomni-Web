package validator

// VerifyLimit validates pagination limit and page parameters.
func VerifyLimit(l, p int) (int, int) {
	if l < 1 {
		l = 1
	}

	if l > 50 {
		l = 50
	}

	if p < 1 {
		p = 1
	}

	return l, p
}

// VerifyPage applies default pagination.
func VerifyPage(l, p int) (int, int) {
	if p < 1 {
		p = 1
	}

	if l <= 1 {
		l = 100
	}

	return l, p
}
