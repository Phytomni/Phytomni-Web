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
