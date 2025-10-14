# Phytomni-Web

```
# Phytomni-Web Project

A comprehensive web application project featuring a Go client and a Python client with MCP server integration for agricultural knowledge management.
```

```
## Prerequisites

### For nky_client_go:
- Go 1.18+ installed
- Port 8082 available

### For nky_client_python:
- Python 3.8+ installed
- UV package manager installed (`pip install uv`)
- Port 8081 available

## Installation & Setup

### 1. Go Client Setup (nky_client_go)

```bash
# Navigate to Go client directory
cd nky_client_go

# Install dependencies
go mod tidy

# Run the application Default port: 8082
go run main.go


```

```
# Navigate to Python client directory
cd nky_client_python

# Place the mcp_server_phytomni directory in the root
# Ensure the directory structure is:
# nky_client_python/
# ├── nky_client.py
# └── mcp_server_phytomni/
#     └── server.py (or relevant server files)

# Run the Python client with MCP server Default port: 8081
uv run nky_client.py mcp_server_phytomni.server
```

## Port Configuration

| Service                | Port | Description                                      |
| :--------------------- | :--- | :----------------------------------------------- |
| Go Client              | 8082 | Main application server                          |
| Python Client with MCP | 8081 | Python client with Model Context Protocol server |

## Important Notes

1. **MCP Server Placement**: The `mcp_server_phytomni` directory must be placed directly in the `nky_client_python` root directory for proper module resolution.
2. **Port Conflicts**: Ensure ports 8081 and 8082 are not occupied by other services before starting the applications.
3. **Dependencies**: Both clients require their respective dependency managers:
   - Go: `go mod` for dependency management
   - Python: `uv` for package management and execution
4. **Execution Order**: Both clients can be run independently. There are no strict dependencies between them.

## Troubleshooting

### Common Issues:

1. **Port already in use**:

   ```
   # Find process using port 8081 or 8082
   lsof -i :8081
   lsof -i :8082
   
   # Or on Windows:
   netstat -ano | findstr :8081
   netstat -ano | findstr :8082
   ```

2. **Go dependencies issues**:

   ```
   # Clean module cache and reinstall
   go clean -modcache
   go mod tidy
   ```

3. **Python module not found**:

   - Ensure `mcp_server_phytomni` is placed in the correct directory
   - Verify the directory structure matches the expected layout

## Development

For development contributions, please ensure:

- Go code follows standard Go formatting (`gofmt`)
- Python code follows PEP8 guidelines
- Both services are tested on their respective ports
- Dependencies are properly documented in go.mod and pyproject.toml/requirements.txt