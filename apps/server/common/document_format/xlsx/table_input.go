package xlsx

// TableInput is the excel export payload. data_agent.TableData maps to this
// struct to avoid an import cycle (data_agent imports xlsx).
type TableInput struct {
	Headers []string
	Rows    [][]string
}
