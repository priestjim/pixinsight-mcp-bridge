"use strict";

/**
 * IPC (Inter-Process Communication) module.
 *
 * Handles line-delimited JSON communication between the Node.js bridge server
 * and the PixInsight PJSR script via stdin/stdout.
 *
 * Protocol:
 *   Node.js -> PJSR (via stdout of this process, read by PJSR's ExternalProcess):
 *     {"id":"<uuid>","command":"<name>","params":{...}}
 *
 *   PJSR -> Node.js (via stdin of this process, written by PJSR's ExternalProcess.write):
 *     {"id":"<uuid>","result":{...}}
 *     {"id":"<uuid>","error":{"message":"..."}}
 */

var crypto = require("crypto");

/**
 * IPCBridge - Manages communication with the PixInsight PJSR script.
 *
 * When running standalone (no PixInsight), it uses a mock handler.
 */
function IPCBridge(options) {
  options = options || {};
  this._pending = {};   // id -> { callback, timer }
  this._timeout = options.timeout || 30000;
  this._buffer = "";
  this._mockHandler = options.mockHandler || null;
  this._connected = false;

  if (!this._mockHandler) {
    this._setupStdin();
  }
}

/**
 * Set up stdin reading for responses from PixInsight.
 */
IPCBridge.prototype._setupStdin = function () {
  var self = this;

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", function (chunk) {
    self._connected = true;
    self._buffer += chunk;
    self._processBuffer();
  });
  process.stdin.on("end", function () {
    self._connected = false;
  });
};

/**
 * Process the line buffer, extracting complete JSON messages.
 */
IPCBridge.prototype._processBuffer = function () {
  var lines = this._buffer.split("\n");
  // Keep the last incomplete line in the buffer
  this._buffer = lines.pop() || "";

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    try {
      var msg = JSON.parse(line);
      this._handleResponse(msg);
    } catch (e) {
      process.stderr.write("[IPC] Failed to parse response: " + line + "\n");
    }
  }
};

/**
 * Handle a response message from PixInsight.
 */
IPCBridge.prototype._handleResponse = function (msg) {
  var id = msg.id;
  if (!id || !this._pending[id]) {
    process.stderr.write("[IPC] Received response for unknown id: " + id + "\n");
    return;
  }

  var entry = this._pending[id];
  clearTimeout(entry.timer);
  delete this._pending[id];

  if (msg.error) {
    entry.callback(new Error(msg.error.message || "Unknown error"), null);
  } else {
    entry.callback(null, msg.result);
  }
};

/**
 * Send a command to PixInsight and wait for the response.
 *
 * @param {Object} command - { command: string, params: object }
 * @param {Function} callback - callback(err, result)
 */
IPCBridge.prototype.send = function (command, callback) {
  // If using a mock handler, bypass IPC
  if (this._mockHandler) {
    return this._mockHandler(command, callback);
  }

  var id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  var msg = {
    id: id,
    command: command.command,
    params: command.params || {}
  };

  var self = this;
  var timer = setTimeout(function () {
    if (self._pending[id]) {
      delete self._pending[id];
      callback(new Error("Timeout waiting for PixInsight response"), null);
    }
  }, this._timeout);

  this._pending[id] = { callback: callback, timer: timer };

  // Write to stdout (which PJSR reads via ExternalProcess)
  var line = JSON.stringify(msg) + "\n";
  process.stdout.write(line);
};

/**
 * Check if the IPC bridge is connected to PixInsight.
 */
IPCBridge.prototype.isConnected = function () {
  return this._connected || !!this._mockHandler;
};

/**
 * Clean up pending requests.
 */
IPCBridge.prototype.destroy = function () {
  var ids = Object.keys(this._pending);
  for (var i = 0; i < ids.length; i++) {
    var entry = this._pending[ids[i]];
    clearTimeout(entry.timer);
    entry.callback(new Error("IPC bridge destroyed"), null);
  }
  this._pending = {};
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { IPCBridge: IPCBridge };
}
