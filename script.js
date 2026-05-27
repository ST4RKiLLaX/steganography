// Constants and bit helpers shared with workers live in constants.js
// (loaded by index.html before this script). Workers load it via
// importScripts so the values cannot drift between main thread and worker.

// Security Configuration
const MAX_IMAGE_DIMENSION = 10000;         // 10,000 x 10,000 px max
const MAX_FILE_SIZE = 52428800;            // 50MB file size limit
const ALLOWED_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Binary display: truncate to avoid DoS from huge strings
const BINARY_PREVIEW_BITS = 4096;

const FORMAT_VERSION = 3;

// Performance: Reusable encoder/decoder (stateless)
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

// Performance: DOM element cache
const DOM_CACHE = {
  messageTextarea: null,
  errorElement: null,
  errorDecodeElement: null,
  originalCanvas: null,
  nulledCanvas: null,
  messageCanvas: null,
  decodeCanvas: null,
  
  // Getter with null check
  get(key) {
    if (!this[key]) {
      const selectors = {
        messageTextarea: 'textarea.message',
        errorElement: '.error',
        errorDecodeElement: '.error-decode',
        originalCanvas: '.original canvas',
        nulledCanvas: '.nulled canvas',
        messageCanvas: '.message canvas',
        decodeCanvas: '.decode canvas'
      };
      if (selectors[key]) {
        this[key] = document.querySelector(selectors[key]);
      }
    }
    return this[key];
  },
  
  // Clear cache (call when DOM changes)
  clear() {
    Object.keys(this).forEach(key => {
      if (typeof this[key] !== 'function') {
        this[key] = null;
      }
    });
  }
};

// Download cache (precomputed PNG blobs) - encoded only (original blob unused)
const DOWNLOAD_CACHE = {
  encoded: null,
  building: {
    encoded: false
  }
};

function isDownloadReady(type) {
  if (!type) return false;
  return Boolean(DOWNLOAD_CACHE[type] && !DOWNLOAD_CACHE.building[type]);
}

function updateDownloadAvailability() {
  var downloadEncodedBtn = document.getElementById('downloadEncoded');
  if (downloadEncodedBtn) {
    downloadEncodedBtn.disabled = !isDownloadReady('encoded');
  }
}

function toggleEncodeDropZonePreview(showPreview) {
  var dropZone = document.getElementById('encodeDropZone');
  if (!dropZone) return;
  
  var content = dropZone.querySelector('.drop-zone-content');
  var preview = dropZone.querySelector('.drop-zone-preview');
  
  if (content) {
    content.style.display = showPreview ? 'none' : 'block';
  }
  if (preview) {
    preview.style.display = showPreview ? 'block' : 'none';
  }
}

function renderEncodeDropZonePreview(source) {
  var dropZone = document.getElementById('encodeDropZone');
  if (!dropZone || !source) return;
  
  var previewCanvas = dropZone.querySelector('.drop-zone-preview canvas');
  if (!previewCanvas) return;
  
  var sourceWidth = source.naturalWidth || source.width;
  var sourceHeight = source.naturalHeight || source.height;
  if (!sourceWidth || !sourceHeight) return;
  
  previewCanvas.width = sourceWidth;
  previewCanvas.height = sourceHeight;
  
  var ctx = previewCanvas.getContext('2d', { desynchronized: true });
  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  ctx.drawImage(source, 0, 0);
  
  toggleEncodeDropZonePreview(true);
}

function setEncodedPreviewVisibility(showPreview) {
  var section = document.getElementById('encodedPreviewSection');
  if (section) {
    section.style.display = showPreview ? 'block' : 'none';
  }
}

function renderPreviewCanvas(sourceCanvas, targetCanvas) {
  if (!sourceCanvas || !targetCanvas) {
    throw new Error('Preview source or target missing.');
  }
  
  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  
  var ctx = targetCanvas.getContext('2d', { desynchronized: true });
  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  ctx.drawImage(sourceCanvas, 0, 0);
}

function setEncodedPreviewMode(mode) {
  try {
    var previewCanvas = document.getElementById('encodedPreviewCanvas');
    var originalCanvas = DOM_CACHE.get('originalCanvas');
    var encodedCanvas = DOM_CACHE.get('messageCanvas');

    if (mode === 'original') {
      renderPreviewCanvas(originalCanvas, previewCanvas);
    } else {
      renderPreviewCanvas(encodedCanvas, previewCanvas);
    }
  } catch (error) {
    showError('Error updating encoded preview: ' + error.message);
  }
}

function toggleDecodeDropZonePreview(showPreview) {
  var dropZone = document.getElementById('decodeDropZone');
  if (!dropZone) return;
  
  var content = dropZone.querySelector('.drop-zone-content');
  var preview = dropZone.querySelector('.drop-zone-preview');
  
  if (content) {
    content.style.display = showPreview ? 'none' : 'block';
  }
  if (preview) {
    preview.style.display = showPreview ? 'block' : 'none';
  }
}

function renderDecodeDropZonePreview(source) {
  var dropZone = document.getElementById('decodeDropZone');
  if (!dropZone || !source) return;
  
  var previewCanvas = dropZone.querySelector('.drop-zone-preview canvas');
  if (!previewCanvas) return;
  
  var sourceWidth = source.naturalWidth || source.width;
  var sourceHeight = source.naturalHeight || source.height;
  if (!sourceWidth || !sourceHeight) return;
  
  previewCanvas.width = sourceWidth;
  previewCanvas.height = sourceHeight;
  
  var ctx = previewCanvas.getContext('2d', { desynchronized: true });
  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  ctx.drawImage(source, 0, 0);
  
  toggleDecodeDropZonePreview(true);
}

function clearDownloadCache(type) {
  if (DOWNLOAD_CACHE[type] && DOWNLOAD_CACHE[type].objectUrl) {
    URL.revokeObjectURL(DOWNLOAD_CACHE[type].objectUrl);
  }
  DOWNLOAD_CACHE[type] = null;
  DOWNLOAD_CACHE.building[type] = false;
}

function clearAllDownloadCache() {
  clearDownloadCache('encoded');
  updateDownloadAvailability();
}

function clearEncodedCaches() {
  ['encoded'].forEach(type => clearDownloadCache(type));
  updateDownloadAvailability();
  setEncodedPreviewVisibility(false);
}

function setDownloadCache(type, blob, width, height) {
  clearDownloadCache(type);
  DOWNLOAD_CACHE[type] = {
    blob: blob,
    objectUrl: URL.createObjectURL(blob),
    width: width,
    height: height,
    createdAt: Date.now()
  };
  DOWNLOAD_CACHE.building[type] = false;
  updateDownloadAvailability();
}

// Single-flight registry: if the user re-triggers encode/decode while a
// previous worker is still running, terminate the stale one so we don't
// leak workers and don't render stale results on top of fresh ones.
var CURRENT_WORKERS = { encode: null, decode: null };

function startWorker(slot, scriptUrl) {
  var prev = CURRENT_WORKERS[slot];
  if (prev) {
    try { prev.terminate(); } catch (_) { /* noop */ }
  }
  var worker = new Worker(scriptUrl);
  CURRENT_WORKERS[slot] = worker;
  return worker;
}

function finishWorker(slot, worker) {
  if (CURRENT_WORKERS[slot] === worker) {
    CURRENT_WORKERS[slot] = null;
  }
  try { worker.terminate(); } catch (_) { /* noop */ }
}

// Magic bytes and header parsing (decompression bomb + MIME spoofing mitigation)
var MAGIC_PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
var MAGIC_JPEG = new Uint8Array([0xFF, 0xD8, 0xFF]);
var MAGIC_WEBP_RIFF = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
var MAGIC_WEBP_WEBP = new Uint8Array([0x57, 0x45, 0x42, 0x50]);
var JPEG_SOF_MARKERS = [0xC0, 0xC1, 0xC2];
var JPEG_HEADER_SCAN_BYTES = 65536;

function arraysEqual(a, b, len) {
  for (var i = 0; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function readImageDimensionsFromHeader(file) {
  return new Promise(function(resolve, reject) {
    if (!file || !file.slice) {
      reject(new Error('Invalid file.'));
      return;
    }
    var bytesToRead = 32;
    if (file.size < 24) {
      reject(new Error('File too small to be a valid image.'));
      return;
    }
    file.slice(0, Math.max(bytesToRead, JPEG_HEADER_SCAN_BYTES)).arrayBuffer()
      .then(function(buf) {
        var arr = new Uint8Array(buf);
        var view = buf.byteLength >= 4 ? new DataView(buf) : null;

        if (arr.length >= 24 && arraysEqual(arr, MAGIC_PNG, 8)) {
          var w = view.getUint32(16, false);
          var h = view.getUint32(20, false);
          resolve({ width: w, height: h, detectedType: 'image/png' });
          return;
        }

        if (arr.length >= 3 && arr[0] === 0xFF && arr[1] === 0xD8 && arr[2] === 0xFF) {
          for (var i = 2; i < arr.length - 8; i++) {
            if (arr[i] === 0xFF && JPEG_SOF_MARKERS.indexOf(arr[i + 1]) !== -1) {
              var h = (arr[i + 5] << 8) | arr[i + 6];
              var w = (arr[i + 7] << 8) | arr[i + 8];
              resolve({ width: w, height: h, detectedType: 'image/jpeg' });
              return;
            }
          }
          reject(new Error('Invalid JPEG: no SOF marker found.'));
          return;
        }

        if (arr.length >= 12 && arraysEqual(arr, MAGIC_WEBP_RIFF, 4) && arraysEqual(arr.subarray(8), MAGIC_WEBP_WEBP, 4)) {
          if (arr.length < 30) {
            reject(new Error('Invalid WebP: header truncated.'));
            return;
          }
          var vp8 = arr[12] === 0x56 && arr[13] === 0x50 && arr[14] === 0x38;
          var vp8l = vp8 && arr[15] === 0x4C;
          var vp8x = vp8 && arr[15] === 0x58;
          var w, h;
          if (vp8x && arr.length >= 30) {
            // Width and height are 24-bit (3 bytes) each; spec uses "Minus One", so add 1
            w = (arr[24] | (arr[25] << 8) | (arr[26] << 16)) + 1;
            h = (arr[27] | (arr[28] << 8) | (arr[29] << 16)) + 1;
          } else if (vp8l && arr.length >= 25) {
            var val = arr[21] | (arr[22] << 8) | (arr[23] << 16) | ((arr[24] & 0x3F) << 24);
            w = (val & 0x3FFF) + 1;
            h = ((val >> 14) & 0x3FFF) + 1;
          } else if (vp8 && arr[15] === 0x20 && arr.length >= 30) {
            // VP8 lossy: 3-byte frame tag (20-22), start code 9D 01 2A (23-25),
            // then 14-bit width/height at 26-27 and 28-29, little-endian.
            w = (arr[26] | (arr[27] << 8)) & 0x3FFF;
            h = (arr[28] | (arr[29] << 8)) & 0x3FFF;
          } else {
            reject(new Error('Invalid WebP: unsupported chunk type.'));
            return;
          }
          resolve({ width: w, height: h, detectedType: 'image/webp' });
          return;
        }

        reject(new Error('Invalid file: not a valid PNG, JPEG, or WebP image.'));
      })
      .catch(function(err) {
        reject(err);
      });
  });
}

function validateMagicBytesAndDimensions(file, context) {
  return readImageDimensionsFromHeader(file).then(function(result) {
    if (!ALLOWED_FILE_TYPES.includes(result.detectedType)) {
      showError('Invalid file: not a valid PNG, JPEG, or WebP image.', context);
      return null;
    }
    if (file.type && file.type !== result.detectedType) {
      showError('File type mismatch: declared ' + file.type + ' but file signature indicates ' + result.detectedType + '.', context);
      return null;
    }
    if (!validateImageDimensions(result.width, result.height)) {
      return null;
    }
    return result;
  }).catch(function(err) {
    showError(err.message || 'Invalid file: not a valid PNG, JPEG, or WebP image.', context);
    return null;
  });
}

// Synchronous pre-flight: just null + size checks. The deeper magic-byte
// and dimension validation happens in validateMagicBytesAndDimensions,
// which reads the file header once and is strictly stronger than a
// 16-byte signature sniff.
function validateFileBasics(file, context) {
  if (!file) {
    showError('No file selected. Please choose an image file.', context);
    return false;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError('File too large! Maximum file size: ' + (MAX_FILE_SIZE / 1048576).toFixed(0) + 'MB. Your file: ' + (file.size / 1048576).toFixed(1) + 'MB.', context);
    return false;
  }
  return true;
}

function validateImageDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    showError('Invalid image dimensions.');
    return false;
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    showError('Image too large. Maximum dimension: ' + MAX_IMAGE_DIMENSION.toLocaleString() + ' pixels.');
    return false;
  }
  if (width <= 0 || height <= 0) {
    showError('Invalid image dimensions.');
    return false;
  }
  return true;
}

function validateMessageLength(length) {
  if (!Number.isSafeInteger(length)) {
    showError('Invalid message length.');
    return false;
  }
  if (length > MAX_MESSAGE_LENGTH) {
    showError('Message too long! Maximum length: ' + MAX_MESSAGE_LENGTH.toLocaleString() + ' bytes.');
    return false;
  }
  return true;
}

function sanitizeDecodedMessage(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
}

function validateCapacity(capacity) {
  if (!Number.isSafeInteger(capacity)) {
    showError('Image capacity calculation error.');
    return false;
  }
  if (capacity > MAX_THEORETICAL_EMBED_CAPACITY_BYTES) {
    showError('Image capacity exceeds safety limits.');
    return false;
  }
  return true;
}

function showError(message, context) {
  var errorElement;
  if (context === 'decode') {
    errorElement = DOM_CACHE.get('errorDecodeElement');
  } else {
    errorElement = DOM_CACHE.get('errorElement');
  }
  
  if (errorElement) {
    errorElement.textContent = '⚠️ ' + message;
    errorElement.style.display = 'block';
  }
  // Errors persist until next operation (no auto-hide)
  // Users can manually scroll past or will be cleared on next encode/decode
}

function downloadCachedImage(type) {
  if (!isDownloadReady(type)) {
    showError('Download is not ready yet. Please wait for encoding to finish.');
    return;
  }
  
  var entry = DOWNLOAD_CACHE[type];
  var objectUrl = entry.objectUrl;
  var link = document.createElement('a');
  var timestamp = new Date().getTime();
  link.download = 'steganography-' + type + '-' + timestamp + '.png';
  link.href = objectUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Make downloadCachedImage globally accessible
window.downloadCanvasImage = downloadCachedImage;

// Event listeners setup
document.addEventListener('DOMContentLoaded', function() {
  // File input listeners
  var encodeFileInput = document.querySelector('input[name=baseFile]');
  if (encodeFileInput) {
    encodeFileInput.addEventListener('change', function() { previewEncodeImage(); });
  }

  var decodeFileInput = document.querySelector('input[name=decodeFile]');
  if (decodeFileInput) {
    decodeFileInput.addEventListener('change', function() { previewDecodeImage(); });
  }
  
  // Button listeners
  var encodeButton = document.querySelector('button.encode-btn');
  if (encodeButton) {
    encodeButton.addEventListener('click', function(event) {
      event.preventDefault();
      encodeMessage();
    });
  }
  
  var decodeButton = document.querySelector('button.decode-btn');
  if (decodeButton) {
    decodeButton.addEventListener('click', function(event) {
      event.preventDefault();
      decodeMessage();
    });
  }

  // Clear download cache when switching away from Encode tab (frees blob memory)
  document.querySelectorAll('a[data-bs-toggle="tab"]').forEach(function(tab) {
    tab.addEventListener('shown.bs.tab', function(e) {
      if (e.target.getAttribute('href') === '#decode') {
        clearEncodedCaches();
      }
    });
  });

  // Message textarea - real-time character counter and auto LSB selection
  var messageTextarea = DOM_CACHE.get('messageTextarea');
  if (messageTextarea) {
    messageTextarea.addEventListener('input', function() {
      clearEncodedCaches();
      updateMessageAnalysis(this.value);
    });
  }
  
  // Manual override button handlers
  var overrideBtn = document.getElementById('mode-override-btn');
  var autoBtn = document.getElementById('mode-auto-btn');
  var manualSelect = document.getElementById('manual-lsb-mode');
  
  if (overrideBtn) {
    overrideBtn.addEventListener('click', function() {
      document.getElementById('capacity-analysis').style.display = 'none';
      document.getElementById('manual-mode-override').style.display = 'block';
      clearEncodedCaches();
      // Trigger recalculation with manual mode
      var text = DOM_CACHE.get('messageTextarea')?.value || '';
      if (text) {
        updateMessageAnalysis(text);
      }
    });
  }
  
  if (autoBtn) {
    autoBtn.addEventListener('click', function() {
      document.getElementById('manual-mode-override').style.display = 'none';
      document.getElementById('capacity-analysis').style.display = 'block';
      clearEncodedCaches();
      // Trigger recalculation with auto mode
      var text = DOM_CACHE.get('messageTextarea')?.value || '';
      if (text) {
        updateMessageAnalysis(text);
      }
    });
  }
  
  if (manualSelect) {
    manualSelect.addEventListener('change', function() {
      clearEncodedCaches();
      // Recalculate with manual mode
      var text = DOM_CACHE.get('messageTextarea')?.value || '';
      if (text) {
        updateMessageAnalysis(text);
      }
    });
  }
  
  // Drag and Drop File Upload
  // Pass file directly to onDrop - input.files assignment is read-only in most browsers
  function setupDragAndDrop(dropZone, fileInput, onDrop) {
    if (!dropZone || !fileInput) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(eventName) {
      dropZone.addEventListener(eventName, function(e) {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    ['dragenter', 'dragover'].forEach(function(eventName) {
      dropZone.addEventListener(eventName, function() {
        dropZone.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach(function(eventName) {
      dropZone.addEventListener(eventName, function() {
        dropZone.classList.remove('drag-active');
      });
    });

    dropZone.addEventListener('drop', function(e) {
      var files = e.dataTransfer.files;
      if (files && files.length > 0 && onDrop) {
        onDrop(files[0]);
      }
    });

    dropZone.addEventListener('click', function() {
      fileInput.click();
    });
  }

  var encodeDropZone = document.getElementById('encodeDropZone');
  var decodeDropZone = document.getElementById('decodeDropZone');

  if (encodeDropZone && encodeFileInput) {
    setupDragAndDrop(encodeDropZone, encodeFileInput, function(file) {
      previewEncodeImage(file);
    });
  }

  if (decodeDropZone && decodeFileInput) {
    setupDragAndDrop(decodeDropZone, decodeFileInput, function(file) {
      previewDecodeImage(file);
    });
  }
  
  var downloadEncodedBtn = document.getElementById('downloadEncoded');
  if (downloadEncodedBtn) {
    downloadEncodedBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      window.downloadCanvasImage('encoded');
    });
  }

  var toggleEncoded = document.getElementById('previewToggleEncoded');
  var toggleOriginal = document.getElementById('previewToggleOriginal');
  if (toggleEncoded) {
    toggleEncoded.addEventListener('change', function() {
      if (this.checked) {
        setEncodedPreviewMode('encoded');
      }
    });
  }
  if (toggleOriginal) {
    toggleOriginal.addEventListener('change', function() {
      if (this.checked) {
        setEncodedPreviewMode('original');
      }
    });
  }
  
  // Manual LSB mode override for decode
  var manualOverrideBtn = document.getElementById('manual-override-btn');
  if (manualOverrideBtn) {
    manualOverrideBtn.addEventListener('click', function() {
      var autoDetected = document.getElementById('auto-detected');
      var manualSelect = document.getElementById('manual-mode-select');
      var detector = document.getElementById('decode-mode-detector');
      
      if (autoDetected && manualSelect) {
        autoDetected.style.display = 'none';
        manualSelect.style.display = 'block';
        
        // Pre-fill with detected value
        var detectedMode = detector?.getAttribute('data-detected-mode') || '1';
        document.getElementById('decode-lsb-mode').value = detectedMode;
      }
    });
  }
  
  updateDownloadAvailability();
});

function previewDecodeImage(file) {
  if (!file) {
    file = document.querySelector('input[name=decodeFile]').files[0];
  }

  toggleDecodeDropZonePreview(false);

  if (!validateFileBasics(file, 'decode')) return;

  validateMagicBytesAndDimensions(file, 'decode').then(function(headerResult) {
    if (!headerResult) return;
    previewImage(file, '.decode canvas', function(image) {
      try {
        renderDecodeDropZonePreview(image);
      } catch (error) {
        showError('Error processing decode image: ' + error.message, 'decode');
      }
      detectLsbMode();
    }, 'decode');
  });
}

// Auto LSB Mode Selection Functions
function calculateOptimalLSBMode(messageBytes, imageWidth, imageHeight) {
  var requiredBits = SENTINEL_BITS + (messageBytes * 8);
  var availablePixels = (imageWidth * imageHeight) - SENTINEL_PIXELS;
  
  // Try each mode from 1→4 (prefer lowest for minimal footprint)
  for (var lsbMode = 1; lsbMode <= MAX_LSB_BITS; lsbMode++) {
    var capacity = availablePixels * 3 * lsbMode;
    if (requiredBits <= capacity) {
      var utilization = (requiredBits / capacity * 100);
      return {
        mode: lsbMode,
        required: requiredBits,
        available: capacity,
        utilization: utilization.toFixed(1),
        recommendation: getRecommendation(lsbMode, utilization)
      };
    }
  }
  
  return null; // Message too large
}

function getRecommendation(lsbMode, utilization) {
  if (utilization < 60) return 'Excellent';
  if (utilization < 85) return 'Good';
  if (utilization < 95) return 'Tight';
  return 'Full';
}

function updateMessageAnalysis(text) {
  var charCount = text.length;
  const encoder = TEXT_ENCODER;
  var byteCount = encoder.encode(text).length;
  
  // Update counter badge
  var counterBadge = document.getElementById('message-counter-badge');
  if (counterBadge) {
    counterBadge.textContent = '📝 ' + charCount.toLocaleString() + ' characters (' + byteCount.toLocaleString() + ' bytes)';
  }
  
  // Get image dimensions
  var canvas = DOM_CACHE.get('originalCanvas');
  if (!canvas || canvas.width === 0) {
    document.getElementById('capacity-analysis').style.display = 'none';
    // Hide capacity badge if no image
    var capacityBadge = document.getElementById('capacity-badge');
    if (capacityBadge) {
      capacityBadge.style.display = 'none';
    }
    return;
  }
  
  // Check if manual override is active
  var manualOverride = document.getElementById('manual-mode-override');
  var isManual = manualOverride && manualOverride.style.display !== 'none';
  
  if (isManual) {
    // Use manual mode
    var manualMode = parseInt(document.getElementById('manual-lsb-mode').value, 10);
    updateManualModeAnalysis(byteCount, canvas.width, canvas.height, manualMode);
  } else {
    // Calculate optimal mode
    var analysis = calculateOptimalLSBMode(byteCount, canvas.width, canvas.height);
    
    if (!analysis) {
      // Message too large
      showCapacityError(byteCount, canvas.width, canvas.height);
      return;
    }
    
    // Update UI with analysis
    updateCapacityAnalysisUI(analysis, byteCount);
  }
}

function updateCapacityAnalysisUI(analysis, messageBytes) {
  var capacityAnalysis = document.getElementById('capacity-analysis');
  var usageBar = document.getElementById('usage-bar');
  var capacityStats = document.getElementById('capacity-stats');
  var autoModeBadge = document.getElementById('auto-mode-badge');
  var capacityBadge = document.getElementById('capacity-badge');
  
  if (!capacityAnalysis || !usageBar || !capacityStats || !autoModeBadge) return;
  
  capacityAnalysis.style.display = 'block';
  
  // Update progress bar
  var utilization = parseFloat(analysis.utilization);
  usageBar.style.width = utilization + '%';
  usageBar.setAttribute('aria-valuenow', utilization);
  
  // Set color based on utilization
  usageBar.className = 'progress-bar';
  var badgeColor = 'bg-success';
  if (utilization < 60) {
    usageBar.classList.add('bg-success');
    badgeColor = 'bg-success';
  } else if (utilization < 85) {
    usageBar.classList.add('bg-warning');
    badgeColor = 'bg-warning';
  } else if (utilization < 95) {
    usageBar.classList.add('bg-orange');
    badgeColor = 'bg-warning';
  } else {
    usageBar.classList.add('bg-danger');
    badgeColor = 'bg-danger';
  }
  
  // Update stats text
  var capacityBytes = Math.floor(analysis.available / 8);
  capacityStats.textContent = messageBytes.toLocaleString() + ' / ' + 
                              capacityBytes.toLocaleString() + ' bytes (' + 
                              analysis.utilization + '% - ' + analysis.recommendation + ')';
  
  // Update auto mode badge
  autoModeBadge.textContent = 'Auto: ' + analysis.mode + '-LSB';
  autoModeBadge.className = 'badge';
  if (analysis.mode === 1) {
    autoModeBadge.classList.add('bg-primary');
  } else if (analysis.mode === 2) {
    autoModeBadge.classList.add('bg-info');
  } else if (analysis.mode === 3) {
    autoModeBadge.classList.add('bg-warning');
  } else {
    autoModeBadge.classList.add('bg-danger');
  }
  
  // Store selected mode for encoding
  autoModeBadge.setAttribute('data-auto-mode', analysis.mode);
  
  // Update capacity badge
  if (capacityBadge) {
    capacityBadge.style.display = 'inline-block';
    capacityBadge.textContent = '💾 ' + messageBytes.toLocaleString() + ' / ' + 
                                capacityBytes.toLocaleString() + ' bytes (' + analysis.mode + '-LSB)';
    capacityBadge.className = 'badge ' + badgeColor;
    capacityBadge.setAttribute('role', 'button');
    capacityBadge.setAttribute('data-bs-toggle', 'modal');
    capacityBadge.setAttribute('data-bs-target', '#lsbModal');
    capacityBadge.setAttribute('title', 'Click to learn how this works');
  }
}

function updateManualModeAnalysis(messageBytes, imageWidth, imageHeight, manualMode) {
  var requiredBits = SENTINEL_BITS + (messageBytes * 8);
  var availablePixels = (imageWidth * imageHeight) - SENTINEL_PIXELS;
  var capacity = availablePixels * 3 * manualMode;
  
  var capacityAnalysis = document.getElementById('capacity-analysis');
  var usageBar = document.getElementById('usage-bar');
  var capacityStats = document.getElementById('capacity-stats');
  var autoModeBadge = document.getElementById('auto-mode-badge');
  var capacityBadge = document.getElementById('capacity-badge');
  
  if (!capacityAnalysis || !usageBar || !capacityStats || !autoModeBadge) return;
  
  if (requiredBits > capacity) {
    // Message too large for manual mode
    showCapacityError(messageBytes, imageWidth, imageHeight);
    return;
  }
  
  capacityAnalysis.style.display = 'block';
  
  var utilization = (requiredBits / capacity * 100);
  usageBar.style.width = utilization.toFixed(1) + '%';
  usageBar.setAttribute('aria-valuenow', utilization.toFixed(1));
  
  // Set color
  usageBar.className = 'progress-bar';
  var badgeColor = 'bg-success';
  if (utilization < 60) {
    usageBar.classList.add('bg-success');
    badgeColor = 'bg-success';
  } else if (utilization < 85) {
    usageBar.classList.add('bg-warning');
    badgeColor = 'bg-warning';
  } else if (utilization < 95) {
    usageBar.classList.add('bg-orange');
    badgeColor = 'bg-warning';
  } else {
    usageBar.classList.add('bg-danger');
    badgeColor = 'bg-danger';
  }
  
  var capacityBytes = Math.floor(capacity / 8);
  var recommendation = getRecommendation(manualMode, utilization);
  capacityStats.textContent = messageBytes.toLocaleString() + ' / ' + 
                              capacityBytes.toLocaleString() + ' bytes (' + 
                              utilization.toFixed(1) + '% - ' + recommendation + ')';
  
  autoModeBadge.textContent = 'Manual: ' + manualMode + '-LSB';
  autoModeBadge.className = 'badge bg-secondary';
  autoModeBadge.setAttribute('data-auto-mode', manualMode);
  
  // Update capacity badge
  if (capacityBadge) {
    capacityBadge.style.display = 'inline-block';
    capacityBadge.textContent = '💾 ' + messageBytes.toLocaleString() + ' / ' + 
                                capacityBytes.toLocaleString() + ' bytes (' + manualMode + '-LSB)';
    capacityBadge.className = 'badge ' + badgeColor;
    capacityBadge.setAttribute('role', 'button');
    capacityBadge.setAttribute('data-bs-toggle', 'modal');
    capacityBadge.setAttribute('data-bs-target', '#lsbModal');
    capacityBadge.setAttribute('title', 'Click to learn how this works');
  }
}

function showCapacityError(messageBytes, imageWidth, imageHeight) {
  var capacityAnalysis = document.getElementById('capacity-analysis');
  var usageBar = document.getElementById('usage-bar');
  var capacityStats = document.getElementById('capacity-stats');
  var capacityBadge = document.getElementById('capacity-badge');
  
  if (!capacityAnalysis || !usageBar || !capacityStats) return;
  
  capacityAnalysis.style.display = 'block';
  
  usageBar.style.width = '100%';
  usageBar.className = 'progress-bar bg-danger';
  
  // Calculate max capacity with 4-LSB
  var availablePixels = (imageWidth * imageHeight) - SENTINEL_PIXELS;
  var maxCapacity = Math.floor((availablePixels * 3 * MAX_LSB_BITS) / 8);
  
  capacityStats.textContent = 'Message too large! ' + messageBytes.toLocaleString() + 
                              ' bytes exceeds maximum capacity of ' + maxCapacity.toLocaleString() + ' bytes';
  capacityStats.classList.add('text-danger');
  
  // Update capacity badge to show error
  if (capacityBadge) {
    capacityBadge.style.display = 'inline-block';
    capacityBadge.textContent = '💾 ' + messageBytes.toLocaleString() + ' / ' + 
                                maxCapacity.toLocaleString() + ' bytes (Too Large!)';
    capacityBadge.className = 'badge bg-danger';
  }
}

function parseSentinelFromPixels(pixel) {
  var sentinelBitsArray = [];
  for (var i = 0; i < SENTINEL_PIXELS * 4 && sentinelBitsArray.length < SENTINEL_BITS; i += 4) {
    for (var offset = 0; offset < 3; offset++) {
      sentinelBitsArray.push((pixel[i + offset] & 1).toString());
      if (sentinelBitsArray.length >= SENTINEL_BITS) break;
    }
  }
  var sentinelBits = sentinelBitsArray.join('');
  var magic = sentinelBits.substring(0, 16);
  var lsbBits = 1;
  var messageLength = 0;
  var isV3 = false;
  if (magic === MAGIC_V3) {
    lsbBits = parseInt(sentinelBits.substring(16, 20), 2);
    messageLength = parseInt(sentinelBits.substring(24, 56), 2);
    isV3 = true;
  }
  return { lsbBits: lsbBits, messageLength: messageLength, isV3: isV3 };
}

function detectLsbMode() {
  try {
    var canvas = DOM_CACHE.get('decodeCanvas');
    if (!canvas) return;

    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var parsed = parseSentinelFromPixels(imageData.data);
    var detectedMode = parsed.lsbBits;
    var messageLength = parsed.messageLength;
    var isV3 = parsed.isV3;

    // Update UI (display only - decode does not trust DOM)
    var detector = document.getElementById('decode-mode-detector');
    var modeText = document.getElementById('detected-mode-text');
    var modeIcon = document.getElementById('detected-mode-icon');
    
    if (detector && modeText && modeIcon) {
      modeText.textContent = detectedMode + '-LSB';
      modeIcon.textContent = isV3 ? '✓' : '⚠️';
      detector.style.display = 'block';
      
      // Store detected mode and message length for decode
      detector.setAttribute('data-detected-mode', detectedMode);
      detector.setAttribute('data-is-v3', isV3);
      detector.setAttribute('data-message-length', messageLength);
      
      // Reset manual override to hidden
      var autoDetected = document.getElementById('auto-detected');
      var manualSelect = document.getElementById('manual-mode-select');
      if (autoDetected) autoDetected.style.display = 'block';
      if (manualSelect) manualSelect.style.display = 'none';
    }
  } catch (error) {
    console.error('Mode detection failed:', error);
  }
}

function previewEncodeImage(file) {
  if (!file) {
    file = document.querySelector("input[name=baseFile]").files[0];
  }

  clearAllDownloadCache();
  toggleEncodeDropZonePreview(false);
  setEncodedPreviewVisibility(false);
  var toggleEncoded = document.getElementById('previewToggleEncoded');
  if (toggleEncoded) {
    toggleEncoded.checked = true;
  }

  if (!validateFileBasics(file)) return;

  var errorElement = DOM_CACHE.get('errorElement');
  if (errorElement) errorElement.style.display = 'none';

  validateMagicBytesAndDimensions(file).then(function(headerResult) {
    if (!headerResult) return;
    previewImage(file, '.original canvas', function(image, canvas) {
      try {
        var domCanvas = DOM_CACHE.get('originalCanvas');
        renderEncodeDropZonePreview(image);
        var lsbBits = 1;
        var availablePixels = (domCanvas.width * domCanvas.height) - SENTINEL_PIXELS;
        var totalBits = availablePixels * lsbBits * 3;
        var capacity = Math.floor(totalBits / 8);
        if (!validateCapacity(capacity)) return;
        var capacityBadge = document.getElementById('capacity-badge');
        if (capacityBadge) {
          capacityBadge.style.display = 'inline-block';
          capacityBadge.textContent = '💾 0 / ' + capacity.toLocaleString() + ' bytes (' + lsbBits + '-LSB)';
        }
        updateModalWithImageData(domCanvas.width, domCanvas.height, capacity, lsbBits);
        var messageText = DOM_CACHE.get('messageTextarea')?.value || '';
        if (messageText) updateMessageAnalysis(messageText);
      } catch (error) {
        toggleEncodeDropZonePreview(false);
        showError('Error processing image: ' + error.message);
      }
    });
  });
}

function updateModalWithImageData(width, height, capacity, lsbBitsPerChannel) {
  lsbBitsPerChannel = lsbBitsPerChannel || 1;  // Default to 1-LSB if not provided
  
  var totalPixels = width * height;
  var availablePixels = totalPixels - SENTINEL_PIXELS;  // Subtract sentinel pixels
  var totalBitsInImage = totalPixels * 3 * 8;  // Total bits (all 8 bits per channel)
  var lsbBitsAvailable = availablePixels * 3 * lsbBitsPerChannel;  // Use selected LSB mode
  
  // Update image info using safe DOM creation
  var modalImageInfo = document.getElementById('modalImageInfo');
  modalImageInfo.textContent = ''; // Clear existing content
  
  var createLine = function(text) {
    var line = document.createElement('div');
    line.textContent = text;
    return line;
  };
  
  var createCodeLine = function(label, value, suffix) {
    var line = document.createElement('div');
    line.textContent = label;
    var code = document.createElement('code');
    code.textContent = value;
    line.appendChild(code);
    if (suffix) {
      line.appendChild(document.createTextNode(' ' + suffix));
    }
    return line;
  };
  
  var strong = document.createElement('strong');
  strong.textContent = 'Your Image:';
  modalImageInfo.appendChild(strong);
  modalImageInfo.appendChild(document.createElement('br'));
  modalImageInfo.appendChild(createCodeLine('Size: ', width + ' × ' + height, 'pixels'));
  modalImageInfo.appendChild(createCodeLine('Total pixels: ', totalPixels.toLocaleString(), ''));
  modalImageInfo.appendChild(createCodeLine('Sentinel overhead: ', '19 pixels (7 bytes)', ''));
  modalImageInfo.appendChild(createCodeLine('Available pixels: ', availablePixels.toLocaleString(), ''));
  modalImageInfo.appendChild(createCodeLine('Current mode: ', lsbBitsPerChannel + '-LSB', ''));
  modalImageInfo.appendChild(createCodeLine('Capacity: ', capacity.toLocaleString(), 'bytes'));
  
  // Add per-mode capacity comparison
  modalImageInfo.appendChild(document.createElement('br'));
  var strongModes = document.createElement('strong');
  strongModes.textContent = 'Capacity by LSB Mode:';
  modalImageInfo.appendChild(strongModes);
  modalImageInfo.appendChild(document.createElement('br'));
  
  for (var mode = 1; mode <= MAX_LSB_BITS; mode++) {
    var modeCapacity = Math.floor((availablePixels * 3 * mode) / 8);
    var indicator = mode === lsbBitsPerChannel ? ' ← Current' : '';
    modalImageInfo.appendChild(createCodeLine(mode + '-LSB: ', modeCapacity.toLocaleString(), 'bytes' + indicator));
  }
  
  // Update calculation steps using safe DOM creation
  var modalCalcSteps = document.getElementById('modalCalcSteps');
  modalCalcSteps.textContent = ''; // Clear existing content
  
  var strongCalc = document.createElement('strong');
  strongCalc.textContent = 'Step-by-step (v3 format):';
  modalCalcSteps.appendChild(strongCalc);
  modalCalcSteps.appendChild(document.createElement('br'));
  modalCalcSteps.appendChild(createCodeLine('1. ', width.toLocaleString() + ' × ' + height.toLocaleString() + ' = ' + totalPixels.toLocaleString(), 'total pixels'));
  modalCalcSteps.appendChild(createCodeLine('2. ', totalPixels.toLocaleString() + ' - 19 = ' + availablePixels.toLocaleString(), 'pixels (minus sentinel)'));
  modalCalcSteps.appendChild(createCodeLine('3. ', availablePixels.toLocaleString() + ' × 3 × ' + lsbBitsPerChannel + ' = ' + lsbBitsAvailable.toLocaleString(), 'LSB bits'));
  modalCalcSteps.appendChild(createCodeLine('4. ', lsbBitsAvailable.toLocaleString() + ' ÷ 8 = ' + capacity.toLocaleString(), 'bytes capacity'));
}

function previewImage(file, canvasSelector, callback, errorContext) {
  var image = new Image();
  var canvas = document.querySelector(canvasSelector);

  if (!file) return;

  image.onload = function() {
    canvas.width = image.width;
    canvas.height = image.height;
    var context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(image.src);
    callback(image, canvas);
  };

  image.onerror = function() {
    URL.revokeObjectURL(image.src);
    showError('Could not decode image. File may be corrupted or not a valid PNG, JPEG, or WebP.', errorContext);
  };

  image.src = URL.createObjectURL(file);
}

function encodeMessage() {
  var encodeButton = document.querySelector('button.encode-btn');
  
  // Rate limiting - disable button during processing
  if (encodeButton) {
    encodeButton.disabled = true;
  }
  
  clearEncodedCaches();
  
  var errorElement = DOM_CACHE.get('errorElement');
  if (errorElement) errorElement.style.display = 'none';
  document.querySelector(".binary").style.display = 'none';

  var workerPending = false;
  try {
    var text = DOM_CACHE.get('messageTextarea')?.value || '';
    
    // Validate message is not empty
    if (!text || text.length === 0) {
      showError('Please enter a message to encode.');
      return;
    }
    
    // Encode to UTF-8 and validate byte length
    const encoder = TEXT_ENCODER;
    var messageBytes = encoder.encode(text);
    if (!validateMessageLength(messageBytes.length)) {
      return;
    }

    var originalCanvas = DOM_CACHE.get('originalCanvas');
    var nulledCanvas = DOM_CACHE.get('nulledCanvas');
    var messageCanvas = DOM_CACHE.get('messageCanvas');

    if (!originalCanvas || !nulledCanvas || !messageCanvas) {
      showError('Please upload an image first.');
      return;
    }

    var originalContext = originalCanvas.getContext("2d", { willReadFrequently: true });
    var nulledContext = nulledCanvas.getContext("2d", { willReadFrequently: true });
    var messageContext = messageCanvas.getContext("2d", { willReadFrequently: true });

    var width = originalCanvas.width;
    var height = originalCanvas.height;
    
    // Validate dimensions
    if (!validateImageDimensions(width, height)) {
      return;
    }
    
    // Get LSB mode from auto-selection or manual override
    var lsbBits = 1;
    var manualOverride = document.getElementById('manual-mode-override');
    var isManual = manualOverride && manualOverride.style.display !== 'none';
    
    if (isManual) {
      lsbBits = parseInt(document.getElementById('manual-lsb-mode').value, 10);
    } else {
      var autoModeBadge = document.getElementById('auto-mode-badge');
      if (autoModeBadge) {
        lsbBits = parseInt(autoModeBadge.getAttribute('data-auto-mode') || 1, 10);
      }
    }
    
    // Calculate capacity (accounting for v3 sentinel)
    var availablePixels = (width * height) - SENTINEL_PIXELS;
    var totalBits = availablePixels * lsbBits * 3;
    var maxCapacity = Math.floor(totalBits / 8);
    
    if (!validateCapacity(maxCapacity)) {
      return;
    }

    // Check if the image is big enough to hide the message
    var requiredBits = SENTINEL_BITS + (messageBytes.length * 8);
    if (requiredBits > (availablePixels * lsbBits * 3 + SENTINEL_BITS)) {
      showError('Message too long! Your message is ' + messageBytes.length.toLocaleString() + 
                ' bytes but this image can only hide ' + maxCapacity.toLocaleString() + 
                ' bytes with ' + lsbBits + '-LSB mode. Please use a larger image or shorter message.');
      return;
    }

    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      showError('Web Workers and OffscreenCanvas are required. Please use a modern browser.');
      return;
    }

    var totalMessageBits = messageBytes.length * 8;
    var previewBits = Math.min(BINARY_PREVIEW_BITS, totalMessageBits);
    var magicBinary = MAGIC_V3;
    var modeBinary = lsbBits.toString(2).padStart(4, '0');
    var reservedBinary = '0000';
    var lengthBinary = messageBytes.length.toString(2).padStart(32, '0');
    var sentinelBinary = magicBinary + modeBinary + reservedBinary + lengthBinary;
    var previewParts = [];
    for (var p = 0; p < previewBits; p++) previewParts.push(getBit(messageBytes, p) ? '1' : '0');
    var binaryPreview = sentinelBinary + previewParts.join('');
    if (totalMessageBits > BINARY_PREVIEW_BITS) {
      binaryPreview += ' ... truncated (' + totalMessageBits.toLocaleString() + ' bits total)';
    }
    document.querySelector('.binary .card-body').textContent = binaryPreview;

    messageCanvas.width = width;
    messageCanvas.height = height;

    DOWNLOAD_CACHE.building['encoded'] = true;
    updateDownloadAvailability();

    var original = originalContext.getImageData(0, 0, width, height);
    var buffer = original.data.buffer;
    var worker = startWorker('encode', 'lsb-encode-worker.js');
    worker.onmessage = function(ev) {
      finishWorker('encode', worker);
      if (ev.data.type === 'error') {
        DOWNLOAD_CACHE.building['encoded'] = false;
        updateDownloadAvailability();
        showError(ev.data.message);
        if (encodeButton) encodeButton.disabled = false;
        return;
      }
      var resultImageData = new ImageData(new Uint8ClampedArray(ev.data.data), ev.data.width, ev.data.height);
      messageContext.putImageData(resultImageData, 0, 0);
      setDownloadCache('encoded', ev.data.blob, ev.data.width, ev.data.height);
      try {
        setEncodedPreviewVisibility(true);
        var toggleEncoded = document.getElementById('previewToggleEncoded');
        if (toggleEncoded) toggleEncoded.checked = true;
        setEncodedPreviewMode('encoded');
      } catch (previewError) {
        showError('Error rendering encoded preview: ' + previewError.message);
      }
      nulledCanvas.width = 0;
      nulledCanvas.height = 0;
      document.querySelector('.binary').style.display = 'block';
      if (encodeButton) encodeButton.disabled = false;
    };
    worker.onerror = function(err) {
      finishWorker('encode', worker);
      DOWNLOAD_CACHE.building['encoded'] = false;
      updateDownloadAvailability();
      showError(err.message || 'Worker error');
      if (encodeButton) encodeButton.disabled = false;
    };
    workerPending = true;
    worker.postMessage({
      type: 'encode',
      imageData: { width: width, height: height, data: buffer },
      messageBytes: Array.from(messageBytes),
      lsbBits: lsbBits
    }, [buffer]);
    return;
    
  } catch (error) {
    showError('Error encoding message: ' + error.message);
    console.error('Encoding error:', error);
  } finally {
    if (!workerPending && encodeButton) encodeButton.disabled = false;
  }
}

function decodeMessage() {
  var decodeButton = document.querySelector('button.decode-btn');
  
  // Rate limiting - disable button during processing
  if (decodeButton) {
    decodeButton.disabled = true;
  }
  
  var errorDecode = DOM_CACHE.get('errorDecodeElement');
  if (errorDecode) {
    errorDecode.style.display = 'none';
  }
  
  var decodeWorkerPending = false;
  try {
    var originalCanvas = DOM_CACHE.get('decodeCanvas');
    
    if (!originalCanvas) {
      showError('Please upload an image first.', 'decode');
      return;
    }
    
    var width = originalCanvas.width;
    var height = originalCanvas.height;
    
    if (!validateImageDimensions(width, height)) {
      return;
    }
    
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      showError('Web Workers and OffscreenCanvas are required. Please use a modern browser.');
      return;
    }
    
    var originalContext = originalCanvas.getContext("2d", { willReadFrequently: true });
    var original = originalContext.getImageData(0, 0, width, height);
    var buffer = original.data.buffer;
    
    decodeWorkerPending = true;
    var worker = startWorker('decode', 'lsb-decode-worker.js');
    worker.onmessage = function(ev) {
      finishWorker('decode', worker);
      if (ev.data.type === 'error') {
        showError(ev.data.message, 'decode');
        if (decodeButton) decodeButton.disabled = false;
        return;
      }
      var messageLength = ev.data.messageLength;
      var lsbBits = ev.data.lsbBits;
      var maxCapacity = ev.data.maxCapacity;
      var output = ev.data.output;
      
      var utilizationPercent = Math.round((messageLength / maxCapacity) * 100);
      var availablePercent = 100 - utilizationPercent;
      
      document.getElementById('decode-capacity-used-bar').style.width = utilizationPercent + '%';
      document.getElementById('decode-capacity-used-text').textContent = 'Used: ' + utilizationPercent + '%';
      document.getElementById('decode-capacity-available-bar').style.width = availablePercent + '%';
      document.getElementById('decode-capacity-available-text').textContent = 'Available: ' + availablePercent + '%';
      document.getElementById('decode-capacity-details').textContent = 
        'Decoded ' + messageLength.toLocaleString() + ' bytes of ' + maxCapacity.toLocaleString() + ' total capacity (' + lsbBits + '-LSB mode). ' + 
        (maxCapacity - messageLength).toLocaleString() + ' bytes unused.';
      
      document.querySelector('.decode-capacity-bar').style.display = 'block';
      document.getElementById('decoded-message-text').textContent = output;
      document.querySelector('.binary-decode').style.display = 'block';
      if (decodeButton) decodeButton.disabled = false;
    };
    worker.onerror = function(err) {
      finishWorker('decode', worker);
      showError(err.message || 'Worker error', 'decode');
      if (decodeButton) decodeButton.disabled = false;
    };
    worker.postMessage({
      type: 'decode',
      imageData: { width: width, height: height, data: buffer }
    }, [buffer]);
    return;
    
  } catch (error) {
    showError('Error decoding message: ' + error.message, 'decode');
    console.error('Decoding error:', error);
  } finally {
    if (!decodeWorkerPending && decodeButton) decodeButton.disabled = false;
  }
}
