package validator

// VerifyLimit 验证分页limit和p参数
func VerifyLimit(l, p int) (int, int) {

	// 每页最少1条数据
	if l < 1 {
		l = 1
	}

	// 每页最多50条数据
	if l > 50 {
		l = 50
	}

	// 当前页
	if p < 1 {
		p = 1
	}

	return l, p
}

// VerifyPage 默认分页
func VerifyPage(l, p int) (int, int) {
	// 当前页
	if p < 1 {
		p = 1
	}

	if l <= 1 {
		l = 100
	}

	return l, p
}
