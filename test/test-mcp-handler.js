"use strict";

var assert = require("assert");
var mcpModule = require("../src/bridge/mcp-handler");

var MCPHandler = mcpModule.MCPHandler;
var TOOLS = mcpModule.TOOLS;
var jsonRpcResponse = mcpModule.jsonRpcResponse;
var jsonRpcError = mcpModule.jsonRpcError;

// ---------------------------------------------------------------------------
// Helper: create an MCPHandler with a mock PixInsight sender
// ---------------------------------------------------------------------------

function createHandler(mockResult) {
  var sender = function (command, callback) {
    if (mockResult instanceof Error) {
      callback(mockResult, null);
    } else {
      callback(null, mockResult || { success: true });
    }
  };
  return new MCPHandler(sender);
}

function createHandlerWithSender(senderFn) {
  return new MCPHandler(senderFn);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JSON-RPC helpers", function () {
  it("jsonRpcResponse creates valid response", function () {
    var resp = jsonRpcResponse(42, { foo: "bar" });
    assert.strictEqual(resp.jsonrpc, "2.0");
    assert.strictEqual(resp.id, 42);
    assert.deepStrictEqual(resp.result, { foo: "bar" });
    assert.strictEqual(resp.error, undefined);
  });

  it("jsonRpcError creates valid error response", function () {
    var resp = jsonRpcError(7, -32600, "Invalid Request");
    assert.strictEqual(resp.jsonrpc, "2.0");
    assert.strictEqual(resp.id, 7);
    assert.strictEqual(resp.error.code, -32600);
    assert.strictEqual(resp.error.message, "Invalid Request");
  });

  it("jsonRpcError includes optional data", function () {
    var resp = jsonRpcError(1, -32603, "Internal", { detail: "x" });
    assert.deepStrictEqual(resp.error.data, { detail: "x" });
  });
});

describe("MCPHandler - initialize", function () {
  it("responds with server info and capabilities", function (done) {
    var handler = createHandler();
    var msg = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "TestClient", version: "1.0" }
      }
    };

    handler.handleMessage(msg, function (err, resp) {
      assert.strictEqual(err, null);
      assert.strictEqual(resp.id, 1);
      assert.strictEqual(resp.result.protocolVersion, "2024-11-05");
      assert.ok(resp.result.serverInfo);
      assert.strictEqual(resp.result.serverInfo.name, "pixinsight-mcp-bridge");
      assert.ok(resp.result.capabilities.tools);
      assert.ok(resp.result.instructions);
      if (done) done();
    });
  });

  it("negotiates protocol version", function () {
    var handler = createHandler();
    var msg = {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "TestClient", version: "1.0" }
      }
    };

    handler.handleMessage(msg, function (err, resp) {
      assert.strictEqual(resp.result.protocolVersion, "2025-03-26");
    });
  });

  it("falls back to default version for unsupported version", function () {
    var handler = createHandler();
    var msg = {
      jsonrpc: "2.0",
      id: 3,
      method: "initialize",
      params: {
        protocolVersion: "9999-01-01",
        capabilities: {},
        clientInfo: { name: "TestClient", version: "1.0" }
      }
    };

    handler.handleMessage(msg, function (err, resp) {
      assert.strictEqual(resp.result.protocolVersion, "2024-11-05");
    });
  });
});

describe("MCPHandler - ping", function () {
  it("responds with empty result", function () {
    var handler = createHandler();
    handler.handleMessage(
      { jsonrpc: "2.0", id: 10, method: "ping" },
      function (err, resp) {
        assert.strictEqual(resp.id, 10);
        assert.deepStrictEqual(resp.result, {});
      }
    );
  });
});

describe("MCPHandler - tools/list", function () {
  it("returns all defined tools", function () {
    var handler = createHandler();
    handler.handleMessage(
      { jsonrpc: "2.0", id: 20, method: "tools/list" },
      function (err, resp) {
        assert.strictEqual(resp.id, 20);
        var tools = resp.result.tools;
        assert.ok(Array.isArray(tools));
        assert.strictEqual(tools.length, TOOLS.length);

        var toolNames = tools.map(function (t) { return t.name; });
        assert.ok(toolNames.indexOf("list_processes") !== -1);
        assert.ok(toolNames.indexOf("invoke_process") !== -1);
        assert.ok(toolNames.indexOf("list_views") !== -1);
        assert.ok(toolNames.indexOf("get_focused_view") !== -1);
        assert.ok(toolNames.indexOf("set_focused_view") !== -1);
        assert.ok(toolNames.indexOf("get_image_from_view") !== -1);
      }
    );
  });

  it("each tool has required fields", function () {
    var handler = createHandler();
    handler.handleMessage(
      { jsonrpc: "2.0", id: 21, method: "tools/list" },
      function (err, resp) {
        resp.result.tools.forEach(function (tool) {
          assert.ok(tool.name, "Tool must have name");
          assert.ok(tool.description, "Tool must have description");
          assert.ok(tool.inputSchema, "Tool must have inputSchema");
          assert.strictEqual(tool.inputSchema.type, "object");
        });
      }
    );
  });
});

describe("MCPHandler - tools/call", function () {
  it("forwards command to PixInsight and returns result", function () {
    var mockResult = { processes: [{ id: "PixelMath" }] };
    var handler = createHandler(mockResult);

    handler.handleMessage(
      {
        jsonrpc: "2.0", id: 30, method: "tools/call",
        params: { name: "list_processes", arguments: {} }
      },
      function (err, resp) {
        assert.strictEqual(resp.id, 30);
        assert.strictEqual(resp.result.isError, false);
        assert.ok(resp.result.content);
        assert.strictEqual(resp.result.content[0].type, "text");
        var parsed = JSON.parse(resp.result.content[0].text);
        assert.deepStrictEqual(parsed.processes, [{ id: "PixelMath" }]);
      }
    );
  });

  it("returns error content when PixInsight errors", function () {
    var handler = createHandler(new Error("Process not found"));

    handler.handleMessage(
      {
        jsonrpc: "2.0", id: 31, method: "tools/call",
        params: { name: "invoke_process", arguments: { processId: "FakeProcess" } }
      },
      function (err, resp) {
        assert.strictEqual(resp.id, 31);
        assert.strictEqual(resp.result.isError, true);
        assert.ok(resp.result.content[0].text.indexOf("Process not found") !== -1);
      }
    );
  });

  it("rejects unknown tool name", function () {
    var handler = createHandler();
    handler.handleMessage(
      {
        jsonrpc: "2.0", id: 32, method: "tools/call",
        params: { name: "nonexistent_tool", arguments: {} }
      },
      function (err, resp) {
        assert.ok(resp.error);
        assert.strictEqual(resp.error.code, -32602);
      }
    );
  });

  it("validates required params for invoke_process", function () {
    var handler = createHandler();
    handler.handleMessage(
      {
        jsonrpc: "2.0", id: 33, method: "tools/call",
        params: { name: "invoke_process", arguments: {} }
      },
      function (err, resp) {
        assert.ok(resp.error);
        assert.strictEqual(resp.error.code, -32602);
        assert.ok(resp.error.message.indexOf("processId") !== -1);
      }
    );
  });

  it("validates required params for set_focused_view", function () {
    var handler = createHandler();
    handler.handleMessage(
      {
        jsonrpc: "2.0", id: 34, method: "tools/call",
        params: { name: "set_focused_view", arguments: {} }
      },
      function (err, resp) {
        assert.ok(resp.error);
        assert.strictEqual(resp.error.code, -32602);
        assert.ok(resp.error.message.indexOf("viewId") !== -1);
      }
    );
  });

  it("passes correct command structure to PixInsight", function () {
    var receivedCommand = null;
    var handler = createHandlerWithSender(function (cmd, cb) {
      receivedCommand = cmd;
      cb(null, { ok: true });
    });

    handler.handleMessage(
      {
        jsonrpc: "2.0", id: 35, method: "tools/call",
        params: {
          name: "invoke_process",
          arguments: { processId: "PixelMath", parameters: { expression: "$T*2" }, viewId: "Image01" }
        }
      },
      function (err, resp) {
        assert.ok(receivedCommand);
        assert.strictEqual(receivedCommand.command, "invoke_process");
        assert.strictEqual(receivedCommand.params.processId, "PixelMath");
        assert.strictEqual(receivedCommand.params.parameters.expression, "$T*2");
        assert.strictEqual(receivedCommand.params.viewId, "Image01");
      }
    );
  });

  it("returns image content for _imageData results", function () {
    var mockImageResult = {
      _imageData: "AQID",
      _mimeType: "image/jpeg",
      _metadata: { viewId: "Image01", width: 100, height: 100 }
    };
    var handler = createHandler(mockImageResult);

    handler.handleMessage(
      {
        jsonrpc: "2.0", id: 40, method: "tools/call",
        params: { name: "get_image_from_view", arguments: {} }
      },
      function (err, resp) {
        assert.strictEqual(resp.id, 40);
        assert.strictEqual(resp.result.isError, false);
        assert.strictEqual(resp.result.content.length, 2);
        assert.strictEqual(resp.result.content[0].type, "image");
        assert.strictEqual(resp.result.content[0].data, "AQID");
        assert.strictEqual(resp.result.content[0].mimeType, "image/jpeg");
        assert.strictEqual(resp.result.content[1].type, "text");
        var meta = JSON.parse(resp.result.content[1].text);
        assert.strictEqual(meta.viewId, "Image01");
      }
    );
  });

  it("returns image content without metadata text if _metadata absent", function () {
    var handler = createHandler({ _imageData: "AQID", _mimeType: "image/png" });
    handler.handleMessage(
      {
        jsonrpc: "2.0", id: 41, method: "tools/call",
        params: { name: "get_image_from_view", arguments: {} }
      },
      function (err, resp) {
        assert.strictEqual(resp.result.content.length, 1);
        assert.strictEqual(resp.result.content[0].type, "image");
        assert.strictEqual(resp.result.content[0].mimeType, "image/png");
      }
    );
  });
});

describe("MCPHandler - notifications", function () {
  it("returns null for notifications (no response needed)", function () {
    var handler = createHandler();
    handler.handleMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      function (err, resp) {
        assert.strictEqual(resp, null);
      }
    );
  });

  it("handles unknown notifications gracefully", function () {
    var handler = createHandler();
    handler.handleMessage(
      { jsonrpc: "2.0", method: "notifications/unknown_thing" },
      function (err, resp) {
        assert.strictEqual(resp, null);
      }
    );
  });
});

describe("MCPHandler - error handling", function () {
  it("rejects non-JSON-RPC messages", function () {
    var handler = createHandler();
    handler.handleMessage(
      { foo: "bar" },
      function (err, resp) {
        assert.ok(resp.error);
        assert.strictEqual(resp.error.code, -32600);
      }
    );
  });

  it("rejects messages without method", function () {
    var handler = createHandler();
    handler.handleMessage(
      { jsonrpc: "2.0", id: 99 },
      function (err, resp) {
        assert.ok(resp.error);
        assert.strictEqual(resp.error.code, -32600);
      }
    );
  });

  it("returns method not found for unknown methods", function () {
    var handler = createHandler();
    handler.handleMessage(
      { jsonrpc: "2.0", id: 100, method: "resources/list" },
      function (err, resp) {
        assert.ok(resp.error);
        assert.strictEqual(resp.error.code, -32601);
      }
    );
  });

  it("handles null message gracefully", function () {
    var handler = createHandler();
    handler.handleMessage(null, function (err, resp) {
      assert.ok(resp.error);
    });
  });
});
