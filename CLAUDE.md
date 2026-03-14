# CLAUDE.md — PixInsight MCP Bridge

## Project Overview

A Model Context Protocol (MCP) bridge that enables LLMs to interact with PixInsight's image processing engine. Exposes PixInsight processes and views as MCP tools via a local HTTP/SSE server.

**Current version:** 1.0.0
**Status:** MVP complete — 5 MCP tools, dual transport support, 69 passing tests.

## Architecture

Hybrid two-process design forced by PixInsight's runtime limitations:

```
MCP Client ←→ Node.js HTTP Server (bridge/) ←→ PJSR Script (PixInsight)
                  via HTTP/SSE                    via stdin/stdout IPC
```

**Why hybrid:** PixInsight's JavaScript runtime (PJSR) has NO HTTP server capability. `NetworkTransfer` is client-only (download/upload/POST). The only way to accept inbound connections is to spawn an external process via `ExternalProcess` and pipe data through stdin/stdout.

### Communication Flow

1. MCP client sends JSON-RPC over HTTP to Node.js bridge server
2. Bridge server writes command as line-delimited JSON to stdout → PJSR reads via `ExternalProcess.standardOutput`
3. PJSR dispatches command to handler, executes PixInsight API call
4. PJSR writes result via `ExternalProcess.write()` → Bridge server reads from stdin
5. Bridge server sends JSON-RPC response via HTTP (or SSE for legacy transport)

### IPC Protocol (between Node.js ↔ PJSR)

Line-delimited JSON. Each message is one JSON object followed by `\n`.

**Command (Node.js → PJSR):**
```json
{"id":"<uuid>","command":"<tool_name>","params":{...}}
```

**Response (PJSR → Node.js):**
```json
{"id":"<uuid>","result":{...}}
{"id":"<uuid>","error":{"message":"..."}}
```

## File Map

| File | Runtime | Purpose |
|------|---------|---------|
| `src/pixinsight-mcp-bridge.js` | PJSR (ES5) | Entry point. GUI dialog, Node.js discovery, ExternalProcess lifecycle, Timer-based IPC polling |
| `src/lib/handlers.jsh` | PJSR (ES5) | CommandDispatcher with 5 handlers: list_processes, invoke_process, list_views, get_focused_view, set_focused_view |
| `src/bridge/server.js` | Node.js | HTTP server. Routes for legacy SSE (`/sse`, `/messages`) and Streamable HTTP (`/mcp`). Standalone mock mode with `--standalone`. Health check at `/health` |
| `src/bridge/mcp-handler.js` | Node.js | JSON-RPC 2.0 MCP protocol handler. Tool definitions, validation, initialize/ping/tools-list/tools-call |
| `src/bridge/ipc.js` | Node.js | IPC bridge — sends commands via stdout, receives responses via stdin, timeout handling, pending request tracking |
| `test/run-tests.js` | Node.js | Custom test runner (describe/it). Supports sync and async (done callback) tests. No dependencies |
| `test/test-mcp-handler.js` | Node.js | 20 tests — JSON-RPC helpers, initialize, ping, tools/list, tools/call, notifications, error handling |
| `test/test-server.js` | Node.js | 25 tests — parseArgs, SessionManager, createMockHandler, HTTP endpoints (both transports), SSE lifecycle |
| `test/test-handlers.js` | Node.js | 19 tests — handlers.jsh loaded in Node.js VM sandbox with mocked PixInsight API |

## Key Technical Constraints

### PJSR / ES5 Rules (src/*.js, src/lib/*.jsh)

- **ECMA 262-5 only.** No `let`/`const`, no arrow functions, no template literals, no destructuring, no `class`, no `Promise`/`async`/`await`, no `for...of`, no `Map`/`Set`, no modules (`import`/`export`).
- Use `var` everywhere, `function` declarations, string concatenation with `+`, prototypal inheritance with `this.__base__`.
- `#include "path.jsh"` — preprocessor directive, not standard JS. Resolved before execution.
- `#feature-id Category > Name` — registers script in PixInsight's Script menu.
- `#feature-info ...` — description for the Script menu. Use `\` for line continuation.
- `#__FILE__` — preprocessor macro for current file path.
- `processEvents()` must be called in loops to keep the GUI responsive. PJSR is single-threaded.
- `Timer` interval is in **seconds** (not milliseconds). Currently set to 0.05s (50ms) for IPC polling.
- `ExternalProcess.write()` sends to the spawned process's stdin. `.standardOutput` reads from its stdout.
- `Console.writeln()`, `.warningln()`, `.criticalln()`, `.noteln()` — output to PixInsight's Process Console.
- GUI uses `Dialog`, `Label`, `PushButton`, `SpinBox`, `HorizontalSizer`, `VerticalSizer`, etc.

### Node.js Bridge Server (src/bridge/*.js)

- Zero npm dependencies — uses only built-in modules: `http`, `url`, `crypto`.
- `process.stdout.write()` sends commands TO PixInsight (PJSR reads this as ExternalProcess stdout).
- `process.stdin` receives responses FROM PixInsight (PJSR writes via ExternalProcess.write).
- `process.stderr` is used for log messages (PJSR reads these via onStandardErrorDataAvailable and shows in PixInsight console).
- Server binds to `127.0.0.1` only (localhost). Default port 3189.

### MCP Protocol

- JSON-RPC 2.0 for all messages.
- Supported protocol versions: `2024-11-05`, `2025-03-26`.
- **Legacy SSE transport** (2024-11-05): `GET /sse` opens SSE stream → server sends `event: endpoint` with message URI → client POSTs to `/messages?sessionId=<id>` → server responds via SSE `event: message`.
- **Streamable HTTP transport** (2025-03-26): `POST /mcp` sends JSON-RPC, gets JSON or SSE response. `GET /mcp` for server-initiated messages. `DELETE /mcp` to terminate session.
- Notifications (no `id` field) return no response. Client sends `notifications/initialized` after init.
- Tool execution errors use `isError: true` in the result (not JSON-RPC error). Protocol errors (unknown tool, invalid params) use JSON-RPC error codes (-32602, -32601, etc.).

## MCP Tools Exposed

| Tool | Required Params | Description |
|------|----------------|-------------|
| `list_processes` | — (optional `category` filter) | Enumerates available PI processes from curated registry, verified at runtime via `eval(processId)` |
| `invoke_process` | `processId` (+ optional `parameters`, `viewId`) | Creates process instance, sets params, calls `executeOn(view)` or `executeGlobal()` |
| `list_views` | — | Iterates `ImageWindow.windows`, collects main views and previews with image metadata |
| `get_focused_view` | — | Returns `ImageWindow.activeWindow.currentView` properties |
| `set_focused_view` | `viewId` | Finds via `View.viewById()` or `ImageWindow.windowById()`, calls `bringToFront()` |

## PixInsight API Reference (Used in this project)

### ImageWindow (static)
- `ImageWindow.windows` — array of all image windows
- `ImageWindow.activeWindow` — currently focused window
- `ImageWindow.windowById(id)` — find window by ID

### ImageWindow (instance)
- `.mainView` — main View of the window
- `.previews` — array of preview Views
- `.currentView` — currently selected view (main or preview)
- `.filePath`, `.isModified`, `.isNull`
- `.bringToFront()` — bring to focus

### View
- `View.viewById(id)` — static lookup
- `.id`, `.fullId`, `.isMainView`, `.isPreview`, `.isNull`
- `.image` — Image object with `.width`, `.height`, `.numberOfChannels`, `.isColor`, `.bitsPerSample`
- `.window` — parent ImageWindow
- `.beginProcess()` / `.endProcess()` — bracket process execution

### Process Invocation
- All processes (PixelMath, HistogramTransformation, etc.) are global constructors
- `new PixelMath()` creates a ProcessInstance
- Set params as properties: `P.expression = "$T * 2"`
- `P.canExecuteOn(view)`, `P.canExecuteGlobal()` — check executability
- `P.executeOn(view)`, `P.executeGlobal()` — execute
- Must wrap in `view.beginProcess()` / `view.endProcess()` for undo support

### Process Registry
- PJSR has no "list all process types" API
- `_getProcessRegistry()` in handlers.jsh maintains a curated list of ~60 known processes
- Each entry is `{ id, category, description }`
- Verified at runtime: `typeof eval(entry.id) === "function"` — skips unavailable processes
- To add a process: add an entry to the registry array in `handlers.jsh`

### Other PJSR APIs Available (not currently used, but available for future tools)
- `Image` — pixel-level access: `.sample(x,y,ch)`, `.setSample()`, statistics (`.mean()`, `.median()`, `.stdDev()`, `.MAD()`)
- `File` — full file I/O: `.readTextFile()`, `.writeTextFile()`, `.exists()`, `.createDirectory()`
- `NetworkTransfer` — HTTP/FTP client (outbound only)
- `ExternalProcess` — spawn OS commands
- `Settings` — persistent key-value storage
- `StarDetector`, `DynamicPSF` — star analysis
- `EphemerisFile`, `Position` — astronomical calculations
- `WebView` — embedded browser widget

## Testing

```bash
npm test    # or: node test/run-tests.js
```

- 69 tests, all passing.
- Custom test runner — `describe`/`it` with sync and async (`done` callback) support.
- No test framework dependencies.
- **Handler tests** use Node.js `vm` module to load `handlers.jsh` (PJSR ES5 code) in a sandboxed context with mocked PixInsight globals.
- The sandbox requires a custom `eval` that calls `vm.runInContext()` so that `eval(processId)` in handlers.jsh can resolve mock process constructors from the sandbox scope.
- **Server tests** spin up real HTTP servers on port 0 (OS-assigned) and make actual HTTP requests. Tests are sequential within describe blocks — server state carries across `it` calls.
- `createMockHandler` in server.js provides mock responses for all 5 tools in standalone mode.

## Build & Run

No build step. No npm install needed (zero dependencies).

```bash
# Standalone testing (no PixInsight)
node src/bridge/server.js --standalone --port 3189

# Run tests
npm test

# In PixInsight: Script > MCP > PixInsight MCP Bridge > Start
```

## Known Limitations / Future Work

- **Process registry is curated, not exhaustive.** No PJSR API exists to dynamically enumerate all installed process types. The registry covers ~60 common processes. Third-party processes (BlurXTerminator, StarNet2, etc.) must be added manually.
- **No authentication.** Server binds to localhost only, but has no auth mechanism. Fine for local use.
- **Single-session IPC.** The PJSR↔Node.js pipe is a single channel — concurrent tool calls are serialized. The 30-second IPC timeout may need tuning for long-running processes.
- **No image data transfer.** Tools return metadata about views but don't transfer pixel data. Could be added via base64-encoded thumbnails or file path references.
- **No process parameter introspection.** `invoke_process` accepts arbitrary key-value params but doesn't validate them against the process's actual parameter schema. Invalid params will produce PixInsight runtime errors.
- **PJSR script blocks the UI.** The Timer-based polling approach works but the dialog must stay open. A future version could use a non-modal approach.
- **`#__FILE__` macro** is used in `_getServerScriptPath()` to locate bridge/server.js relative to the PJSR script. If this macro is unavailable in older PixInsight versions, fall back to `File.fullPath(".")`.
