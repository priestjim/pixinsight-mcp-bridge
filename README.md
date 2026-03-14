# PixInsight MCP Bridge

An MCP (Model Context Protocol) bridge for [PixInsight](https://pixinsight.com/) that enables LLMs to interact with PixInsight's image processing capabilities through a local HTTP/SSE server.

## Overview

PixInsight MCP Bridge runs as a PixInsight script that spawns a local Node.js HTTP server implementing the MCP protocol. This allows any MCP-compatible client (Claude Desktop, VS Code Copilot, etc.) to:

- **List all available PixInsight processes** with categories and descriptions
- **Invoke any PixInsight process** with custom parameters on specific views or globally
- **List open image views** with metadata (dimensions, color space, bit depth)
- **Get the currently focused view** and its properties
- **Change focus** to any open view by ID

## Architecture

```
┌─────────────────┐     HTTP/SSE      ┌──────────────────┐   stdin/stdout   ┌───────────────────┐
│   MCP Client    │ ◄──────────────── │  Node.js Bridge  │ ◄──────────────► │  PJSR Script      │
│  (Claude, etc.) │ ──────────────► │  Server          │ ────────────────► │  (PixInsight)     │
└─────────────────┘                   └──────────────────┘                   └───────────────────┘
                                       port 3189 (default)
```

The bridge uses a hybrid architecture:

1. **PJSR Script** (`pixinsight-mcp-bridge.js`) — Runs inside PixInsight's JavaScript runtime (ECMA 262-5/ES5). Handles all PixInsight API interactions and spawns the HTTP server via `ExternalProcess`.
2. **Node.js Bridge Server** (`bridge/server.js`) — Handles MCP protocol communication over HTTP. Supports both legacy SSE transport (spec 2024-11-05) and Streamable HTTP transport (spec 2025-03-26).
3. **IPC Layer** — Line-delimited JSON over stdin/stdout pipes between the two processes.

## Requirements

- **PixInsight** 1.8.x or later
- **Node.js** >= 14.0.0 (must be in PATH or at a standard install location)

## Installation

### 1. Download the plugin

Clone or download this repository:

```bash
git clone https://github.com/GaiaLabs/pixinsight-mcp-bridge.git
```

### 2. Copy to PixInsight scripts directory

Copy the `src/` directory contents to your PixInsight scripts folder:

- **macOS**: `/Applications/PixInsight/src/scripts/MCP-Bridge/`
- **Windows**: `C:\Program Files\PixInsight\src\scripts\MCP-Bridge\`
- **Linux**: `/opt/PixInsight/src/scripts/MCP-Bridge/`

The resulting structure should be:

```
PixInsight/src/scripts/MCP-Bridge/
├── pixinsight-mcp-bridge.js
├── lib/
│   └── handlers.jsh
└── bridge/
    ├── server.js
    ├── mcp-handler.js
    └── ipc.js
```

### 3. Register the script in PixInsight

1. Open PixInsight
2. Go to **Script > Feature Scripts...**
3. Click **Add**
4. Navigate to the `MCP-Bridge/` directory you created
5. Click **OK** — the script will appear under **Script > MCP > PixInsight MCP Bridge**

### 4. Configure your MCP client

Add the server to your MCP client configuration. For example, in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pixinsight": {
      "url": "http://127.0.0.1:3189/sse"
    }
  }
}
```

For clients that support Streamable HTTP transport, use:

```json
{
  "mcpServers": {
    "pixinsight": {
      "url": "http://127.0.0.1:3189/mcp"
    }
  }
}
```

## Usage

### Starting the Bridge

1. Open PixInsight
2. Go to **Script > MCP > PixInsight MCP Bridge**
3. Set the port (default: 3189)
4. Click **Start**
5. The bridge server will start and the MCP endpoint will be available at `http://127.0.0.1:3189`

### Available MCP Tools

#### `list_processes`

List all available PixInsight processes and scripts.

| Parameter  | Type   | Required | Description                          |
| ---------- | ------ | -------- | ------------------------------------ |
| `category` | string | No       | Filter by category (e.g. "PixelMath") |

Example response:
```json
{
  "processes": [
    { "id": "PixelMath", "category": "PixelMath", "description": "Pixel math expressions and formulas" },
    { "id": "ImageIntegration", "category": "ImageIntegration", "description": "Image stacking / integration" }
  ],
  "count": 2
}
```

#### `invoke_process`

Execute a PixInsight process with specified parameters.

| Parameter    | Type   | Required | Description                                      |
| ------------ | ------ | -------- | ------------------------------------------------ |
| `processId`  | string | Yes      | Process name (e.g. "PixelMath")                  |
| `parameters` | object | No       | Process parameters as key-value pairs            |
| `viewId`     | string | No       | View to execute on; omit for global execution    |

Example — apply PixelMath to an image:
```json
{
  "processId": "PixelMath",
  "parameters": {
    "expression": "$T * 2",
    "createNewImage": false
  },
  "viewId": "Image01"
}
```

#### `list_views`

List all open image views (main views and previews).

No parameters required. Returns view metadata including dimensions, color space, bit depth, and file path.

#### `get_focused_view`

Get the currently active/focused view and its properties.

No parameters required.

#### `set_focused_view`

Change focus to a specific view by ID.

| Parameter | Type   | Required | Description                |
| --------- | ------ | -------- | -------------------------- |
| `viewId`  | string | Yes      | View ID (e.g. "Image01")  |

### Standalone Mode (Testing)

You can run the bridge server without PixInsight for testing and development:

```bash
node src/bridge/server.js --standalone --port 3189
```

This starts the server with mock responses, useful for testing MCP client integrations.

## MCP Transport Support

The bridge supports two MCP transports:

### Legacy HTTP+SSE (2024-11-05 spec)

- `GET /sse` — Opens SSE stream, receives `endpoint` event with message URI
- `POST /messages?sessionId=<id>` — Send JSON-RPC messages; responses arrive via SSE

### Streamable HTTP (2025-03-26 spec)

- `POST /mcp` — Send JSON-RPC messages; response returned as JSON body or SSE stream
- `GET /mcp` — Open SSE stream for server-initiated messages
- `DELETE /mcp` — Terminate session

### Health Check

- `GET /health` — Returns `{ "status": "ok" }`

## Development

### Project Structure

```
pixinsight-mcp-bridge/
├── src/
│   ├── pixinsight-mcp-bridge.js    # Main PJSR entry point (ES5)
│   ├── lib/
│   │   └── handlers.jsh            # PixInsight command handlers (ES5)
│   └── bridge/
│       ├── server.js               # Node.js HTTP/SSE MCP server
│       ├── mcp-handler.js          # MCP protocol logic
│       └── ipc.js                  # IPC communication layer
├── test/
│   ├── run-tests.js                # Test runner
│   ├── test-mcp-handler.js         # MCP protocol tests
│   ├── test-server.js              # HTTP server integration tests
│   └── test-handlers.js            # PJSR handler tests (mocked PI API)
├── package.json
└── README.md
```

### Key Design Decisions

- **Hybrid architecture**: PixInsight's PJSR runtime has no HTTP server capability (`NetworkTransfer` is client-only). The solution uses `ExternalProcess` to spawn a Node.js HTTP server and communicates via stdin/stdout IPC.
- **ES5 compliance**: All PJSR code (`*.js` and `*.jsh` in `src/`) is ECMA 262-5 compliant — no `let`/`const`, no arrow functions, no template literals, no classes, no promises.
- **Zero dependencies**: The Node.js bridge server uses only built-in modules (`http`, `url`, `crypto`). No npm install required.
- **Process registry**: Since PJSR doesn't expose a direct "list all processes" API, the bridge maintains a curated registry of known processes and verifies availability at runtime via constructor detection.

### Running Tests

```bash
npm test
# or
node test/run-tests.js
```

The test suite includes:

- **MCP protocol tests** — JSON-RPC message handling, initialization, tool listing/calling
- **HTTP server tests** — Both SSE and Streamable HTTP transports, CORS, error handling
- **Handler tests** — PJSR command handlers with mocked PixInsight API

### Adding New Tools

1. Define the tool schema in `src/bridge/mcp-handler.js` in the `TOOLS` array
2. Add parameter validation in `MCPHandler.prototype._validateToolParams`
3. Implement the handler in `src/lib/handlers.jsh` in `CommandDispatcher`
4. Add mock handling in `createMockHandler` in `src/bridge/server.js`
5. Write tests

### Adding New Processes to the Registry

Edit `CommandDispatcher.prototype._getProcessRegistry` in `src/lib/handlers.jsh` to add new process entries:

```javascript
{ id: "NewProcess", category: "CategoryName", description: "What it does" }
```

Processes are verified at runtime — entries for processes not installed in the user's PixInsight will be automatically excluded.

### PJSR Development Notes

- Use `#include "path/file.jsh"` for includes (preprocessor directive, not standard JS)
- Use `#feature-id Category > Name` to register scripts in PixInsight's Script menu
- All PixInsight processes are global constructors (e.g., `new PixelMath()`)
- Use `processEvents()` in loops to keep the GUI responsive
- `ExternalProcess` requires `processEvents()` polling for event handling
- `Timer` uses seconds (not milliseconds) for its interval

## Troubleshooting

### "Node.js not found"

Ensure Node.js >= 14 is installed and accessible. The script searches these locations:

- macOS/Linux: `which node`, `/usr/local/bin/node`, `/usr/bin/node`, `/opt/homebrew/bin/node`
- Windows: `where node`, `C:\Program Files\nodejs\node.exe`

### Server won't start

Check the PixInsight console (View > Process Console) for error messages. Common issues:

- Port already in use — change the port number
- File permissions — ensure the bridge server files are readable

### MCP client can't connect

- Verify the server is running (check `http://127.0.0.1:3189/health`)
- Ensure your MCP client config points to the correct endpoint
- The server only listens on `127.0.0.1` (localhost) — it's not accessible from other machines

## License

MIT
