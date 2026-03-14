"use strict";

/**
 * MCP Protocol Handler
 *
 * Implements the Model Context Protocol (MCP) JSON-RPC 2.0 message handling.
 * Supports both legacy SSE (2024-11-05) and Streamable HTTP (2025-03-26) transports.
 */

var SERVER_INFO = {
  name: "pixinsight-mcp-bridge",
  version: "1.0.0"
};

var PROTOCOL_VERSION = "2024-11-05";

var SUPPORTED_VERSIONS = ["2024-11-05", "2025-03-26"];

/**
 * MCP tool definitions exposed by this server.
 */
var TOOLS = [
  {
    name: "list_processes",
    description: "List all available PixInsight processes and scripts with their categories and descriptions.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional category filter to narrow results (e.g. 'ImageProcessing', 'ColorCalibration')"
        }
      }
    }
  },
  {
    name: "invoke_process",
    description: "Invoke a PixInsight process with specified parameters. The process can be executed on a specific view or globally.",
    inputSchema: {
      type: "object",
      properties: {
        processId: {
          type: "string",
          description: "The PixInsight process identifier (e.g. 'PixelMath', 'ImageIntegration', 'HistogramTransformation')"
        },
        parameters: {
          type: "object",
          description: "Process-specific parameters as key-value pairs. Parameter names and types depend on the process."
        },
        viewId: {
          type: "string",
          description: "Optional view ID to execute the process on. If omitted, the process executes globally."
        }
      },
      required: ["processId"]
    }
  },
  {
    name: "list_views",
    description: "List all currently open image views in PixInsight, including main views and previews, with their properties.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_focused_view",
    description: "Get the currently focused/active view in PixInsight with its ID and properties.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "set_focused_view",
    description: "Change focus to a specific view by its ID. Brings the corresponding image window to the front.",
    inputSchema: {
      type: "object",
      properties: {
        viewId: {
          type: "string",
          description: "The ID of the view to focus (e.g. 'Image01', 'integration_result')"
        }
      },
      required: ["viewId"]
    }
  }
];

/**
 * Create a JSON-RPC 2.0 response.
 */
function jsonRpcResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id: id,
    result: result
  };
}

/**
 * Create a JSON-RPC 2.0 error response.
 */
function jsonRpcError(id, code, message, data) {
  var resp = {
    jsonrpc: "2.0",
    id: id,
    error: {
      code: code,
      message: message
    }
  };
  if (data !== undefined) {
    resp.error.data = data;
  }
  return resp;
}

// Standard JSON-RPC error codes
var ERROR_PARSE = -32700;
var ERROR_INVALID_REQUEST = -32600;
var ERROR_METHOD_NOT_FOUND = -32601;
var ERROR_INVALID_PARAMS = -32602;
var ERROR_INTERNAL = -32603;

/**
 * MCPHandler - Processes MCP JSON-RPC messages.
 *
 * @param {Function} sendToPixInsight - callback(command, callback(err, result))
 *   Sends a command object to PixInsight and invokes callback with the result.
 */
function MCPHandler(sendToPixInsight) {
  this._sendToPixInsight = sendToPixInsight;
  this._initialized = false;
  this._negotiatedVersion = null;
}

/**
 * Handle an incoming JSON-RPC message.
 * Returns a Promise-like object via callback (since we need async for PI communication).
 *
 * @param {Object} message - Parsed JSON-RPC message
 * @param {Function} callback - callback(error, response) where response may be null for notifications
 */
MCPHandler.prototype.handleMessage = function (message, callback) {
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
    return callback(null, jsonRpcError(
      message && message.id != null ? message.id : null,
      ERROR_INVALID_REQUEST,
      "Invalid JSON-RPC 2.0 message"
    ));
  }

  var method = message.method;
  var params = message.params || {};
  var id = message.id;
  var isNotification = (id === undefined || id === null) && method !== undefined;

  // Handle notifications (no response required)
  if (isNotification) {
    this._handleNotification(method, params);
    return callback(null, null);
  }

  // Handle requests
  if (method === undefined) {
    return callback(null, jsonRpcError(id, ERROR_INVALID_REQUEST, "Missing method"));
  }

  switch (method) {
    case "initialize":
      return this._handleInitialize(id, params, callback);
    case "ping":
      return callback(null, jsonRpcResponse(id, {}));
    case "tools/list":
      return this._handleToolsList(id, params, callback);
    case "tools/call":
      return this._handleToolsCall(id, params, callback);
    default:
      return callback(null, jsonRpcError(id, ERROR_METHOD_NOT_FOUND, "Method not found: " + method));
  }
};

MCPHandler.prototype._handleNotification = function (method, params) {
  switch (method) {
    case "notifications/initialized":
      // Client acknowledges initialization is complete
      break;
    case "notifications/cancelled":
      // Client cancelled a request - we could implement cancellation
      break;
    default:
      // Unknown notification - ignore per spec
      break;
  }
};

MCPHandler.prototype._handleInitialize = function (id, params, callback) {
  var clientVersion = params.protocolVersion || PROTOCOL_VERSION;

  // Negotiate protocol version
  var negotiated = PROTOCOL_VERSION;
  for (var i = 0; i < SUPPORTED_VERSIONS.length; i++) {
    if (SUPPORTED_VERSIONS[i] === clientVersion) {
      negotiated = clientVersion;
      break;
    }
  }

  this._initialized = true;
  this._negotiatedVersion = negotiated;

  callback(null, jsonRpcResponse(id, {
    protocolVersion: negotiated,
    capabilities: {
      tools: { listChanged: false }
    },
    serverInfo: SERVER_INFO,
    instructions: "PixInsight MCP Bridge - Control PixInsight image processing via MCP. " +
      "Use list_processes to discover available processes, invoke_process to execute them, " +
      "and view management tools to navigate open images."
  }));
};

MCPHandler.prototype._handleToolsList = function (id, params, callback) {
  callback(null, jsonRpcResponse(id, {
    tools: TOOLS
  }));
};

MCPHandler.prototype._handleToolsCall = function (id, params, callback) {
  var toolName = params.name;
  var toolArgs = params.arguments || {};

  // Validate tool name
  var found = false;
  for (var i = 0; i < TOOLS.length; i++) {
    if (TOOLS[i].name === toolName) {
      found = true;
      break;
    }
  }
  if (!found) {
    return callback(null, jsonRpcError(id, ERROR_INVALID_PARAMS, "Unknown tool: " + toolName));
  }

  // Validate required parameters
  var validationError = this._validateToolParams(toolName, toolArgs);
  if (validationError) {
    return callback(null, jsonRpcError(id, ERROR_INVALID_PARAMS, validationError));
  }

  // Build command for PixInsight
  var command = {
    command: toolName,
    params: toolArgs
  };

  this._sendToPixInsight(command, function (err, result) {
    if (err) {
      callback(null, jsonRpcResponse(id, {
        content: [{ type: "text", text: "Error: " + (err.message || String(err)) }],
        isError: true
      }));
    } else {
      var text;
      if (typeof result === "string") {
        text = result;
      } else {
        text = JSON.stringify(result, null, 2);
      }
      callback(null, jsonRpcResponse(id, {
        content: [{ type: "text", text: text }],
        isError: false
      }));
    }
  });
};

MCPHandler.prototype._validateToolParams = function (toolName, args) {
  switch (toolName) {
    case "invoke_process":
      if (!args.processId || typeof args.processId !== "string") {
        return "invoke_process requires a 'processId' string parameter";
      }
      break;
    case "set_focused_view":
      if (!args.viewId || typeof args.viewId !== "string") {
        return "set_focused_view requires a 'viewId' string parameter";
      }
      break;
  }
  return null;
};

// Export for Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MCPHandler: MCPHandler,
    TOOLS: TOOLS,
    SERVER_INFO: SERVER_INFO,
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    SUPPORTED_VERSIONS: SUPPORTED_VERSIONS,
    jsonRpcResponse: jsonRpcResponse,
    jsonRpcError: jsonRpcError,
    ERROR_PARSE: ERROR_PARSE,
    ERROR_INVALID_REQUEST: ERROR_INVALID_REQUEST,
    ERROR_METHOD_NOT_FOUND: ERROR_METHOD_NOT_FOUND,
    ERROR_INVALID_PARAMS: ERROR_INVALID_PARAMS,
    ERROR_INTERNAL: ERROR_INTERNAL
  };
}
