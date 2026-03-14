"use strict";

var assert = require("assert");
var http = require("http");
var serverModule = require("../src/bridge/server");

var BridgeServer = serverModule.BridgeServer;
var SessionManager = serverModule.SessionManager;
var createMockHandler = serverModule.createMockHandler;
var parseArgs = serverModule.parseArgs;

// ---------------------------------------------------------------------------
// Helper: make HTTP request
// ---------------------------------------------------------------------------

function httpRequest(options, body, callback) {
  var req = http.request(options, function (res) {
    var chunks = [];
    res.on("data", function (chunk) { chunks.push(chunk); });
    res.on("end", function () {
      var data = Buffer.concat(chunks).toString("utf8");
      callback(null, res, data);
    });
  });
  req.on("error", function (err) { callback(err); });
  if (body) req.write(body);
  req.end();
}

function jsonRequest(port, path, body, callback) {
  httpRequest({
    hostname: "127.0.0.1",
    port: port,
    path: path,
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, JSON.stringify(body), callback);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseArgs", function () {
  it("parses default arguments", function () {
    var args = parseArgs(["node", "server.js"]);
    assert.strictEqual(args.port, 3189);
    assert.strictEqual(args.standalone, false);
  });

  it("parses --port flag", function () {
    var args = parseArgs(["node", "server.js", "--port", "8080"]);
    assert.strictEqual(args.port, 8080);
  });

  it("parses --standalone flag", function () {
    var args = parseArgs(["node", "server.js", "--standalone"]);
    assert.strictEqual(args.standalone, true);
  });

  it("parses combined flags", function () {
    var args = parseArgs(["node", "server.js", "--standalone", "--port", "4000"]);
    assert.strictEqual(args.port, 4000);
    assert.strictEqual(args.standalone, true);
  });
});

describe("SessionManager", function () {
  it("creates sessions with unique IDs", function () {
    var sm = new SessionManager();
    var s1 = sm.create();
    var s2 = sm.create();
    assert.ok(s1.id);
    assert.ok(s2.id);
    assert.notStrictEqual(s1.id, s2.id);
  });

  it("retrieves sessions by ID", function () {
    var sm = new SessionManager();
    var s = sm.create();
    var retrieved = sm.get(s.id);
    assert.strictEqual(retrieved.id, s.id);
  });

  it("returns null for unknown session", function () {
    var sm = new SessionManager();
    assert.strictEqual(sm.get("nonexistent"), null);
  });

  it("removes sessions", function () {
    var sm = new SessionManager();
    var s = sm.create();
    sm.remove(s.id);
    assert.strictEqual(sm.get(s.id), null);
  });
});

describe("createMockHandler", function () {
  it("handles list_processes", function (done) {
    createMockHandler({ command: "list_processes", params: {} }, function (err, result) {
      assert.strictEqual(err, null);
      assert.ok(result.processes);
      assert.ok(Array.isArray(result.processes));
      assert.ok(result.processes.length > 0);
      assert.ok(result.processes[0].id);
      done();
    });
  });

  it("handles list_views", function (done) {
    createMockHandler({ command: "list_views", params: {} }, function (err, result) {
      assert.strictEqual(err, null);
      assert.ok(result.views);
      assert.ok(Array.isArray(result.views));
      done();
    });
  });

  it("handles get_focused_view", function (done) {
    createMockHandler({ command: "get_focused_view", params: {} }, function (err, result) {
      assert.strictEqual(err, null);
      assert.ok(result.id);
      done();
    });
  });

  it("handles set_focused_view", function (done) {
    createMockHandler({ command: "set_focused_view", params: { viewId: "Test01" } }, function (err, result) {
      assert.strictEqual(err, null);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.viewId, "Test01");
      done();
    });
  });

  it("handles invoke_process", function (done) {
    createMockHandler({ command: "invoke_process", params: { processId: "PixelMath" } }, function (err, result) {
      assert.strictEqual(err, null);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.processId, "PixelMath");
      done();
    });
  });

  it("returns error for unknown command", function (done) {
    createMockHandler({ command: "unknown_cmd", params: {} }, function (err, result) {
      assert.ok(err);
      assert.ok(err.message.indexOf("Unknown command") !== -1);
      done();
    });
  });
});

describe("BridgeServer - HTTP endpoints (standalone)", function () {
  var server;
  var port = 0; // Let OS assign port
  var actualPort;

  // Use a sequential approach since we need the server running
  it("starts and responds to health check", function (done) {
    server = new BridgeServer({ port: 0, standalone: true });
    server.start(function (err, addr) {
      assert.strictEqual(err, undefined);
      actualPort = addr.port;

      httpRequest({
        hostname: "127.0.0.1",
        port: actualPort,
        path: "/health",
        method: "GET"
      }, null, function (err, res, data) {
        assert.strictEqual(err, null);
        assert.strictEqual(res.statusCode, 200);
        var body = JSON.parse(data);
        assert.strictEqual(body.status, "ok");
        assert.strictEqual(body.standalone, true);
        done();
      });
    });
  });

  it("returns 404 for unknown paths", function (done) {
    httpRequest({
      hostname: "127.0.0.1",
      port: actualPort,
      path: "/nonexistent",
      method: "GET"
    }, null, function (err, res, data) {
      assert.strictEqual(res.statusCode, 404);
      done();
    });
  });

  it("handles CORS preflight", function (done) {
    httpRequest({
      hostname: "127.0.0.1",
      port: actualPort,
      path: "/mcp",
      method: "OPTIONS"
    }, null, function (err, res) {
      assert.strictEqual(res.statusCode, 204);
      assert.ok(res.headers["access-control-allow-origin"]);
      done();
    });
  });

  it("handles Streamable HTTP POST /mcp - initialize", function (done) {
    jsonRequest(actualPort, "/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "Test", version: "1.0" }
      }
    }, function (err, res, data) {
      assert.strictEqual(err, null);
      assert.strictEqual(res.statusCode, 200);
      var body = JSON.parse(data);
      assert.strictEqual(body.jsonrpc, "2.0");
      assert.strictEqual(body.id, 1);
      assert.ok(body.result);
      assert.strictEqual(body.result.serverInfo.name, "pixinsight-mcp-bridge");
      done();
    });
  });

  it("handles Streamable HTTP POST /mcp - tools/list", function (done) {
    jsonRequest(actualPort, "/mcp", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    }, function (err, res, data) {
      assert.strictEqual(err, null);
      var body = JSON.parse(data);
      assert.ok(body.result.tools);
      assert.strictEqual(body.result.tools.length, 5);
      done();
    });
  });

  it("handles Streamable HTTP POST /mcp - tools/call list_processes", function (done) {
    jsonRequest(actualPort, "/mcp", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_processes", arguments: {} }
    }, function (err, res, data) {
      assert.strictEqual(err, null);
      var body = JSON.parse(data);
      assert.strictEqual(body.result.isError, false);
      var content = JSON.parse(body.result.content[0].text);
      assert.ok(content.processes);
      done();
    });
  });

  it("handles Streamable HTTP POST /mcp - notification returns 202", function (done) {
    jsonRequest(actualPort, "/mcp", {
      jsonrpc: "2.0",
      method: "notifications/initialized"
    }, function (err, res) {
      assert.strictEqual(res.statusCode, 202);
      done();
    });
  });

  it("handles parse errors gracefully", function (done) {
    httpRequest({
      hostname: "127.0.0.1",
      port: actualPort,
      path: "/mcp",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, "not-json{{{", function (err, res, data) {
      assert.strictEqual(res.statusCode, 400);
      var body = JSON.parse(data);
      assert.strictEqual(body.error.code, -32700);
      done();
    });
  });

  it("handles DELETE /mcp", function (done) {
    httpRequest({
      hostname: "127.0.0.1",
      port: actualPort,
      path: "/mcp",
      method: "DELETE",
      headers: { "Mcp-Session-Id": "fake-session" }
    }, null, function (err, res) {
      assert.strictEqual(res.statusCode, 200);
      done();
    });
  });

  it("stops cleanly", function (done) {
    server.stop(function () {
      done();
    });
  });
});

describe("BridgeServer - Legacy SSE transport", function () {
  var server;
  var actualPort;

  it("starts server for SSE tests", function (done) {
    server = new BridgeServer({ port: 0, standalone: true });
    server.start(function (err, addr) {
      actualPort = addr.port;
      done();
    });
  });

  it("GET /sse returns SSE stream with endpoint event", function (done) {
    var req = http.request({
      hostname: "127.0.0.1",
      port: actualPort,
      path: "/sse",
      method: "GET"
    }, function (res) {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers["content-type"], "text/event-stream");

      var data = "";
      res.on("data", function (chunk) {
        data += chunk.toString();
        // Check if we got the endpoint event
        if (data.indexOf("event: endpoint") !== -1) {
          assert.ok(data.indexOf("data: /messages?sessionId=") !== -1);
          req.destroy();
          done();
        }
      });
    });
    req.end();
  });

  it("POST /messages with valid session gets accepted", function (done) {
    // First connect to SSE to get a session
    var sessionId = null;
    var sseReq = http.request({
      hostname: "127.0.0.1",
      port: actualPort,
      path: "/sse",
      method: "GET"
    }, function (res) {
      var data = "";
      res.on("data", function (chunk) {
        data += chunk.toString();
        if (data.indexOf("event: endpoint") !== -1 && !sessionId) {
          // Extract session ID
          var match = data.match(/sessionId=([a-f0-9]+)/);
          if (match) {
            sessionId = match[1];

            // Now POST a message
            jsonRequest(actualPort, "/messages?sessionId=" + sessionId, {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "Test", version: "1.0" }
              }
            }, function (err, postRes) {
              assert.strictEqual(postRes.statusCode, 202);
              sseReq.destroy();
              done();
            });
          }
        }
      });
    });
    sseReq.end();
  });

  it("POST /messages with invalid session returns 404", function (done) {
    jsonRequest(actualPort, "/messages?sessionId=invalid", {
      jsonrpc: "2.0",
      id: 1,
      method: "ping"
    }, function (err, res) {
      assert.strictEqual(res.statusCode, 404);
      done();
    });
  });

  it("stops server cleanly", function (done) {
    server.stop(function () { done(); });
  });
});
