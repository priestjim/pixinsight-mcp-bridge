"use strict";

/**
 * Tests for the PJSR command handlers.
 *
 * Since we can't run PJSR code outside PixInsight, these tests
 * mock the PixInsight API objects and test the handler logic.
 */

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

// ---------------------------------------------------------------------------
// Mock PixInsight API
// ---------------------------------------------------------------------------

function createMockPI() {
  var mockImages = {
    "Image01": {
      width: 4096, height: 4096, numberOfChannels: 3,
      isColor: true, bitsPerSample: 32
    },
    "Image02": {
      width: 2048, height: 2048, numberOfChannels: 1,
      isColor: false, bitsPerSample: 16
    }
  };

  var mockPreviews = {
    "Image01": [
      {
        id: "Preview01", fullId: "Image01->Preview01",
        image: { width: 512, height: 512, numberOfChannels: 3, isColor: true, bitsPerSample: 32 }
      }
    ]
  };

  var activeWindowId = "Image01";

  // Mock View
  function MockView(id, mainViewId) {
    this.id = id;
    this.fullId = mainViewId ? mainViewId + "->" + id : id;
    this.isMainView = !mainViewId;
    this.isPreview = !!mainViewId;
    this.isNull = false;
    var imgData = mockImages[mainViewId || id] || mockImages[id];
    this.image = imgData || { width: 0, height: 0, numberOfChannels: 0, isColor: false, bitsPerSample: 0 };
    this.window = { bringToFront: function () { }, currentView: this };
    this.beginProcess = function () { };
    this.endProcess = function () { };
  }

  // Mock ImageWindow
  function MockImageWindow(id) {
    this.id = id;
    this.isNull = false;
    this.filePath = "/images/" + id + ".fits";
    this.isModified = false;
    var imgData = mockImages[id] || { width: 0, height: 0, numberOfChannels: 0, isColor: false, bitsPerSample: 0 };
    this.mainView = new MockView(id, null);
    this.mainView.image = imgData;

    var pvs = mockPreviews[id] || [];
    this.previews = pvs.map(function (p) {
      var v = new MockView(p.id, id);
      v.image = p.image;
      return v;
    });

    this.currentView = this.mainView;
    this.bringToFront = function () { activeWindowId = id; };
  }

  var windows = Object.keys(mockImages).map(function (id) {
    return new MockImageWindow(id);
  });

  return {
    ImageWindow: {
      windows: windows,
      activeWindow: windows[0],
      windowById: function (id) {
        for (var i = 0; i < windows.length; i++) {
          if (windows[i].id === id) return windows[i];
        }
        return { isNull: true };
      }
    },
    View: {
      viewById: function (id) {
        // Search main views
        for (var i = 0; i < windows.length; i++) {
          if (windows[i].mainView.id === id) return windows[i].mainView;
          for (var j = 0; j < windows[i].previews.length; j++) {
            if (windows[i].previews[j].id === id) return windows[i].previews[j];
          }
        }
        return { isNull: true };
      }
    },
    Console: {
      writeln: function () { },
      warningln: function () { },
      criticalln: function () { }
    },
    // Mock process constructors
    PixelMath: function () {
      this.expression = "";
      this.executeOn = function () { };
      this.executeGlobal = function () { };
      this.canExecuteOn = function () { return true; };
      this.canExecuteGlobal = function () { return true; };
    },
    HistogramTransformation: function () {
      this.executeOn = function () { };
      this.executeGlobal = function () { };
      this.canExecuteOn = function () { return true; };
      this.canExecuteGlobal = function () { return true; };
    }
  };
}

// ---------------------------------------------------------------------------
// Load handlers.jsh in a sandboxed context with mock PI API
// ---------------------------------------------------------------------------

function loadHandlers() {
  var handlersPath = path.join(__dirname, "..", "src", "lib", "handlers.jsh");
  var code = fs.readFileSync(handlersPath, "utf8");

  var mockPI = createMockPI();

  var sandbox = {
    // PixInsight globals
    ImageWindow: mockPI.ImageWindow,
    View: mockPI.View,
    Console: mockPI.Console,
    File: {
      exists: function () { return true; },
      systemTempDirectory: "/tmp",
      readFile: function () {
        // Return a mock ByteArray with toBase64
        return {
          toBase64: function () { return "mockBase64ImageData"; }
        };
      },
      remove: function () { }
    },
    FileFormatInstance: function (fmt) {
      this.isNull = false;
      this.imageOptions = { bitsPerSample: 8 };
      this.create = function () { return true; };
      this.writeImage = function () { return true; };
      this.close = function () { };
    },
    PixelMath: mockPI.PixelMath,
    HistogramTransformation: mockPI.HistogramTransformation,
    Date: Date,
    // JavaScript globals
    JSON: JSON,
    String: String,
    Array: Array,
    Object: Object,
    Error: Error,
    parseInt: parseInt,
    parseFloat: parseFloat,
    console: console
  };

  vm.createContext(sandbox);

  // Provide eval that resolves names in the sandbox context
  sandbox.eval = function (expr) {
    return vm.runInContext(expr, sandbox);
  };

  vm.runInContext(code, sandbox, { filename: "handlers.jsh" });

  return sandbox;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CommandDispatcher", function () {
  var sandbox;
  var dispatcher;

  it("loads handlers.jsh without errors", function () {
    sandbox = loadHandlers();
    assert.ok(sandbox.CommandDispatcher);
  });

  it("creates CommandDispatcher instance", function () {
    dispatcher = new sandbox.CommandDispatcher();
    assert.ok(dispatcher);
  });

  it("returns error for unknown command", function () {
    var result = dispatcher.dispatch("nonexistent_command", {});
    assert.ok(result.error);
    assert.ok(result.error.message.indexOf("Unknown command") !== -1);
  });
});

describe("CommandDispatcher - list_views", function () {
  var dispatcher;

  it("lists all open views with properties", function () {
    var sandbox = loadHandlers();
    dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("list_views", {});
    assert.ok(result.result);
    assert.ok(result.result.views);
    assert.ok(result.result.views.length >= 2); // 2 main views + 1 preview

    // Check main view properties
    var img01 = result.result.views.filter(function (v) { return v.id === "Image01"; })[0];
    assert.ok(img01);
    assert.strictEqual(img01.isMainView, true);
    assert.strictEqual(img01.width, 4096);
    assert.strictEqual(img01.height, 4096);
    assert.strictEqual(img01.isColor, true);
    assert.strictEqual(img01.numberOfChannels, 3);
  });

  it("includes previews with parent reference", function () {
    var sandbox = loadHandlers();
    dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("list_views", {});
    var preview = result.result.views.filter(function (v) { return v.id === "Preview01"; })[0];
    assert.ok(preview);
    assert.strictEqual(preview.isPreview, true);
    assert.strictEqual(preview.isMainView, false);
    assert.strictEqual(preview.parentViewId, "Image01");
  });

  it("returns view count", function () {
    var sandbox = loadHandlers();
    dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("list_views", {});
    assert.strictEqual(result.result.count, result.result.views.length);
  });
});

describe("CommandDispatcher - get_focused_view", function () {
  it("returns the active view", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("get_focused_view", {});
    assert.ok(result.result);
    assert.strictEqual(result.result.focused, true);
    assert.ok(result.result.id);
    assert.ok(result.result.width > 0);
  });

  it("returns focused=false when no active window", function () {
    var sandbox = loadHandlers();
    sandbox.ImageWindow.activeWindow = { isNull: true };
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("get_focused_view", {});
    assert.strictEqual(result.result.focused, false);
  });
});

describe("CommandDispatcher - set_focused_view", function () {
  it("sets focus to existing view", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("set_focused_view", { viewId: "Image02" });
    assert.ok(result.result);
    assert.strictEqual(result.result.success, true);
  });

  it("returns error for missing viewId", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("set_focused_view", {});
    assert.ok(result.error);
  });

  it("returns error for non-existent view", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("set_focused_view", { viewId: "NonExistent" });
    assert.ok(result.error);
  });
});

describe("CommandDispatcher - list_processes", function () {
  it("returns available processes", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("list_processes", {});
    assert.ok(result.result);
    assert.ok(result.result.processes);
    // Should find at least PixelMath and HistogramTransformation (our mocks)
    var ids = result.result.processes.map(function (p) { return p.id; });
    assert.ok(ids.indexOf("PixelMath") !== -1, "Should find PixelMath");
    assert.ok(ids.indexOf("HistogramTransformation") !== -1, "Should find HistogramTransformation");
  });

  it("filters by category", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("list_processes", { category: "PixelMath" });
    assert.ok(result.result.processes.length > 0);
    result.result.processes.forEach(function (p) {
      assert.ok(p.category.toLowerCase().indexOf("pixelmath") !== -1);
    });
  });

  it("returns count", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("list_processes", {});
    assert.strictEqual(result.result.count, result.result.processes.length);
  });
});

describe("CommandDispatcher - invoke_process", function () {
  it("invokes a process on a view", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("invoke_process", {
      processId: "PixelMath",
      parameters: { expression: "$T * 2" },
      viewId: "Image01"
    });
    assert.ok(result.result);
    assert.strictEqual(result.result.success, true);
    assert.strictEqual(result.result.processId, "PixelMath");
    assert.strictEqual(result.result.executedOn, "Image01");
  });

  it("invokes a process globally", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("invoke_process", {
      processId: "HistogramTransformation"
    });
    assert.ok(result.result);
    assert.strictEqual(result.result.success, true);
    assert.strictEqual(result.result.executedOn, "global");
  });

  it("returns error for missing processId", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("invoke_process", {});
    assert.ok(result.error);
  });

  it("returns error for unavailable process", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("invoke_process", {
      processId: "NonExistentProcess"
    });
    assert.ok(result.error);
    assert.ok(result.error.message.indexOf("not available") !== -1);
  });

  it("returns error for non-existent view", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("invoke_process", {
      processId: "PixelMath",
      viewId: "NoSuchView"
    });
    assert.ok(result.error);
  });
});

describe("CommandDispatcher - custom processes", function () {
  function addMockProcess(sandbox) {
    sandbox.BlurXTerminator = function () {
      this.executeOn = function () { };
      this.executeGlobal = function () { };
      this.canExecuteOn = function () { return true; };
      this.canExecuteGlobal = function () { return true; };
    };
  }

  it("includes custom processes in list_processes", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    addMockProcess(sandbox);

    dispatcher.setCustomProcesses([
      { id: "BlurXTerminator", category: "ThirdParty", description: "AI-powered deconvolution" }
    ]);

    var result = dispatcher.dispatch("list_processes", {});
    var ids = result.result.processes.map(function (p) { return p.id; });
    assert.ok(ids.indexOf("BlurXTerminator") !== -1, "Should include custom process");
  });

  it("filters custom processes by category", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    addMockProcess(sandbox);

    dispatcher.setCustomProcesses([
      { id: "BlurXTerminator", category: "ThirdParty", description: "AI deconvolution" }
    ]);

    var result = dispatcher.dispatch("list_processes", { category: "ThirdParty" });
    var ids = result.result.processes.map(function (p) { return p.id; });
    assert.ok(ids.indexOf("BlurXTerminator") !== -1, "Should find custom process by category");
  });

  it("excludes unavailable custom processes", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();

    // Do NOT add NoSuchProcess to the sandbox — it should be filtered out
    dispatcher.setCustomProcesses([
      { id: "NoSuchProcess", category: "Custom", description: "Not installed" }
    ]);

    var result = dispatcher.dispatch("list_processes", {});
    var ids = result.result.processes.map(function (p) { return p.id; });
    assert.ok(ids.indexOf("NoSuchProcess") === -1, "Should exclude unavailable custom process");
  });

  it("can invoke a custom process", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    addMockProcess(sandbox);

    var result = dispatcher.dispatch("invoke_process", {
      processId: "BlurXTerminator",
      viewId: "Image01"
    });
    assert.ok(result.result);
    assert.strictEqual(result.result.success, true);
    assert.strictEqual(result.result.processId, "BlurXTerminator");
  });
});

describe("CommandDispatcher - get_image_from_view", function () {
  it("returns base64 image data for a specific view", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("get_image_from_view", { viewId: "Image01" });
    assert.ok(result.result);
    assert.strictEqual(result.result._imageData, "mockBase64ImageData");
    assert.strictEqual(result.result._mimeType, "image/jpeg");
    assert.ok(result.result._metadata);
    assert.strictEqual(result.result._metadata.viewId, "Image01");
    assert.strictEqual(result.result._metadata.width, 4096);
    assert.strictEqual(result.result._metadata.height, 4096);
    assert.strictEqual(result.result._metadata.isColor, true);
  });

  it("returns image from active view when viewId omitted", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("get_image_from_view", {});
    assert.ok(result.result);
    assert.strictEqual(result.result._imageData, "mockBase64ImageData");
    assert.ok(result.result._metadata.viewId);
  });

  it("returns error for non-existent view", function () {
    var sandbox = loadHandlers();
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("get_image_from_view", { viewId: "NoSuchView" });
    assert.ok(result.error);
    assert.ok(result.error.message.indexOf("View not found") !== -1);
  });

  it("returns error when no active window and no viewId", function () {
    var sandbox = loadHandlers();
    sandbox.ImageWindow.activeWindow = { isNull: true };
    var dispatcher = new sandbox.CommandDispatcher();
    var result = dispatcher.dispatch("get_image_from_view", {});
    assert.ok(result.error);
    assert.ok(result.error.message.indexOf("No active image window") !== -1);
  });
});
