// ============================================================================
// PixInsight MCP Bridge
// Main PJSR Entry Point (ECMA 262-5 / ES5)
//
// This script runs within the PixInsight JavaScript Runtime Environment.
// It spawns a Node.js HTTP/SSE server and bridges MCP tool calls to
// PixInsight's native API.
//
// Installation:
//   1. Copy this project to PixInsight's scripts directory
//   2. Register via Script > Feature Scripts > Add
//   3. Run from Script > MCP > PixInsight MCP Bridge
//
// Requirements:
//   - Node.js >= 14 installed and accessible in PATH
//   - PixInsight 1.8.x or later
// ============================================================================

#feature-id    MCP > PixInsight MCP Bridge
#feature-info  MCP (Model Context Protocol) bridge for LLM interaction with PixInsight. \
               Starts a local HTTP/SSE server that exposes PixInsight processes and views \
               via the MCP protocol.

#include "lib/handlers.jsh"

// ============================================================================
// Configuration
// ============================================================================

var MCP_BRIDGE_VERSION = "1.0.0";
var DEFAULT_PORT = 3189;
var POLL_INTERVAL_MS = 50;    // How often to check for incoming commands (ms)
var NODE_SEARCH_PATHS = [
   "/usr/local/bin/node",
   "/usr/bin/node",
   "/opt/homebrew/bin/node",
   "/opt/local/bin/node"
];

// Windows paths
if (corePlatform === "MSWINDOWS" || corePlatform === "Windows") {
   NODE_SEARCH_PATHS = [
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Program Files (x86)\\nodejs\\node.exe"
   ];
}

// ============================================================================
// Node.js Discovery
// ============================================================================

/**
 * Find the Node.js binary path.
 */
function findNodePath() {
   // First try: use 'which' or 'where' command
   try {
      var cmd = (corePlatform === "MSWINDOWS" || corePlatform === "Windows") ? "where" : "which";
      var proc = new ExternalProcess();
      proc.start(cmd, ["node"]);
      for (; proc.isStarting; ) processEvents();
      for (; proc.isRunning; ) processEvents();
      if (proc.exitCode === 0) {
         var path = proc.standardOutput.toString().trim().split("\n")[0].trim();
         if (path.length > 0) {
            return path;
         }
      }
   } catch (e) {
      // which/where failed, try known paths
   }

   // Second try: check known paths
   for (var i = 0; i < NODE_SEARCH_PATHS.length; i++) {
      if (File.exists(NODE_SEARCH_PATHS[i])) {
         return NODE_SEARCH_PATHS[i];
      }
   }

   return null;
}

// ============================================================================
// IPC Communication
// ============================================================================

/**
 * IPCProcessor - Handles communication between the Node.js bridge server
 * and this PJSR script via ExternalProcess stdin/stdout.
 */
function IPCProcessor(externalProcess, dispatcher) {
   this._process = externalProcess;
   this._dispatcher = dispatcher;
   this._buffer = "";
}

/**
 * Process any available data from the Node.js server's stdout.
 * Parses line-delimited JSON commands and dispatches them.
 */
IPCProcessor.prototype.processAvailableData = function() {
   // Read any available stdout data
   var data;
   try {
      data = this._process.standardOutput;
      if (!data || data.length === 0) {
         return;
      }
   } catch (e) {
      return;
   }

   this._buffer += data.toString();

   // Process complete lines
   var lines = this._buffer.split("\n");
   this._buffer = lines.pop(); // Keep incomplete last line

   for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.length === 0) continue;

      try {
         var msg = JSON.parse(line);
         this._handleCommand(msg);
      } catch (e) {
         Console.warningln("[MCP Bridge] Failed to parse command: " + line);
         Console.warningln("[MCP Bridge] Error: " + String(e));
      }
   }
};

/**
 * Handle a single command from the Node.js server.
 */
IPCProcessor.prototype._handleCommand = function(msg) {
   var id = msg.id;
   var command = msg.command;
   var params = msg.params || {};

   Console.writeln("[MCP Bridge] Received command: " + command + " (id: " + id + ")");

   // Dispatch to handler
   var response = this._dispatcher.dispatch(command, params);

   // Add the request ID to the response
   response.id = id;

   // Send response back to Node.js server via stdin
   var responseLine = JSON.stringify(response) + "\n";
   try {
      this._process.write(responseLine);
   } catch (e) {
      Console.warningln("[MCP Bridge] Failed to send response: " + String(e));
   }
};

// ============================================================================
// Main Bridge Controller
// ============================================================================

function MCPBridgeController() {
   this._serverProcess = null;
   this._ipcProcessor = null;
   this._dispatcher = new CommandDispatcher();
   this._timer = null;
   this._running = false;
   this._port = DEFAULT_PORT;
   this._nodePath = null;
}

/**
 * Find the path to the bridge server.js relative to this script.
 */
MCPBridgeController.prototype._getServerScriptPath = function() {
   // Get the directory of this script
   // In PJSR, we can use #include path resolution or manual path construction
   var scriptDir = File.extractDirectory(
      #__FILE__ || File.fullPath(".")
   );
   return scriptDir + "/bridge/server.js";
};

/**
 * Start the MCP bridge.
 */
MCPBridgeController.prototype.start = function(port) {
   if (this._running) {
      Console.warningln("[MCP Bridge] Already running");
      return false;
   }

   this._port = port || DEFAULT_PORT;

   // Find Node.js
   Console.writeln("[MCP Bridge] Searching for Node.js...");
   this._nodePath = findNodePath();
   if (!this._nodePath) {
      Console.criticalln("[MCP Bridge] Node.js not found! Please install Node.js >= 14.");
      Console.criticalln("[MCP Bridge] Download from: https://nodejs.org/");
      return false;
   }
   Console.writeln("[MCP Bridge] Found Node.js: " + this._nodePath);

   // Find server script
   var serverScript = this._getServerScriptPath();
   if (!File.exists(serverScript)) {
      Console.criticalln("[MCP Bridge] Server script not found: " + serverScript);
      return false;
   }

   // Start the Node.js bridge server
   Console.writeln("[MCP Bridge] Starting bridge server on port " + this._port + "...");

   this._serverProcess = new ExternalProcess();
   this._ipcProcessor = new IPCProcessor(this._serverProcess, this._dispatcher);

   var self = this;

   // Set up stderr handler to capture server log messages
   this._serverProcess.onStandardErrorDataAvailable = function() {
      try {
         var errData = self._serverProcess.standardError;
         if (errData && errData.length > 0) {
            Console.writeln(errData.toString().trim());
         }
      } catch (e) {
         // Ignore read errors
      }
   };

   this._serverProcess.onError = function(errorCode) {
      Console.criticalln("[MCP Bridge] Server process error: " + errorCode);
      self.stop();
   };

   this._serverProcess.onFinished = function(exitCode, exitStatus) {
      Console.writeln("[MCP Bridge] Server process exited with code: " + exitCode);
      self._running = false;
   };

   // Start the server process
   try {
      this._serverProcess.start(this._nodePath, [
         serverScript,
         "--port", String(this._port)
      ]);

      // Wait for process to start
      for (var i = 0; i < 50 && this._serverProcess.isStarting; i++) {
         processEvents();
         msleep(100);
      }

      if (!this._serverProcess.isRunning) {
         Console.criticalln("[MCP Bridge] Failed to start server process");
         return false;
      }
   } catch (e) {
      Console.criticalln("[MCP Bridge] Failed to start server: " + String(e));
      return false;
   }

   // Set up polling timer for IPC
   this._timer = new Timer();
   this._timer.interval = POLL_INTERVAL_MS / 1000.0; // Timer uses seconds
   this._timer.periodic = true;
   this._timer.onTimeout = function() {
      if (self._running && self._serverProcess.isRunning) {
         self._ipcProcessor.processAvailableData();
      }
   };
   this._timer.start();

   this._running = true;
   Console.writeln("[MCP Bridge] Bridge started successfully!");
   Console.writeln("[MCP Bridge] MCP endpoint: http://127.0.0.1:" + this._port + "/sse");
   Console.noteln("[MCP Bridge] Press the Stop button or close this dialog to shut down.");

   return true;
};

/**
 * Stop the MCP bridge.
 */
MCPBridgeController.prototype.stop = function() {
   this._running = false;

   if (this._timer) {
      this._timer.stop();
      this._timer = null;
   }

   if (this._serverProcess && this._serverProcess.isRunning) {
      Console.writeln("[MCP Bridge] Stopping server process...");
      try {
         this._serverProcess.terminate();
         // Wait for termination
         for (var i = 0; i < 30; i++) {
            if (!this._serverProcess.isRunning) break;
            processEvents();
            msleep(100);
         }
         if (this._serverProcess.isRunning) {
            this._serverProcess.kill();
         }
      } catch (e) {
         Console.warningln("[MCP Bridge] Error stopping server: " + String(e));
      }
   }
   this._serverProcess = null;
   this._ipcProcessor = null;

   Console.writeln("[MCP Bridge] Bridge stopped.");
};

/**
 * Check if the bridge is running.
 */
MCPBridgeController.prototype.isRunning = function() {
   return this._running && this._serverProcess && this._serverProcess.isRunning;
};

// ============================================================================
// UI Dialog
// ============================================================================

function MCPBridgeDialog() {
   this.__base__ = Dialog;
   this.__base__();

   this.controller = new MCPBridgeController();

   var self = this;

   // --- Title ---
   this.title = "PixInsight MCP Bridge v" + MCP_BRIDGE_VERSION;

   // --- Info Label ---
   this.infoLabel = new Label(this);
   this.infoLabel.text = "MCP Bridge enables LLM interaction with PixInsight via the Model Context Protocol.";
   this.infoLabel.useRichText = false;

   // --- Port ---
   this.portLabel = new Label(this);
   this.portLabel.text = "Port:";
   this.portLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.portSpinBox = new SpinBox(this);
   this.portSpinBox.minValue = 1024;
   this.portSpinBox.maxValue = 65535;
   this.portSpinBox.value = DEFAULT_PORT;

   this.portSizer = new HorizontalSizer();
   this.portSizer.spacing = 4;
   this.portSizer.add(this.portLabel);
   this.portSizer.add(this.portSpinBox);
   this.portSizer.addStretch();

   // --- Status ---
   this.statusLabel = new Label(this);
   this.statusLabel.text = "Status: Stopped";

   // --- Buttons ---
   this.startButton = new PushButton(this);
   this.startButton.text = "Start";
   this.startButton.icon = this.scaledResource(":/icons/power.png");
   this.startButton.onClick = function() {
      self._onStart();
   };

   this.stopButton = new PushButton(this);
   this.stopButton.text = "Stop";
   this.stopButton.enabled = false;
   this.stopButton.onClick = function() {
      self._onStop();
   };

   this.closeButton = new PushButton(this);
   this.closeButton.text = "Close";
   this.closeButton.icon = this.scaledResource(":/icons/close.png");
   this.closeButton.onClick = function() {
      self._onClose();
   };

   this.buttonSizer = new HorizontalSizer();
   this.buttonSizer.spacing = 6;
   this.buttonSizer.add(this.startButton);
   this.buttonSizer.add(this.stopButton);
   this.buttonSizer.addStretch();
   this.buttonSizer.add(this.closeButton);

   // --- Layout ---
   this.sizer = new VerticalSizer();
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add(this.infoLabel);
   this.sizer.add(this.portSizer);
   this.sizer.add(this.statusLabel);
   this.sizer.addSpacing(4);
   this.sizer.add(this.buttonSizer);

   this.adjustToContents();
   this.setMinWidth(400);
}

MCPBridgeDialog.prototype = new Dialog();

MCPBridgeDialog.prototype._onStart = function() {
   var port = this.portSpinBox.value;
   if (this.controller.start(port)) {
      this.statusLabel.text = "Status: Running on port " + port;
      this.startButton.enabled = false;
      this.stopButton.enabled = true;
      this.portSpinBox.enabled = false;
   } else {
      this.statusLabel.text = "Status: Failed to start (check console)";
   }
};

MCPBridgeDialog.prototype._onStop = function() {
   this.controller.stop();
   this.statusLabel.text = "Status: Stopped";
   this.startButton.enabled = true;
   this.stopButton.enabled = false;
   this.portSpinBox.enabled = true;
};

MCPBridgeDialog.prototype._onClose = function() {
   if (this.controller.isRunning()) {
      this.controller.stop();
   }
   this.ok();
};

// ============================================================================
// Script Entry Point
// ============================================================================

function main() {
   Console.show();
   Console.writeln("==============================================");
   Console.writeln("PixInsight MCP Bridge v" + MCP_BRIDGE_VERSION);
   Console.writeln("==============================================");
   Console.writeln("");

   var dialog = new MCPBridgeDialog();
   dialog.execute();
}

main();
