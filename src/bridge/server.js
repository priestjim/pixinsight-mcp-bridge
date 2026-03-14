"use strict";

/**
 * PixInsight MCP Bridge Server
 *
 * HTTP server implementing the MCP (Model Context Protocol) over:
 * - Legacy HTTP+SSE transport (2024-11-05 spec)
 * - Streamable HTTP transport (2025-03-26 spec)
 *
 * Communicates with the PixInsight PJSR script via stdin/stdout IPC.
 *
 * Usage:
 *   Spawned by PJSR:  node server.js [--port <port>]
 *   Standalone:        node server.js --standalone [--port <port>]
 */

var http = require("http");
var url = require("url");
var crypto = require("crypto");
var MCPHandlerModule = require("./mcp-handler");
var IPCModule = require("./ipc");

var MCPHandler = MCPHandlerModule.MCPHandler;
var IPCBridge = IPCModule.IPCBridge;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  var args = {
    port: 3189,
    standalone: false
  };
  for (var i = 2; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) {
      args.port = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === "--standalone") {
      args.standalone = true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

function SessionManager() {
  this._sessions = {};
}

SessionManager.prototype.create = function () {
  var id = crypto.randomBytes(16).toString("hex");
  this._sessions[id] = {
    id: id,
    sseResponse: null,
    created: Date.now()
  };
  return this._sessions[id];
};

SessionManager.prototype.get = function (id) {
  return this._sessions[id] || null;
};

SessionManager.prototype.remove = function (id) {
  if (this._sessions[id]) {
    if (this._sessions[id].sseResponse) {
      try { this._sessions[id].sseResponse.end(); } catch (e) { /* ignore */ }
    }
    delete this._sessions[id];
  }
};

// ---------------------------------------------------------------------------
// Mock handler for standalone mode (no PixInsight connection)
// ---------------------------------------------------------------------------

function createMockHandler(command, callback) {
  switch (command.command) {
    case "list_processes":
      callback(null, {
        processes: [
          { id: "PixelMath", category: "PixelMath", description: "Pixel math expressions" },
          { id: "HistogramTransformation", category: "IntensityTransformations", description: "Histogram transformation" },
          { id: "ImageIntegration", category: "ImageIntegration", description: "Image stacking" },
          { id: "StarAlignment", category: "StarAlignment", description: "Star registration/alignment" },
          { id: "Deconvolution", category: "Deconvolution", description: "Image deconvolution" }
        ],
        note: "Running in standalone mode - showing sample processes"
      });
      break;
    case "list_views":
      callback(null, {
        views: [
          { id: "Image01", fullId: "Image01", isMainView: true, width: 4096, height: 4096 },
          { id: "Image02", fullId: "Image02", isMainView: true, width: 2048, height: 2048 }
        ],
        note: "Running in standalone mode - showing sample views"
      });
      break;
    case "get_focused_view":
      callback(null, {
        id: "Image01",
        fullId: "Image01",
        isMainView: true,
        width: 4096,
        height: 4096,
        note: "Running in standalone mode - showing sample focused view"
      });
      break;
    case "set_focused_view":
      callback(null, {
        success: true,
        viewId: command.params.viewId,
        note: "Running in standalone mode - focus change simulated"
      });
      break;
    case "invoke_process":
      callback(null, {
        success: true,
        processId: command.params.processId,
        executedOn: command.params.viewId || "global",
        note: "Running in standalone mode - process execution simulated"
      });
      break;
    default:
      callback(new Error("Unknown command: " + command.command));
  }
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

function BridgeServer(options) {
  options = options || {};
  this._port = options.port || 3189;
  this._standalone = options.standalone || false;
  this._sessions = new SessionManager();

  var ipcOptions = {};
  if (this._standalone) {
    ipcOptions.mockHandler = createMockHandler;
  }
  this._ipc = new IPCBridge(ipcOptions);

  var self = this;
  this._mcpHandler = new MCPHandler(function (command, callback) {
    self._ipc.send(command, callback);
  });

  this._server = null;
}

BridgeServer.prototype.start = function (callback) {
  var self = this;
  this._server = http.createServer(function (req, res) {
    self._handleRequest(req, res);
  });

  this._server.listen(this._port, "127.0.0.1", function () {
    var addr = self._server.address();
    process.stderr.write("[MCP Bridge] Server listening on http://127.0.0.1:" + addr.port + "\n");
    process.stderr.write("[MCP Bridge] Legacy SSE endpoint: GET /sse\n");
    process.stderr.write("[MCP Bridge] Streamable HTTP endpoint: POST /mcp\n");
    if (callback) callback(null, addr);
  });

  this._server.on("error", function (err) {
    process.stderr.write("[MCP Bridge] Server error: " + err.message + "\n");
    if (callback) callback(err);
  });
};

BridgeServer.prototype.stop = function (callback) {
  if (this._server) {
    this._ipc.destroy();
    this._server.close(callback);
  } else if (callback) {
    callback();
  }
};

BridgeServer.prototype._handleRequest = function (req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname;

  // CORS headers for local development
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route to appropriate handler
  switch (pathname) {
    // Legacy SSE transport (2024-11-05)
    case "/sse":
      if (req.method === "GET") {
        return this._handleSSEConnect(req, res);
      }
      break;
    case "/messages":
      if (req.method === "POST") {
        return this._handleSSEMessage(req, res, parsed.query);
      }
      break;

    // Streamable HTTP transport (2025-03-26)
    case "/mcp":
      if (req.method === "POST") {
        return this._handleStreamablePost(req, res);
      } else if (req.method === "GET") {
        return this._handleStreamableGet(req, res);
      } else if (req.method === "DELETE") {
        return this._handleStreamableDelete(req, res);
      }
      break;

    // Health check
    case "/health":
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", standalone: this._standalone }));
      return;

    default:
      break;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
};

// ---------------------------------------------------------------------------
// Legacy SSE Transport
// ---------------------------------------------------------------------------

/**
 * GET /sse - Client opens SSE stream.
 */
BridgeServer.prototype._handleSSEConnect = function (req, res) {
  var session = this._sessions.create();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  session.sseResponse = res;

  // Send the endpoint event
  var endpoint = "/messages?sessionId=" + session.id;
  res.write("event: endpoint\ndata: " + endpoint + "\n\n");

  req.on("close", function () {
    // Client disconnected - clean up session
    session.sseResponse = null;
  });
};

/**
 * POST /messages?sessionId=<id> - Client sends JSON-RPC message.
 */
BridgeServer.prototype._handleSSEMessage = function (req, res, query) {
  var sessionId = query.sessionId;
  var session = this._sessions.get(sessionId);

  if (!session) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    return;
  }

  var self = this;
  this._readBody(req, function (err, body) {
    if (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to read request body" }));
      return;
    }

    var message;
    try {
      message = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" }
      }));
      return;
    }

    self._mcpHandler.handleMessage(message, function (handlerErr, response) {
      // Acknowledge the POST
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "accepted" }));

      // Send response via SSE if there is one
      if (response && session.sseResponse) {
        var data = JSON.stringify(response);
        session.sseResponse.write("event: message\ndata: " + data + "\n\n");
      }
    });
  });
};

// ---------------------------------------------------------------------------
// Streamable HTTP Transport
// ---------------------------------------------------------------------------

/**
 * POST /mcp - Client sends JSON-RPC message, server responds inline.
 */
BridgeServer.prototype._handleStreamablePost = function (req, res) {
  var self = this;

  this._readBody(req, function (err, body) {
    if (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to read request body" }));
      return;
    }

    var message;
    try {
      message = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" }
      }));
      return;
    }

    // Check if this is a notification (no id)
    var isNotification = (message.id === undefined || message.id === null) && message.method;

    self._mcpHandler.handleMessage(message, function (handlerErr, response) {
      if (isNotification || !response) {
        res.writeHead(202);
        res.end();
        return;
      }

      // Check Accept header for preferred response format
      var accept = req.headers["accept"] || "";
      var prefersSSE = accept.indexOf("text/event-stream") !== -1;

      if (prefersSSE) {
        // Return as SSE stream
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache"
        });
        var data = JSON.stringify(response);
        res.write("event: message\ndata: " + data + "\n\n");
        res.end();
      } else {
        // Return as direct JSON
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      }
    });
  });
};

/**
 * GET /mcp - Open SSE stream for server-initiated messages.
 */
BridgeServer.prototype._handleStreamableGet = function (req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  // Keep alive - we don't currently send server-initiated messages
  var keepAlive = setInterval(function () {
    res.write(": keepalive\n\n");
  }, 30000);

  req.on("close", function () {
    clearInterval(keepAlive);
  });
};

/**
 * DELETE /mcp - Terminate session.
 */
BridgeServer.prototype._handleStreamableDelete = function (req, res) {
  var sessionId = req.headers["mcp-session-id"];
  if (sessionId) {
    this._sessions.remove(sessionId);
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "session terminated" }));
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

BridgeServer.prototype._readBody = function (req, callback) {
  var chunks = [];
  req.on("data", function (chunk) {
    chunks.push(chunk);
  });
  req.on("end", function () {
    callback(null, Buffer.concat(chunks).toString("utf8"));
  });
  req.on("error", function (err) {
    callback(err, null);
  });
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  var args = parseArgs(process.argv);
  var server = new BridgeServer({
    port: args.port,
    standalone: args.standalone
  });

  server.start(function (err) {
    if (err) {
      process.stderr.write("[MCP Bridge] Failed to start: " + err.message + "\n");
      process.exit(1);
    }
  });

  // Graceful shutdown
  process.on("SIGINT", function () {
    process.stderr.write("\n[MCP Bridge] Shutting down...\n");
    server.stop(function () {
      process.exit(0);
    });
  });
  process.on("SIGTERM", function () {
    server.stop(function () {
      process.exit(0);
    });
  });
}

// Export for testing
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BridgeServer: BridgeServer,
    SessionManager: SessionManager,
    createMockHandler: createMockHandler,
    parseArgs: parseArgs
  };
}
