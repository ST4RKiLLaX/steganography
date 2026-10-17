// Shared sentinel/LSB constants and bit helpers come from constants.js
// (SENTINEL_BITS, SENTINEL_PIXELS, MAGIC_V3, MIN_LSB_BITS, MAX_LSB_BITS,
//  MAX_MESSAGE_LENGTH, MAX_THEORETICAL_EMBED_CAPACITY_BYTES, getBit, getBits).

const MAX_IMAGE_DIMENSION = 10000;         // 10,000 x 10,000 px max
const MAX_FILE_SIZE = 52428800;            // 50MB file size limit
const ALLOWED_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Binary display: truncate to avoid DoS from huge strings
const BINARY_PREVIEW_BITS = 4096;

// v3 Format - Fixed Sentinel + Variable Message
const FORMAT_VERSION = 3;                  // Current format version

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

function clearEncodedCaches() {
  clearDownloadCache('encoded');
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

// Monotonic generation counters guard against stale results after an await.
// Anything that invalidates a pending encode/decode (image upload, tab
// switch, message/password edit, operation start) must bump the counter.
// Every continuation re-checks before touching the UI or cache.
var encodeGeneration = 0;
var decodeGeneration = 0;

// In-flight counters: incremented when encodeMessage/decodeMessage starts,
// decremented on every exit path. The silent-return (gen-mismatch) paths use
// the counter to decide whether to restore the button, so a non-click bump
// (text input, toggle, password edit) doesn't leave the button stuck on
// "Encrypting..." / disabled, while rapid double-clicks still let the newer
// in-flight operation own the UI.
var encodeInFlight = 0;
var decodeInFlight = 0;

function bumpEncodeGeneration() { encodeGeneration++; }
function bumpDecodeGeneration() { decodeGeneration++; }

// Exact decoded text held in memory so the Copy and Download buttons work on
// the original string (no round-trip through textContent, which could
// normalize whitespace or line endings in some edge cases).
var LAST_DECODED_TEXT = '';

function setDecodedActionsEnabled(enabled) {
  var copyBtn = document.getElementById('decoded-copy-btn');
  var dlBtn = document.getElementById('decoded-download-btn');
  if (copyBtn) copyBtn.disabled = !enabled;
  if (dlBtn) dlBtn.disabled = !enabled;
  if (!enabled) resetDecodedCopyLabel();
}

function resetDecodedCopyLabel() {
  var label = document.getElementById('decoded-copy-label');
  var btn = document.getElementById('decoded-copy-btn');
  if (label) label.textContent = 'Copy';
  if (btn) btn.classList.remove('btn-outline-success', 'btn-outline-danger');
}

function clearDecodedDisplay() {
  var text = document.getElementById('decoded-message-text');
  if (text) text.textContent = '';
  var binary = document.querySelector('.binary-decode');
  if (binary) binary.style.display = 'none';
  var cap = document.querySelector('.decode-capacity-bar');
  if (cap) cap.style.display = 'none';
  LAST_DECODED_TEXT = '';
  setDecodedActionsEnabled(false);
}

function clearPasswords() {
  var p1 = document.getElementById('encrypt-password');
  var p2 = document.getElementById('encrypt-password-confirm');
  var p3 = document.getElementById('decrypt-password');
  if (p1) p1.value = '';
  if (p2) p2.value = '';
  if (p3) p3.value = '';
  var fb = document.getElementById('encrypt-password-feedback');
  if (fb) { fb.textContent = ''; fb.className = 'text-muted d-block'; }
}

function isEncryptionEnabled() {
  var toggle = document.getElementById('encrypt-toggle');
  return !!(toggle && toggle.checked && !toggle.disabled);
}

function cryptoAvailable() {
  return typeof StegCrypto !== 'undefined' && StegCrypto.isCryptoAvailable();
}

// Returns true if passwords match and are non-empty. Updates inline
// feedback. Preserves whitespace - "pw" and "pw " are different.
function validateEncryptPasswords(reportError) {
  var p1El = document.getElementById('encrypt-password');
  var p2El = document.getElementById('encrypt-password-confirm');
  var fb = document.getElementById('encrypt-password-feedback');
  var p1 = p1El ? p1El.value : '';
  var p2 = p2El ? p2El.value : '';
  if (p1.length === 0) {
    if (fb) { fb.textContent = 'Enter a password.'; fb.className = 'text-danger d-block'; }
    if (reportError) showError('Please enter an encryption password.');
    return false;
  }
  if (p1 !== p2) {
    if (fb) { fb.textContent = 'Passwords do not match.'; fb.className = 'text-danger d-block'; }
    if (reportError) showError('Passwords do not match.');
    return false;
  }
  if (fb) { fb.textContent = 'Passwords match.'; fb.className = 'text-success d-block'; }
  return true;
}

// Single-flight worker registry: starting a new worker in a given slot
// terminates any in-flight predecessor. Prevents stale results from rapid
// re-clicks (encode/upload churn).
var CURRENT_WORKERS = { encode: null, decode: null };

function startWorker(slot, scriptUrl) {
  var existing = CURRENT_WORKERS[slot];
  if (existing) {
    existing.terminate();
  }
  var worker = new Worker(scriptUrl);
  CURRENT_WORKERS[slot] = worker;
  return worker;
}

function finishWorker(slot, worker) {
  if (CURRENT_WORKERS[slot] === worker) {
    CURRENT_WORKERS[slot] = null;
  }
  worker.terminate();
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
    if (file.size < 24) {
      reject(new Error('File too small to be a valid image.'));
      return;
    }

    // Phase 1: 32-byte sniff. Enough for PNG (24B) and WebP (30B);
    // JPEG triggers a separate 64KB reslice to find the SOF marker.
    file.slice(0, 32).arrayBuffer().then(function(buf) {
      var arr = new Uint8Array(buf);

      if (arr.length >= 24 && arraysEqual(arr, MAGIC_PNG, 8)) {
        var view = new DataView(buf);
        resolve({
          width: view.getUint32(16, false),
          height: view.getUint32(20, false),
          detectedType: 'image/png'
        });
        return;
      }

      if (arr.length >= 12 && arraysEqual(arr, MAGIC_WEBP_RIFF, 4) && arraysEqual(arr.subarray(8), MAGIC_WEBP_WEBP, 4)) {
        parseWebpDimensions(arr, resolve, reject);
        return;
      }

      if (arr[0] === 0xFF && arr[1] === 0xD8 && arr[2] === 0xFF) {
        // Phase 2 (JPEG only): SOF marker can be anywhere in the first
        // ~64KB of metadata. Reslice and scan.
        file.slice(0, JPEG_HEADER_SCAN_BYTES).arrayBuffer().then(function(jbuf) {
          parseJpegDimensions(new Uint8Array(jbuf), resolve, reject);
        }).catch(reject);
        return;
      }

      reject(new Error('Invalid file: not a valid PNG, JPEG, or WebP image.'));
    }).catch(reject);
  });
}

function parseJpegDimensions(arr, resolve, reject) {
  for (var i = 2; i < arr.length - 8; i++) {
    if (arr[i] === 0xFF && JPEG_SOF_MARKERS.indexOf(arr[i + 1]) !== -1) {
      var h = (arr[i + 5] << 8) | arr[i + 6];
      var w = (arr[i + 7] << 8) | arr[i + 8];
      resolve({ width: w, height: h, detectedType: 'image/jpeg' });
      return;
    }
  }
  reject(new Error('Invalid JPEG: no SOF marker found.'));
}

function parseWebpDimensions(arr, resolve, reject) {
  if (arr.length < 30) {
    reject(new Error('Invalid WebP: header truncated.'));
    return;
  }
  var vp8 = arr[12] === 0x56 && arr[13] === 0x50 && arr[14] === 0x38;
  var vp8l = vp8 && arr[15] === 0x4C;
  var vp8x = vp8 && arr[15] === 0x58;
  var w, h;
  if (vp8x) {
    // VP8X: width/height are 24-bit "Minus One" at 24-26 and 27-29.
    w = (arr[24] | (arr[25] << 8) | (arr[26] << 16)) + 1;
    h = (arr[27] | (arr[28] << 8) | (arr[29] << 16)) + 1;
  } else if (vp8l) {
    var val = arr[21] | (arr[22] << 8) | (arr[23] << 16) | ((arr[24] & 0x3F) << 24);
    w = (val & 0x3FFF) + 1;
    h = ((val >> 14) & 0x3FFF) + 1;
  } else if (vp8 && arr[15] === 0x20) {
    // VP8 lossy: 3-byte frame tag (20-22), start code 9D 01 2A (23-25),
    // then 14-bit width/height at 26-27 and 28-29, little-endian.
    w = (arr[26] | (arr[27] << 8)) & 0x3FFF;
    h = (arr[28] | (arr[29] << 8)) & 0x3FFF;
  } else {
    reject(new Error('Invalid WebP: unsupported chunk type.'));
    return;
  }
  resolve({ width: w, height: h, detectedType: 'image/webp' });
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

// sanitizeDecodedMessage and parseSentinelFromPixels live in constants.js so
// workers and the main thread share identical implementations.

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

async function downloadCachedImage(type) {
  if (!isDownloadReady(type)) {
    showError('Download is not ready yet. Please wait for encoding to finish.');
    return;
  }

  var entry = DOWNLOAD_CACHE[type];
  var timestamp = new Date().getTime();
  var filename = 'steganography-' + type + '-' + timestamp + '.png';

  // Preferred path: File System Access API (Chrome/Edge). Writes directly to
  // the user-chosen file, skipping Chrome's download manager (no .crdownload
  // round-trip, no download-shelf scanning delay).
  //
  // Must call showSaveFilePicker synchronously (no awaits before it) so the
  // user activation from the click is preserved.
  if (window.showSaveFilePicker) {
    try {
      var handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'PNG image',
          accept: { 'image/png': ['.png'] }
        }]
      });
      try {
        var writable = await handle.createWritable();
        await writable.write(entry.blob);
        await writable.close();
        return;
      } catch (writeErr) {
        showError('Error saving file: ' + (writeErr && writeErr.message ? writeErr.message : writeErr));
        return;
      }
    } catch (pickerErr) {
      // User cancelled the save dialog - silently abort.
      if (pickerErr && pickerErr.name === 'AbortError') return;
      // Any other picker-time error (e.g. SecurityError in sandboxed
      // contexts): fall through to the anchor download.
    }
  }

  // Fallback: anchor-click download for browsers without the File System
  // Access API (Firefox, Safari) or when the picker is unavailable.
  var link = document.createElement('a');
  link.download = filename;
  link.href = entry.objectUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Make downloadCachedImage globally accessible
window.downloadCanvasImage = downloadCachedImage;

// Copies LAST_DECODED_TEXT to the system clipboard. Prefers the async
// Clipboard API; falls back to a hidden textarea + execCommand('copy') for
// older browsers (older Safari/Firefox over http://).
async function copyDecodedToClipboard() {
  var text = LAST_DECODED_TEXT;
  if (!text) return;
  var btn = document.getElementById('decoded-copy-btn');
  var label = document.getElementById('decoded-copy-label');
  var ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand && document.execCommand('copy'); }
      finally { document.body.removeChild(ta); }
    }
  } catch (err) {
    ok = false;
  }
  if (btn && label) {
    label.textContent = ok ? 'Copied!' : 'Copy failed';
    btn.classList.remove('btn-outline-success', 'btn-outline-danger');
    btn.classList.add(ok ? 'btn-outline-success' : 'btn-outline-danger');
    setTimeout(resetDecodedCopyLabel, 1500);
  }
}

// Saves LAST_DECODED_TEXT as a .txt file. Mirrors downloadCachedImage:
// File System Access API (direct write, no download-manager delay) with an
// anchor-click fallback for Firefox/Safari.
async function downloadDecodedMessage() {
  var text = LAST_DECODED_TEXT;
  if (!text) return;
  var filename = 'decoded-message-' + new Date().getTime() + '.txt';
  var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

  if (window.showSaveFilePicker) {
    try {
      var handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Text file', accept: { 'text/plain': ['.txt'] } }]
      });
      try {
        var writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (writeErr) {
        showError('Error saving file: ' + (writeErr && writeErr.message ? writeErr.message : writeErr), 'decode');
        return;
      }
    } catch (pickerErr) {
      if (pickerErr && pickerErr.name === 'AbortError') return;
      // Fall through to the anchor fallback on any other picker error.
    }
  }

  var url = URL.createObjectURL(blob);
  try {
    var link = document.createElement('a');
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoke on the next tick so the download has started in all browsers.
    setTimeout(function() { URL.revokeObjectURL(url); }, 0);
  }
}

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

  // Tab-switch housekeeping. Switching tabs invalidates any pending async
  // work on the other tab and wipes typed passwords.
  document.querySelectorAll('a[data-bs-toggle="tab"]').forEach(function(tab) {
    tab.addEventListener('shown.bs.tab', function(e) {
      var target = e.target.getAttribute('href');
      if (target === '#decode') {
        clearEncodedCaches();
        bumpEncodeGeneration();
      } else if (target === '#encode') {
        bumpDecodeGeneration();
        clearDecodedDisplay();
      }
      clearPasswords();
    });
  });

  // Message textarea - real-time character counter and auto LSB selection.
  // Also bumps encodeGeneration so a mid-flight encode discards its result.
  var messageTextarea = DOM_CACHE.get('messageTextarea');
  if (messageTextarea) {
    messageTextarea.addEventListener('input', function() {
      clearEncodedCaches();
      bumpEncodeGeneration();
      updateMessageAnalysis(this.value);
    });
  }

  // Encrypt toggle + password handlers.
  var encryptToggle = document.getElementById('encrypt-toggle');
  var encryptPwGroup = document.getElementById('encrypt-password-group');
  var encryptUnavailable = document.getElementById('encrypt-unavailable');
  var encryptPw = document.getElementById('encrypt-password');
  var encryptPwConfirm = document.getElementById('encrypt-password-confirm');

  if (encryptToggle) {
    if (!cryptoAvailable()) {
      encryptToggle.disabled = true;
      encryptToggle.checked = false;
      if (encryptUnavailable) encryptUnavailable.style.display = 'block';
    }
    encryptToggle.addEventListener('change', function() {
      clearEncodedCaches();
      bumpEncodeGeneration();
      if (encryptPwGroup) {
        encryptPwGroup.style.display = this.checked ? 'block' : 'none';
      }
      if (!this.checked) {
        // Hide feedback and clear passwords when turning off.
        if (encryptPw) encryptPw.value = '';
        if (encryptPwConfirm) encryptPwConfirm.value = '';
        var fb = document.getElementById('encrypt-password-feedback');
        if (fb) { fb.textContent = ''; fb.className = 'text-muted d-block'; }
      }
      var text = DOM_CACHE.get('messageTextarea')?.value || '';
      updateMessageAnalysis(text);
    });
  }

  function onEncryptPwInput() {
    clearEncodedCaches();
    bumpEncodeGeneration();
    // Non-blocking feedback (no error popup).
    validateEncryptPasswords(false);
  }
  if (encryptPw) encryptPw.addEventListener('input', onEncryptPwInput);
  if (encryptPwConfirm) encryptPwConfirm.addEventListener('input', onEncryptPwInput);

  var decryptPw = document.getElementById('decrypt-password');
  if (decryptPw) {
    decryptPw.addEventListener('input', function() { bumpDecodeGeneration(); });
  }
  
  var capacityBadge = document.getElementById('capacity-badge');
  var lsbCollapse = document.getElementById('lsbCollapse');
  if (capacityBadge && lsbCollapse) {
    capacityBadge.addEventListener('click', function() {
      bootstrap.Collapse.getOrCreateInstance(lsbCollapse, { toggle: false }).show();
      document.getElementById('lsbCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      bumpEncodeGeneration();
      var text = DOM_CACHE.get('messageTextarea')?.value || '';
      if (text) updateMessageAnalysis(text);
    });
  }

  if (autoBtn) {
    autoBtn.addEventListener('click', function() {
      document.getElementById('manual-mode-override').style.display = 'none';
      document.getElementById('capacity-analysis').style.display = 'block';
      clearEncodedCaches();
      bumpEncodeGeneration();
      var text = DOM_CACHE.get('messageTextarea')?.value || '';
      if (text) updateMessageAnalysis(text);
    });
  }

  if (manualSelect) {
    manualSelect.addEventListener('change', function() {
      clearEncodedCaches();
      bumpEncodeGeneration();
      var text = DOM_CACHE.get('messageTextarea')?.value || '';
      if (text) updateMessageAnalysis(text);
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

  // Decoded-message action buttons (shown in the Decoded Message card header).
  var copyDecodedBtn = document.getElementById('decoded-copy-btn');
  if (copyDecodedBtn) {
    copyDecodedBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      copyDecodedToClipboard();
    });
  }
  var dlDecodedBtn = document.getElementById('decoded-download-btn');
  if (dlDecodedBtn) {
    dlDecodedBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      downloadDecodedMessage();
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

  // New image invalidates any in-flight decode and wipes previous output.
  bumpDecodeGeneration();
  clearDecodedDisplay();
  var decryptPw = document.getElementById('decrypt-password');
  if (decryptPw) decryptPw.value = '';
  var pwGroup = document.getElementById('decrypt-password-group');
  if (pwGroup) pwGroup.style.display = 'none';
  var encBadge = document.getElementById('detected-encrypted-badge');
  if (encBadge) encBadge.style.display = 'none';

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

// Auto LSB Mode Selection Functions. payloadBytes is the on-disk size
// (plaintext length, or plaintext + 45 when encrypting).
function calculateOptimalLSBMode(payloadBytes, imageWidth, imageHeight) {
  var requiredBits = SENTINEL_BITS + (payloadBytes * 8);
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
  var encrypted = isEncryptionEnabled();
  var payloadBytes = encrypted ? byteCount + ENCRYPTION_OVERHEAD_BYTES : byteCount;

  // Update counter badge
  var counterBadge = document.getElementById('message-counter-badge');
  if (counterBadge) {
    var suffix = encrypted
      ? ' + ' + ENCRYPTION_OVERHEAD_BYTES + ' bytes encryption overhead'
      : '';
    counterBadge.textContent = '📝 ' + charCount.toLocaleString() + ' characters (' +
                               byteCount.toLocaleString() + ' bytes' + suffix + ')';
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
    updateManualModeAnalysis(payloadBytes, canvas.width, canvas.height, manualMode, encrypted);
  } else {
    // Calculate optimal mode
    var analysis = calculateOptimalLSBMode(payloadBytes, canvas.width, canvas.height);

    if (!analysis) {
      showCapacityError(payloadBytes, canvas.width, canvas.height, encrypted);
      return;
    }

    updateCapacityAnalysisUI(analysis, payloadBytes, encrypted);
  }
}

function updateCapacityAnalysisUI(analysis, payloadBytes, encrypted) {
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
  var encSuffix = encrypted ? ', encrypted' : '';
  capacityStats.textContent = payloadBytes.toLocaleString() + ' / ' +
                              capacityBytes.toLocaleString() + ' bytes (' +
                              analysis.utilization + '% - ' + analysis.recommendation + encSuffix + ')';

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
    var lockPrefix = encrypted ? '🔒 ' : '💾 ';
    capacityBadge.textContent = lockPrefix + payloadBytes.toLocaleString() + ' / ' +
                                capacityBytes.toLocaleString() + ' bytes (' + analysis.mode + '-LSB)';
    capacityBadge.className = 'badge ' + badgeColor;
    capacityBadge.setAttribute('role', 'button');
    capacityBadge.setAttribute('title', 'Click to learn how this works');
  }
}

function updateManualModeAnalysis(payloadBytes, imageWidth, imageHeight, manualMode, encrypted) {
  var requiredBits = SENTINEL_BITS + (payloadBytes * 8);
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
    showCapacityError(payloadBytes, imageWidth, imageHeight, encrypted);
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
  var encSuffix = encrypted ? ', encrypted' : '';
  capacityStats.textContent = payloadBytes.toLocaleString() + ' / ' +
                              capacityBytes.toLocaleString() + ' bytes (' +
                              utilization.toFixed(1) + '% - ' + recommendation + encSuffix + ')';

  autoModeBadge.textContent = 'Manual: ' + manualMode + '-LSB';
  autoModeBadge.className = 'badge bg-secondary';
  autoModeBadge.setAttribute('data-auto-mode', manualMode);

  // Update capacity badge
  if (capacityBadge) {
    capacityBadge.style.display = 'inline-block';
    var lockPrefix = encrypted ? '🔒 ' : '💾 ';
    capacityBadge.textContent = lockPrefix + payloadBytes.toLocaleString() + ' / ' +
                                capacityBytes.toLocaleString() + ' bytes (' + manualMode + '-LSB)';
    capacityBadge.className = 'badge ' + badgeColor;
    capacityBadge.setAttribute('role', 'button');
    capacityBadge.setAttribute('title', 'Click to learn how this works');
  }
}

function showCapacityError(payloadBytes, imageWidth, imageHeight, encrypted) {
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

  var kind = encrypted ? 'encrypted payload' : 'message';
  capacityStats.textContent = (encrypted ? 'Encrypted ' : '') + 'Message too large! ' +
                              payloadBytes.toLocaleString() + ' ' + kind + ' bytes exceed maximum capacity of ' +
                              maxCapacity.toLocaleString() + ' bytes';
  capacityStats.classList.add('text-danger');

  // Update capacity badge to show error
  if (capacityBadge) {
    capacityBadge.style.display = 'inline-block';
    var lockPrefix = encrypted ? '🔒 ' : '💾 ';
    capacityBadge.textContent = lockPrefix + payloadBytes.toLocaleString() + ' / ' +
                                maxCapacity.toLocaleString() + ' bytes (Too Large!)';
    capacityBadge.className = 'badge bg-danger';
  }
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
    var isEncrypted = parsed.isEncrypted;

    // Update UI (display only - decode does not trust DOM)
    var detector = document.getElementById('decode-mode-detector');
    var modeText = document.getElementById('detected-mode-text');
    var modeIcon = document.getElementById('detected-mode-icon');
    var encBadge = document.getElementById('detected-encrypted-badge');
    var pwGroup = document.getElementById('decrypt-password-group');

    if (detector && modeText && modeIcon) {
      modeText.textContent = detectedMode + '-LSB';
      modeIcon.textContent = isV3 ? (isEncrypted ? '🔒' : '✓') : '⚠️';
      detector.style.display = 'block';

      // Store detected mode and message length for decode
      detector.setAttribute('data-detected-mode', detectedMode);
      detector.setAttribute('data-is-v3', isV3);
      detector.setAttribute('data-is-encrypted', isEncrypted);
      detector.setAttribute('data-message-length', messageLength);

      // Reset manual override to hidden
      var autoDetected = document.getElementById('auto-detected');
      var manualSelect = document.getElementById('manual-mode-select');
      if (autoDetected) autoDetected.style.display = 'block';
      if (manualSelect) manualSelect.style.display = 'none';
    }
    if (encBadge) encBadge.style.display = isV3 && isEncrypted ? 'inline-block' : 'none';
    if (pwGroup) pwGroup.style.display = isV3 && isEncrypted ? 'block' : 'none';
  } catch (error) {
    console.error('Mode detection failed:', error);
  }
}

function previewEncodeImage(file) {
  if (!file) {
    file = document.querySelector("input[name=baseFile]").files[0];
  }

  clearEncodedCaches();
  bumpEncodeGeneration();     // New image invalidates any in-flight encode.
  toggleEncodeDropZonePreview(false);
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
        updateLsbInfoWithImageData(domCanvas.width, domCanvas.height, capacity, lsbBits);
        var messageText = DOM_CACHE.get('messageTextarea')?.value || '';
        if (messageText) updateMessageAnalysis(messageText);
      } catch (error) {
        toggleEncodeDropZonePreview(false);
        showError('Error processing image: ' + error.message);
      }
    });
  });
}

function updateLsbInfoWithImageData(width, height, capacity, lsbBitsPerChannel) {
  lsbBitsPerChannel = lsbBitsPerChannel || 1;  // Default to 1-LSB if not provided
  
  var totalPixels = width * height;
  var availablePixels = totalPixels - SENTINEL_PIXELS;  // Subtract sentinel pixels
  var totalBitsInImage = totalPixels * 3 * 8;  // Total bits (all 8 bits per channel)
  var lsbBitsAvailable = availablePixels * 3 * lsbBitsPerChannel;  // Use selected LSB mode
  
  // Update image info using safe DOM creation
  var lsbImageInfo = document.getElementById('lsbImageInfo');
  lsbImageInfo.textContent = ''; // Clear existing content
  
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
  lsbImageInfo.appendChild(strong);
  lsbImageInfo.appendChild(document.createElement('br'));
  lsbImageInfo.appendChild(createCodeLine('Size: ', width + ' × ' + height, 'pixels'));
  lsbImageInfo.appendChild(createCodeLine('Total pixels: ', totalPixels.toLocaleString(), ''));
  lsbImageInfo.appendChild(createCodeLine('Sentinel overhead: ', '19 pixels (7 bytes)', ''));
  lsbImageInfo.appendChild(createCodeLine('Available pixels: ', availablePixels.toLocaleString(), ''));
  lsbImageInfo.appendChild(createCodeLine('Current mode: ', lsbBitsPerChannel + '-LSB', ''));
  lsbImageInfo.appendChild(createCodeLine('Capacity: ', capacity.toLocaleString(), 'bytes'));
  
  // Add per-mode capacity comparison
  lsbImageInfo.appendChild(document.createElement('br'));
  var strongModes = document.createElement('strong');
  strongModes.textContent = 'Capacity by LSB Mode:';
  lsbImageInfo.appendChild(strongModes);
  lsbImageInfo.appendChild(document.createElement('br'));
  
  for (var mode = 1; mode <= MAX_LSB_BITS; mode++) {
    var modeCapacity = Math.floor((availablePixels * 3 * mode) / 8);
    var indicator = mode === lsbBitsPerChannel ? ' ← Current' : '';
    lsbImageInfo.appendChild(createCodeLine(mode + '-LSB: ', modeCapacity.toLocaleString(), 'bytes' + indicator));
  }
  
  // Update calculation steps using safe DOM creation
  var lsbCalcSteps = document.getElementById('lsbCalcSteps');
  lsbCalcSteps.textContent = ''; // Clear existing content
  
  var strongCalc = document.createElement('strong');
  strongCalc.textContent = 'Step-by-step (v3 format):';
  lsbCalcSteps.appendChild(strongCalc);
  lsbCalcSteps.appendChild(document.createElement('br'));
  lsbCalcSteps.appendChild(createCodeLine('1. ', width.toLocaleString() + ' × ' + height.toLocaleString() + ' = ' + totalPixels.toLocaleString(), 'total pixels'));
  lsbCalcSteps.appendChild(createCodeLine('2. ', totalPixels.toLocaleString() + ' - 19 = ' + availablePixels.toLocaleString(), 'pixels (minus sentinel)'));
  lsbCalcSteps.appendChild(createCodeLine('3. ', availablePixels.toLocaleString() + ' × 3 × ' + lsbBitsPerChannel + ' = ' + lsbBitsAvailable.toLocaleString(), 'LSB bits'));
  lsbCalcSteps.appendChild(createCodeLine('4. ', lsbBitsAvailable.toLocaleString() + ' ÷ 8 = ' + capacity.toLocaleString(), 'bytes capacity'));
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

async function encodeMessage() {
  var encodeButton = document.querySelector('button.encode-btn');
  // Hard-coded original label: capturing textContent at entry would record a
  // stale "Encrypting..." if the user clicks twice in quick succession.
  var ORIGINAL_LABEL = 'Encode';

  var setBusy = function(txt) {
    if (encodeButton) encodeButton.textContent = txt;
  };
  // Guards double-exit: every exit path (success, error, silent-return,
  // top-level catch) is idempotent, so decrementing encodeInFlight twice
  // is impossible.
  var exitHandled = false;
  var _restoreButtonRaw = function() {
    if (encodeButton) {
      encodeButton.disabled = false;
      encodeButton.textContent = ORIGINAL_LABEL;
    }
  };
  // Normal exit: decrement in-flight and always restore the button.
  var restoreButton = function() {
    if (exitHandled) return;
    exitHandled = true;
    encodeInFlight--;
    _restoreButtonRaw();
  };
  // Silent-return (gen-mismatch) exit: decrement in-flight and only restore
  // the button if we were the last operation holding it busy. A newer
  // encodeMessage in flight owns the UI and will restore it later.
  var exitStale = function() {
    if (exitHandled) return;
    exitHandled = true;
    encodeInFlight--;
    if (encodeInFlight === 0) _restoreButtonRaw();
  };

  if (encodeButton) {
    encodeButton.disabled = true;
  }
  encodeInFlight++;

  // Start a new generation. Anything we await below must verify this is
  // still the current operation before touching the UI or cache.
  var myGen = ++encodeGeneration;

  clearEncodedCaches();

  var errorElement = DOM_CACHE.get('errorElement');
  if (errorElement) errorElement.style.display = 'none';
  document.querySelector('.binary').style.display = 'none';

  var workerPending = false;
  try {
    var text = DOM_CACHE.get('messageTextarea')?.value || '';
    if (!text || text.length === 0) {
      showError('Please enter a message to encode.');
      restoreButton();
      return;
    }

    var messageBytes = TEXT_ENCODER.encode(text);
    if (!validateMessageLength(messageBytes.length)) {
      restoreButton();
      return;
    }

    var encrypted = isEncryptionEnabled();
    if (encrypted) {
      if (!cryptoAvailable()) {
        showError('Encryption requires a secure context (HTTPS or localhost).');
        restoreButton();
        return;
      }
      // Encrypted payload also must fit within MAX_MESSAGE_LENGTH, so the
      // decoder's own limit never rejects it. Overhead is 45 bytes.
      if (messageBytes.length > MAX_MESSAGE_LENGTH - ENCRYPTION_OVERHEAD_BYTES) {
        showError('Message too long for encryption. Maximum plaintext size: ' +
                  (MAX_MESSAGE_LENGTH - ENCRYPTION_OVERHEAD_BYTES).toLocaleString() + ' bytes.');
        restoreButton();
        return;
      }
      if (!validateEncryptPasswords(true)) {
        restoreButton();
        return;
      }
    }

    var originalCanvas = DOM_CACHE.get('originalCanvas');
    var nulledCanvas = DOM_CACHE.get('nulledCanvas');
    var messageCanvas = DOM_CACHE.get('messageCanvas');

    if (!originalCanvas || !nulledCanvas || !messageCanvas || originalCanvas.width === 0) {
      showError('Please upload an image first.');
      restoreButton();
      return;
    }

    var width = originalCanvas.width;
    var height = originalCanvas.height;
    if (!validateImageDimensions(width, height)) {
      restoreButton();
      return;
    }

    // Resolve LSB mode from auto-selection or manual override.
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

    // On-disk payload length (what gets hidden). Encrypted payload is
    // plaintext + 45; the sentinel's length field holds this value.
    var payloadLength = encrypted
      ? messageBytes.length + ENCRYPTION_OVERHEAD_BYTES
      : messageBytes.length;
    var availablePixels = (width * height) - SENTINEL_PIXELS;
    var maxCapacity = Math.floor((availablePixels * lsbBits * 3) / 8);

    if (!validateCapacity(maxCapacity)) {
      restoreButton();
      return;
    }
    if (payloadLength > maxCapacity) {
      var kind = encrypted ? 'encrypted payload' : 'message';
      showError('Message too long! Your ' + kind + ' is ' + payloadLength.toLocaleString() +
                ' bytes but this image can only hide ' + maxCapacity.toLocaleString() +
                ' bytes with ' + lsbBits + '-LSB mode. Please use a larger image or shorter message.');
      restoreButton();
      return;
    }

    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      showError('Web Workers and OffscreenCanvas are required. Please use a modern browser.');
      restoreButton();
      return;
    }

    // Snapshot pixels and canvas contexts synchronously, before any await,
    // so a mid-operation image swap can't poison the result.
    var originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
    var messageContext = messageCanvas.getContext('2d', { willReadFrequently: true });
    messageCanvas.width = width;
    messageCanvas.height = height;
    var original = originalContext.getImageData(0, 0, width, height);
    var buffer = original.data.buffer;

    var flags = encrypted ? FLAGS_ENCRYPTED : FLAGS_PLAINTEXT;
    var payloadBytes;

    if (encrypted) {
      setBusy('Encrypting...');
      var sentinelAad = buildSentinelBytes(lsbBits, flags, payloadLength);
      var password = document.getElementById('encrypt-password').value;
      try {
        payloadBytes = await StegCrypto.encryptPayload(messageBytes, password, sentinelAad);
      } catch (err) {
        if (encodeGeneration !== myGen) { exitStale(); return; }
        showError(err.message || 'Encryption failed.');
        restoreButton();
        return;
      }
      if (encodeGeneration !== myGen) { exitStale(); return; }
      setBusy('Encoding...');
    } else {
      payloadBytes = messageBytes;
    }

    // Binary preview reflects the on-disk payload bits.
    var totalPayloadBits = payloadBytes.length * 8;
    var previewBits = Math.min(BINARY_PREVIEW_BITS, totalPayloadBits);
    var sentinelBinary = MAGIC_V3 +
      lsbBits.toString(2).padStart(4, '0') +
      flags +
      payloadBytes.length.toString(2).padStart(32, '0');
    var previewParts = [];
    for (var p = 0; p < previewBits; p++) previewParts.push(getBit(payloadBytes, p) ? '1' : '0');
    var binaryPreview = sentinelBinary + previewParts.join('');
    if (totalPayloadBits > BINARY_PREVIEW_BITS) {
      binaryPreview += ' ... truncated (' + totalPayloadBits.toLocaleString() + ' bits total)';
    }

    DOWNLOAD_CACHE.building['encoded'] = true;
    updateDownloadAvailability();

    var worker = startWorker('encode', 'lsb-encode-worker.js?v=2');
    worker.onmessage = function(ev) {
      finishWorker('encode', worker);
      if (encodeGeneration !== myGen) {
        DOWNLOAD_CACHE.building['encoded'] = false;
        updateDownloadAvailability();
        exitStale();
        return;
      }
      if (ev.data.type === 'error') {
        DOWNLOAD_CACHE.building['encoded'] = false;
        updateDownloadAvailability();
        showError(ev.data.message);
        restoreButton();
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
      document.querySelector('.binary .card-body').textContent = binaryPreview;
      document.querySelector('.binary').style.display = 'block';
      restoreButton();
    };
    worker.onerror = function(err) {
      finishWorker('encode', worker);
      if (encodeGeneration !== myGen) { exitStale(); return; }
      DOWNLOAD_CACHE.building['encoded'] = false;
      updateDownloadAvailability();
      showError(err.message || 'Worker error');
      restoreButton();
    };
    workerPending = true;
    worker.postMessage({
      type: 'encode',
      imageData: { width: width, height: height, data: buffer },
      messageBytes: Array.from(payloadBytes),
      lsbBits: lsbBits,
      flags: flags
    }, [buffer]);
    return;

  } catch (error) {
    showError('Error encoding message: ' + error.message);
    console.error('Encoding error:', error);
    // Idempotent: safe to call even if worker.onmessage/onerror already fired.
    restoreButton();
  }
}

var DECODE_TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

function decodeMessage() {
  var decodeButton = document.querySelector('button.decode-btn');
  // Hard-coded label (see encodeMessage for why we don't capture textContent).
  var ORIGINAL_LABEL = 'Decode';
  var setBusy = function(txt) { if (decodeButton) decodeButton.textContent = txt; };
  var exitHandled = false;
  var _restoreButtonRaw = function() {
    if (decodeButton) {
      decodeButton.disabled = false;
      decodeButton.textContent = ORIGINAL_LABEL;
    }
  };
  var restoreButton = function() {
    if (exitHandled) return;
    exitHandled = true;
    decodeInFlight--;
    _restoreButtonRaw();
  };
  var exitStale = function() {
    if (exitHandled) return;
    exitHandled = true;
    decodeInFlight--;
    if (decodeInFlight === 0) _restoreButtonRaw();
  };

  if (decodeButton) decodeButton.disabled = true;
  decodeInFlight++;

  // Start a new generation; invalidates any in-flight predecessor.
  var myGen = ++decodeGeneration;

  var errorDecode = DOM_CACHE.get('errorDecodeElement');
  if (errorDecode) errorDecode.style.display = 'none';

  var decodeWorkerPending = false;
  try {
    var originalCanvas = DOM_CACHE.get('decodeCanvas');
    if (!originalCanvas) {
      showError('Please upload an image first.', 'decode');
      restoreButton();
      return;
    }

    var width = originalCanvas.width;
    var height = originalCanvas.height;
    if (!validateImageDimensions(width, height)) {
      restoreButton();
      return;
    }
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      showError('Web Workers and OffscreenCanvas are required. Please use a modern browser.');
      restoreButton();
      return;
    }

    var originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
    var original = originalContext.getImageData(0, 0, width, height);
    var buffer = original.data.buffer;

    decodeWorkerPending = true;
    var worker = startWorker('decode', 'lsb-decode-worker.js?v=2');
    worker.onmessage = function(ev) {
      finishWorker('decode', worker);
      if (decodeGeneration !== myGen) { exitStale(); return; }
      if (ev.data.type === 'error') {
        showError(ev.data.message, 'decode');
        restoreButton();
        return;
      }

      var messageLength = ev.data.messageLength;
      var lsbBits = ev.data.lsbBits;
      var maxCapacity = ev.data.maxCapacity;
      var flags = ev.data.flags;

      if (ev.data.encrypted) {
        if (!cryptoAvailable()) {
          showError('This image is encrypted but the Web Crypto API is unavailable. Load the page over HTTPS or localhost.', 'decode');
          restoreButton();
          return;
        }
        var pwEl = document.getElementById('decrypt-password');
        var password = pwEl ? pwEl.value : '';
        if (password.length === 0) {
          showError('This image is encrypted. Please enter the password.', 'decode');
          restoreButton();
          return;
        }
        setBusy('Decrypting...');
        var payloadBytes = new Uint8Array(ev.data.payloadBytes);
        var sentinelAad = buildSentinelBytes(lsbBits, flags, messageLength);
        StegCrypto.decryptPayload(payloadBytes, password, sentinelAad).then(function(plaintext) {
          if (decodeGeneration !== myGen) { exitStale(); return; }
          var text;
          try {
            text = sanitizeDecodedMessage(DECODE_TEXT_DECODER.decode(plaintext));
          } catch (utf8Err) {
            showError('Decrypted bytes are not valid UTF-8. The image may be corrupted.', 'decode');
            restoreButton();
            return;
          }
          renderDecodeOutput(text, plaintext.length, messageLength, lsbBits, maxCapacity, true);
          restoreButton();
        }).catch(function(err) {
          if (decodeGeneration !== myGen) { exitStale(); return; }
          showError(err.message || 'Wrong password or corrupted image.', 'decode');
          restoreButton();
        });
        return;
      }

      // Plaintext path: worker already decoded + sanitized output.
      renderDecodeOutput(ev.data.output, messageLength, messageLength, lsbBits, maxCapacity, false);
      restoreButton();
    };
    worker.onerror = function(err) {
      finishWorker('decode', worker);
      if (decodeGeneration !== myGen) { exitStale(); return; }
      showError(err.message || 'Worker error', 'decode');
      restoreButton();
    };
    worker.postMessage({
      type: 'decode',
      imageData: { width: width, height: height, data: buffer }
    }, [buffer]);
    return;

  } catch (error) {
    showError('Error decoding message: ' + error.message, 'decode');
    console.error('Decoding error:', error);
    // Idempotent: safe even if a worker/decrypt callback already restored.
    restoreButton();
  }
}

function renderDecodeOutput(text, plaintextLength, storedLength, lsbBits, maxCapacity, encrypted) {
  var utilizationPercent = Math.round((storedLength / maxCapacity) * 100);
  var availablePercent = 100 - utilizationPercent;

  document.getElementById('decode-capacity-used-bar').style.width = utilizationPercent + '%';
  document.getElementById('decode-capacity-used-text').textContent = 'Used: ' + utilizationPercent + '%';
  document.getElementById('decode-capacity-available-bar').style.width = availablePercent + '%';
  document.getElementById('decode-capacity-available-text').textContent = 'Available: ' + availablePercent + '%';

  var detail = 'Decoded ' + storedLength.toLocaleString() + ' bytes of ' +
               maxCapacity.toLocaleString() + ' total capacity (' + lsbBits + '-LSB mode). ' +
               (maxCapacity - storedLength).toLocaleString() + ' bytes unused.';
  if (encrypted) {
    detail += ' Encrypted payload: ' + storedLength.toLocaleString() + ' bytes on disk, ' +
              plaintextLength.toLocaleString() + ' bytes plaintext (45 bytes overhead).';
  }
  document.getElementById('decode-capacity-details').textContent = detail;

  document.querySelector('.decode-capacity-bar').style.display = 'block';
  document.getElementById('decoded-message-text').textContent = text;
  document.querySelector('.binary-decode').style.display = 'block';

  // Hold the exact decoded string for the Copy / Download buttons and enable
  // them. Any stale "Copied!" label from a previous decode is reset.
  LAST_DECODED_TEXT = text;
  resetDecodedCopyLabel();
  setDecodedActionsEnabled(true);
}
