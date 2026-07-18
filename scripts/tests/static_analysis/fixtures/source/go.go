package fixture

//nolint:errcheck // fixture directive
func run() {
	println("fixture")
}

//go:build linux
//go:generate go run ./tools
