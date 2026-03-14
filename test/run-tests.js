"use strict";

/**
 * Simple test runner for the PixInsight MCP Bridge.
 * Uses Node.js built-in assert module - no external dependencies.
 *
 * Usage: node test/run-tests.js
 */

var path = require("path");
var fs = require("fs");

// Colors for terminal output
var GREEN = "\x1b[32m";
var RED = "\x1b[31m";
var YELLOW = "\x1b[33m";
var RESET = "\x1b[0m";
var BOLD = "\x1b[1m";

var totalTests = 0;
var passedTests = 0;
var failedTests = 0;
var failures = [];

/**
 * Simple test context passed to test files.
 */
function describe(suiteName, fn) {
  console.log("\n" + BOLD + suiteName + RESET);
  fn();
}

function it(testName, fn) {
  totalTests++;
  try {
    if (fn.length > 0) {
      // Async test with done callback - run synchronously with a flag
      var finished = false;
      var testError = null;
      fn(function done(err) {
        finished = true;
        if (err) testError = err;
      });
      if (testError) throw testError;
    } else {
      fn();
    }
    passedTests++;
    console.log("  " + GREEN + "\u2713" + RESET + " " + testName);
  } catch (e) {
    failedTests++;
    console.log("  " + RED + "\u2717" + RESET + " " + testName);
    console.log("    " + RED + (e.message || String(e)) + RESET);
    failures.push({ suite: "", test: testName, error: e });
  }
}

// Make test functions global
global.describe = describe;
global.it = it;

// Load and run test files
var testDir = path.join(__dirname);
var testFiles = fs.readdirSync(testDir).filter(function (f) {
  return f.startsWith("test-") && f.endsWith(".js");
});

console.log(BOLD + "\nPixInsight MCP Bridge - Test Suite" + RESET);
console.log("=".repeat(40));

for (var i = 0; i < testFiles.length; i++) {
  var testFile = path.join(testDir, testFiles[i]);
  try {
    require(testFile);
  } catch (e) {
    console.log(RED + "\nFailed to load test file: " + testFiles[i] + RESET);
    console.log(RED + (e.stack || e.message || String(e)) + RESET);
    failedTests++;
    totalTests++;
  }
}

// Summary
console.log("\n" + "=".repeat(40));
console.log(BOLD + "Results:" + RESET +
  " " + GREEN + passedTests + " passed" + RESET +
  (failedTests > 0 ? ", " + RED + failedTests + " failed" + RESET : "") +
  " (" + totalTests + " total)");

if (failures.length > 0) {
  console.log("\n" + RED + BOLD + "Failures:" + RESET);
  for (var j = 0; j < failures.length; j++) {
    var f = failures[j];
    console.log("  " + RED + (j + 1) + ". " + f.test + RESET);
    if (f.error.stack) {
      console.log("     " + f.error.stack.split("\n").slice(0, 3).join("\n     "));
    }
  }
}

console.log("");
process.exit(failedTests > 0 ? 1 : 0);
