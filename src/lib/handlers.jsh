// ============================================================================
// PixInsight MCP Bridge - Command Handlers
// PJSR Include File (ECMA 262-5 / ES5)
//
// Implements the PixInsight-side command handling for MCP tool calls.
// Each handler interacts with native PixInsight APIs to fulfill requests.
// ============================================================================

/**
 * CommandDispatcher - Routes incoming commands to appropriate handlers
 * and returns results.
 */
function CommandDispatcher() {
   this._handlers = {};
   this._customProcesses = [];
   this._registerHandlers();
}

/**
 * Set user-registered custom processes.
 * Each entry should have { id, category, description }.
 */
CommandDispatcher.prototype.setCustomProcesses = function(processes) {
   this._customProcesses = processes || [];
};

/**
 * Register all built-in command handlers.
 */
CommandDispatcher.prototype._registerHandlers = function() {
   var self = this;

   this._handlers["list_processes"] = function(params) {
      return self._listProcesses(params);
   };

   this._handlers["invoke_process"] = function(params) {
      return self._invokeProcess(params);
   };

   this._handlers["list_views"] = function(params) {
      return self._listViews(params);
   };

   this._handlers["get_focused_view"] = function(params) {
      return self._getFocusedView(params);
   };

   this._handlers["set_focused_view"] = function(params) {
      return self._setFocusedView(params);
   };

   this._handlers["get_image_from_view"] = function(params) {
      return self._getImageFromView(params);
   };
};

/**
 * Dispatch a command and return the result.
 *
 * @param {String} command - Command name
 * @param {Object} params - Command parameters
 * @returns {Object} { result: ... } or { error: { message: ... } }
 */
CommandDispatcher.prototype.dispatch = function(command, params) {
   var handler = this._handlers[command];
   if (!handler) {
      return { error: { message: "Unknown command: " + command } };
   }

   try {
      var result = handler(params || {});
      return { result: result };
   } catch (e) {
      return { error: { message: String(e) } };
   }
};

// ============================================================================
// list_processes - Enumerate available PixInsight processes
// ============================================================================

CommandDispatcher.prototype._listProcesses = function(params) {
   var processes = [];
   var categoryFilter = params.category || null;

   // Strategy 1: Try to get all installed process definitions
   // PixInsight PJSR exposes all processes as global constructors.
   // We enumerate known process categories and their processes.
   var processRegistry = this._getProcessRegistry().concat(this._customProcesses);

   for (var i = 0; i < processRegistry.length; i++) {
      var entry = processRegistry[i];

      // Apply category filter if specified
      if (categoryFilter && entry.category.toLowerCase().indexOf(categoryFilter.toLowerCase()) === -1) {
         continue;
      }

      // Verify process is available in this PixInsight installation
      try {
         if (typeof eval(entry.id) === "function") {
            processes.push(entry);
         }
      } catch (e) {
         // Process not available in this installation - skip
      }
   }

   return {
      processes: processes,
      count: processes.length
   };
};

/**
 * Returns the registry of known PixInsight processes.
 * This is a comprehensive but not exhaustive list.
 * Processes are verified at runtime via eval() to confirm availability.
 */
CommandDispatcher.prototype._getProcessRegistry = function() {
   return [
      // --- Geometry ---
      { id: "Crop", category: "Geometry", description: "Crop image to specified dimensions" },
      { id: "DynamicCrop", category: "Geometry", description: "Interactive dynamic crop" },
      { id: "FastRotation", category: "Geometry", description: "Fast 90/180/270 degree rotation and mirroring" },
      { id: "Resample", category: "Geometry", description: "Resample (resize) image" },
      { id: "Rotation", category: "Geometry", description: "Arbitrary angle rotation" },
      { id: "IntegerResample", category: "Geometry", description: "Integer factor resampling" },

      // --- Image Calibration ---
      { id: "ImageCalibration", category: "ImageCalibration", description: "CCD image calibration (bias, dark, flat)" },
      { id: "Debayer", category: "ImageCalibration", description: "CFA debayering / demosaicing" },
      { id: "Defect", category: "ImageCalibration", description: "Defective pixel correction" },
      { id: "SuperBias", category: "ImageCalibration", description: "Super bias frame generation" },

      // --- Image Integration ---
      { id: "ImageIntegration", category: "ImageIntegration", description: "Image stacking / integration" },
      { id: "DrizzleIntegration", category: "ImageIntegration", description: "Drizzle integration for sub-pixel accuracy" },

      // --- Star Alignment ---
      { id: "StarAlignment", category: "StarAlignment", description: "Star registration and alignment" },

      // --- Intensity Transformations ---
      { id: "HistogramTransformation", category: "IntensityTransformations", description: "Histogram stretch and transformation" },
      { id: "CurvesTransformation", category: "IntensityTransformations", description: "Curves adjustment" },
      { id: "AutoHistogram", category: "IntensityTransformations", description: "Automatic histogram stretch" },
      { id: "ScreenTransferFunction", category: "IntensityTransformations", description: "Screen transfer function (STF) auto-stretch" },
      { id: "AdaptiveStretch", category: "IntensityTransformations", description: "Adaptive non-linear stretch" },
      { id: "ExponentialTransformation", category: "IntensityTransformations", description: "Exponential / PIP intensity transformation" },
      { id: "MaskedStretch", category: "IntensityTransformations", description: "Masked non-linear stretch" },
      { id: "ArcsinhStretch", category: "IntensityTransformations", description: "Inverse hyperbolic sine stretch" },
      { id: "GeneralizedHyperbolicStretch", category: "IntensityTransformations", description: "Generalized hyperbolic stretch (GHS)" },

      // --- Color Spaces / Channels ---
      { id: "ChannelCombination", category: "ColorSpaces", description: "Combine channels into color image" },
      { id: "ChannelExtraction", category: "ColorSpaces", description: "Extract individual color channels" },
      { id: "ConvertToGrayscale", category: "ColorSpaces", description: "Convert to grayscale" },
      { id: "ConvertToRGBColor", category: "ColorSpaces", description: "Convert to RGB color" },
      { id: "RGBWorkingSpace", category: "ColorSpaces", description: "Set RGB working space parameters" },
      { id: "LRGBCombination", category: "ColorSpaces", description: "LRGB luminance-color combination" },
      { id: "SplitCFA", category: "ColorSpaces", description: "Split CFA channels" },
      { id: "MergeCFA", category: "ColorSpaces", description: "Merge CFA channels" },

      // --- Color Calibration ---
      { id: "BackgroundNeutralization", category: "ColorCalibration", description: "Neutralize background color cast" },
      { id: "ColorCalibration", category: "ColorCalibration", description: "Photometric color calibration" },
      { id: "SpectrophotometricColorCalibration", category: "ColorCalibration", description: "Spectrophotometric color calibration (SPCC)" },
      { id: "LinearFit", category: "ColorCalibration", description: "Linear fit for channel matching" },
      { id: "PhotometricColorCalibration", category: "ColorCalibration", description: "Photometric color calibration (PCC)" },
      { id: "ColorSaturation", category: "ColorCalibration", description: "Color saturation adjustment" },
      { id: "SCNR", category: "ColorCalibration", description: "Subtractive chromatic noise reduction (green removal)" },

      // --- PixelMath ---
      { id: "PixelMath", category: "PixelMath", description: "Pixel math expressions and formulas" },

      // --- Convolution / Deconvolution ---
      { id: "Convolution", category: "Convolution", description: "Image convolution" },
      { id: "Deconvolution", category: "Deconvolution", description: "Richardson-Lucy / regularized deconvolution" },
      { id: "UnsharpMask", category: "Convolution", description: "Unsharp mask sharpening" },
      { id: "LarsonSekanina", category: "Convolution", description: "Larson-Sekanina rotational gradient filter" },

      // --- Noise Reduction ---
      { id: "MultiscaleMedianTransform", category: "NoiseReduction", description: "Multiscale median transform noise reduction" },
      { id: "MultiscaleLinearTransform", category: "NoiseReduction", description: "Multiscale linear transform" },
      { id: "TGVDenoise", category: "NoiseReduction", description: "Total generalized variation denoising" },
      { id: "ACDNR", category: "NoiseReduction", description: "Adaptive chrominance-directed noise reduction" },
      { id: "GREYCstoration", category: "NoiseReduction", description: "GREYCstoration denoising" },
      { id: "ATrousWaveletTransform", category: "NoiseReduction", description: "A trous wavelet transform" },
      { id: "NoiseGenerator", category: "NoiseReduction", description: "Synthetic noise generation" },

      // --- Background Modeling ---
      { id: "AutomaticBackgroundExtractor", category: "BackgroundModeling", description: "Automatic background extraction (ABE)" },
      { id: "DynamicBackgroundExtraction", category: "BackgroundModeling", description: "Dynamic background extraction (DBE)" },

      // --- Morphological ---
      { id: "MorphologicalTransformation", category: "Morphological", description: "Morphological operations (erosion, dilation, etc.)" },

      // --- Mask ---
      { id: "RangeSelection", category: "Mask", description: "Create mask by pixel range selection" },
      { id: "StarMask", category: "Mask", description: "Generate star mask" },

      // --- Star / PSF ---
      { id: "DynamicPSF", category: "StarAnalysis", description: "Dynamic PSF fitting" },
      { id: "SubframeSelector", category: "StarAnalysis", description: "Subframe quality analysis and selection" },

      // --- Astrometry ---
      { id: "ImageSolver", category: "Astrometry", description: "Plate solving / astrometric solution" },
      { id: "ManualImageSolver", category: "Astrometry", description: "Manual plate solving" },
      { id: "AnnotateImage", category: "Astrometry", description: "Annotate image with catalog objects" },

      // --- Image Inspection ---
      { id: "Statistics", category: "ImageInspection", description: "Compute image statistics" },
      { id: "Blink", category: "ImageInspection", description: "Blink comparator" },

      // --- File I/O ---
      { id: "ReadImage", category: "FileIO", description: "Read image from file" },
      { id: "WriteImage", category: "FileIO", description: "Write image to file" },

      // --- Rendering ---
      { id: "ICCProfileTransformation", category: "ColorManagement", description: "ICC color profile transformation" },

      // --- HDR ---
      { id: "HDRComposition", category: "HDR", description: "HDR composition from multiple exposures" },
      { id: "HDRMultiscaleTransform", category: "HDR", description: "HDR multiscale transform" },

      // --- Mosaic ---
      { id: "GradientMergeMosaic", category: "Mosaic", description: "Gradient domain mosaic merge" },

      // --- Script Processes (commonly available) ---
      { id: "Script", category: "Scripting", description: "Script execution" },

      // --- Painting ---
      { id: "CloneStamp", category: "Painting", description: "Clone stamp tool" },

      // --- Misc ---
      { id: "Invert", category: "IntensityTransformations", description: "Invert image" },
      { id: "Binarize", category: "IntensityTransformations", description: "Binarize image" },
      { id: "Rescale", category: "IntensityTransformations", description: "Rescale pixel values" },
      { id: "SampleFormatConversion", category: "ImageTransformations", description: "Convert sample format (8/16/32 bit)" }
   ];
};

// ============================================================================
// invoke_process - Execute a PixInsight process
// ============================================================================

CommandDispatcher.prototype._invokeProcess = function(params) {
   var processId = params.processId;
   if (!processId) {
      throw "processId is required";
   }

   // Verify the process constructor exists
   var ProcessConstructor;
   try {
      ProcessConstructor = eval(processId);
      if (typeof ProcessConstructor !== "function") {
         throw "not a function";
      }
   } catch (e) {
      throw "Process '" + processId + "' is not available: " + String(e);
   }

   // Create process instance
   var P = new ProcessConstructor();

   // Set parameters
   var processParams = params.parameters || {};
   for (var key in processParams) {
      if (processParams.hasOwnProperty(key)) {
         try {
            P[key] = processParams[key];
         } catch (e) {
            throw "Failed to set parameter '" + key + "': " + String(e);
         }
      }
   }

   // Execute
   var viewId = params.viewId;
   if (viewId) {
      // Execute on a specific view
      var view = View.viewById(viewId);
      if (!view || view.isNull) {
         throw "View not found: " + viewId;
      }

      if (!P.canExecuteOn(view)) {
         throw "Process '" + processId + "' cannot execute on view '" + viewId + "'";
      }

      view.beginProcess();
      try {
         P.executeOn(view);
      } finally {
         view.endProcess();
      }

      return {
         success: true,
         processId: processId,
         executedOn: viewId,
         message: "Process '" + processId + "' executed successfully on view '" + viewId + "'"
      };
   } else {
      // Execute globally
      if (!P.canExecuteGlobal()) {
         throw "Process '" + processId + "' cannot execute globally";
      }

      P.executeGlobal();

      return {
         success: true,
         processId: processId,
         executedOn: "global",
         message: "Process '" + processId + "' executed globally"
      };
   }
};

// ============================================================================
// list_views - List all open views
// ============================================================================

CommandDispatcher.prototype._listViews = function(params) {
   var views = [];
   var windows = ImageWindow.windows;

   for (var i = 0; i < windows.length; i++) {
      var w = windows[i];
      if (w.isNull) continue;

      var mainView = w.mainView;
      var img = mainView.image;

      views.push({
         id: mainView.id,
         fullId: mainView.fullId,
         isMainView: true,
         isPreview: false,
         width: img.width,
         height: img.height,
         numberOfChannels: img.numberOfChannels,
         isColor: img.isColor,
         bitsPerSample: img.bitsPerSample,
         filePath: w.filePath || "",
         isModified: w.isModified
      });

      // Include previews
      var previews = w.previews;
      for (var j = 0; j < previews.length; j++) {
         var pv = previews[j];
         var pvImg = pv.image;
         views.push({
            id: pv.id,
            fullId: pv.fullId,
            isMainView: false,
            isPreview: true,
            parentViewId: mainView.id,
            width: pvImg.width,
            height: pvImg.height,
            numberOfChannels: pvImg.numberOfChannels,
            isColor: pvImg.isColor,
            bitsPerSample: pvImg.bitsPerSample
         });
      }
   }

   return {
      views: views,
      count: views.length
   };
};

// ============================================================================
// get_focused_view - Get the currently active view
// ============================================================================

CommandDispatcher.prototype._getFocusedView = function(params) {
   var w = ImageWindow.activeWindow;
   if (!w || w.isNull) {
      return {
         focused: false,
         message: "No active image window"
      };
   }

   var view = w.currentView;
   var img = view.image;

   return {
      focused: true,
      id: view.id,
      fullId: view.fullId,
      isMainView: view.isMainView,
      isPreview: view.isPreview,
      width: img.width,
      height: img.height,
      numberOfChannels: img.numberOfChannels,
      isColor: img.isColor,
      bitsPerSample: img.bitsPerSample,
      filePath: w.filePath || "",
      isModified: w.isModified
   };
};

// ============================================================================
// set_focused_view - Change focus to a specific view
// ============================================================================

CommandDispatcher.prototype._setFocusedView = function(params) {
   var viewId = params.viewId;
   if (!viewId) {
      throw "viewId is required";
   }

   // Try to find the view by ID
   var view = View.viewById(viewId);
   if (view && !view.isNull) {
      // Found as a view ID - bring its window to front
      var w = view.window;
      w.bringToFront();
      w.currentView = view;
      return {
         success: true,
         viewId: viewId,
         message: "Focus set to view '" + viewId + "'"
      };
   }

   // Try as a window ID
   var window = ImageWindow.windowById(viewId);
   if (window && !window.isNull) {
      window.bringToFront();
      return {
         success: true,
         viewId: viewId,
         message: "Focus set to window '" + viewId + "'"
      };
   }

   throw "View or window not found: " + viewId;
};

// ============================================================================
// get_image_from_view - Get image contents as base64-encoded JPEG
// ============================================================================

CommandDispatcher.prototype._getImageFromView = function(params) {
   var viewId = params.viewId;
   var view;
   var w;

   if (viewId) {
      view = View.viewById(viewId);
      if (!view || view.isNull) {
         throw "View not found: " + viewId;
      }
      w = view.window;
   } else {
      w = ImageWindow.activeWindow;
      if (!w || w.isNull) {
         throw "No active image window";
      }
      view = w.currentView;
   }

   var img = view.image;

   // Build a unique temp file path
   var tmpDir = File.systemTempDirectory;
   var tmpFile = tmpDir + "/pixinsight_mcp_" + view.id + "_" + Date.now() + ".jpg";

   // Use FileFormatInstance to write the view as JPEG
   var fmt = new FileFormatInstance("JPEG");
   if (fmt.isNull) {
      throw "JPEG file format is not available";
   }

   var base64Data;
   try {
      if (!fmt.create(tmpFile, "quality 92")) {
         throw "Failed to create temp file: " + tmpFile;
      }

      var options = fmt.imageOptions;
      options.bitsPerSample = 8;
      fmt.imageOptions = options;

      if (typeof fmt.jpegQuality !== "undefined") {
         fmt.jpegQuality = 92;
      }

      if (!fmt.writeImage(img)) {
         throw "Failed to write image data";
      }

      fmt.close();
      var fileData = File.readFile(tmpFile);
      base64Data = fileData.toBase64();
   } finally {
      try { fmt.close(); } catch (ignored) {}
      try { File.remove(tmpFile); } catch (ignored) {}
   }

   // Return with special _imageData key that the MCP handler recognizes
   return {
      _imageData: base64Data,
      _mimeType: "image/jpeg",
      _metadata: {
         viewId: view.id,
         fullId: view.fullId,
         width: img.width,
         height: img.height,
         numberOfChannels: img.numberOfChannels,
         isColor: img.isColor,
         bitsPerSample: img.bitsPerSample
      }
   };
};
