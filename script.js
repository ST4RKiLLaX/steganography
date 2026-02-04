// Security Configuration
const MAX_MESSAGE_LENGTH = 10000000;      // 10MB byte limit (UTF-8 encoded)
const MAX_IMAGE_DIMENSION = 10000;         // 10,000 x 10,000 px max
const MAX_CAPACITY = 100000000;            // 100MB absolute max
const MAX_FILE_SIZE = 52428800;            // 50MB file size limit
const ALLOWED_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// v3 Format - Fixed Sentinel + Variable Message
const FORMAT_VERSION = 3;                  // Current format version
const SENTINEL_BITS = 56;                  // Fixed 1-LSB sentinel (magic + mode + reserved + length)
const SENTINEL_PIXELS = 19;                // ceil(56 / 3) pixels needed for sentinel
const MAGIC_V3 = '1010101001010101';       // 0xAA55 (16-bit magic number)
const MIN_LSB_BITS = 1;                    // Minimum LSB mode
const MAX_LSB_BITS = 4;                    // Maximum LSB mode

// Performance: Reusable encoder/decoder (stateless)
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

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

// Download cache (precomputed PNG blobs)
const DOWNLOAD_CACHE = {
  original: null,
  normalized: null,
  encoded: null,
  building: {
    original: false,
    normalized: false,
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
  
  if (comparisonModal && comparisonModal.downloadLeft && comparisonModal.downloadRight) {
    var leftType = comparisonModal.currentComparison?.left;
    var rightType = comparisonModal.currentComparison?.right;
    comparisonModal.downloadLeft.disabled = !isDownloadReady(leftType);
    comparisonModal.downloadRight.disabled = !isDownloadReady(rightType);
  }
}

function clearDownloadCache(type) {
  if (DOWNLOAD_CACHE[type] && DOWNLOAD_CACHE[type].objectUrl) {
    URL.revokeObjectURL(DOWNLOAD_CACHE[type].objectUrl);
  }
  DOWNLOAD_CACHE[type] = null;
  DOWNLOAD_CACHE.building[type] = false;
}

function clearAllDownloadCache() {
  ['original', 'normalized', 'encoded'].forEach(type => clearDownloadCache(type));
  updateDownloadAvailability();
}

function clearEncodedCaches() {
  ['normalized', 'encoded'].forEach(type => clearDownloadCache(type));
  updateDownloadAvailability();
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

function buildDownloadCache(type, canvas) {
  if (!canvas) {
    clearDownloadCache(type);
    showError('Download image is not available yet. Please try again after encoding.');
    updateDownloadAvailability();
    return;
  }
  
  DOWNLOAD_CACHE.building[type] = true;
  updateDownloadAvailability();
  
  canvas.toBlob(function(blob) {
    if (!blob) {
      clearDownloadCache(type);
      showError('Failed to prepare downloadable image. Please try again.');
      updateDownloadAvailability();
      return;
    }
    setDownloadCache(type, blob, canvas.width, canvas.height);
  }, 'image/png');
}

// Validation Functions
function validateFileType(file) {
  if (!file) {
    showError('No file selected. Please choose an image file.');
    return false;
  }
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    showError('Invalid file type. Please select a PNG, JPEG, or WebP image.');
    return false;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError('File too large! Maximum file size: ' + (MAX_FILE_SIZE / 1048576).toFixed(0) + 'MB. Your file: ' + (file.size / 1048576).toFixed(1) + 'MB.');
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

function validateCapacity(capacity) {
  if (!Number.isSafeInteger(capacity)) {
    showError('Image capacity calculation error.');
    return false;
  }
  if (capacity > MAX_CAPACITY) {
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

// Image Comparison Modal
var comparisonModal = {
  modal: null,
  bsModal: null,
  comparisonType: null,
  leftCanvas: null,
  rightCanvas: null,
  slider: null,
  handle: null,
  container: null,
  labelLeft: null,
  labelRight: null,
  downloadLeft: null,
  downloadRight: null,
  downloadLeftName: null,
  downloadRightName: null,
  isDragging: false,
  rafId: null,
  currentComparison: {left: null, right: null},
  
  canvasSources: {
    'original': function() { return DOM_CACHE.get('originalCanvas'); },
    'normalized': function() { return DOM_CACHE.get('nulledCanvas'); },
    'encoded': function() { return DOM_CACHE.get('messageCanvas'); }
  },
  
  comparisonLabels: {
    'original': 'Original',
    'normalized': 'Normalized',
    'encoded': 'Encoded'
  }
};

function initComparisonModal() {
  // Get DOM references
  comparisonModal.modal = document.getElementById('comparisonModal');
  comparisonModal.comparisonType = document.getElementById('comparison-type');
  comparisonModal.leftCanvas = document.getElementById('comparison-left');
  comparisonModal.rightCanvas = document.getElementById('comparison-right');
  comparisonModal.slider = document.getElementById('comparisonSlider');
  comparisonModal.handle = document.getElementById('sliderHandle');
  comparisonModal.container = document.getElementById('comparisonContainer');
  comparisonModal.labelLeft = document.getElementById('labelLeft');
  comparisonModal.labelRight = document.getElementById('labelRight');
  comparisonModal.downloadLeft = document.getElementById('downloadLeft');
  comparisonModal.downloadRight = document.getElementById('downloadRight');
  comparisonModal.downloadLeftName = document.getElementById('downloadLeftName');
  comparisonModal.downloadRightName = document.getElementById('downloadRightName');
  
  // Clone canvas to modal canvas
  function cloneCanvas(source, target) {
    if (!source || !target) return;
    target.width = source.width;
    target.height = source.height;
    var ctx = target.getContext('2d', { desynchronized: true });
    ctx.drawImage(source, 0, 0);
    
    // Calculate display size to fit within viewport while maintaining aspect ratio
    var aspectRatio = source.height / source.width;
    var maxWidth = window.innerWidth * 0.9;
    var maxHeight = window.innerHeight * 0.8;
    
    var displayWidth = Math.min(source.width, maxWidth);
    var displayHeight = displayWidth * aspectRatio;
    
    // If height exceeds max, scale down based on height instead
    if (displayHeight > maxHeight) {
      displayHeight = maxHeight;
      displayWidth = displayHeight / aspectRatio;
    }
    
    // Set container to exact display size so slider matches image edges
    comparisonModal.container.style.width = Math.round(displayWidth) + 'px';
    comparisonModal.container.style.height = Math.round(displayHeight) + 'px';
  }
  
  // Open comparison modal
  function openComparison(leftType, rightType) {
    var leftSource = comparisonModal.canvasSources[leftType]();
    var rightSource = comparisonModal.canvasSources[rightType]();
    
    if (!leftSource || !rightSource) return;
    
    comparisonModal.currentComparison = {left: leftType, right: rightType};
    
    // Clone canvases
    cloneCanvas(leftSource, comparisonModal.leftCanvas);
    cloneCanvas(rightSource, comparisonModal.rightCanvas);
    
    // Update UI
    var comparisonValue = leftType + '-' + rightType;
    comparisonModal.comparisonType.value = comparisonValue;
    comparisonModal.labelLeft.textContent = comparisonModal.comparisonLabels[leftType];
    comparisonModal.labelRight.textContent = comparisonModal.comparisonLabels[rightType];
    comparisonModal.downloadLeftName.textContent = comparisonModal.comparisonLabels[leftType];
    comparisonModal.downloadRightName.textContent = comparisonModal.comparisonLabels[rightType];
    updateDownloadAvailability();
    
    // Reset slider to 50%
    updateSliderPosition(50);
    
    // Show modal (create instance if needed)
    if (!comparisonModal.bsModal) {
      comparisonModal.bsModal = new bootstrap.Modal(comparisonModal.modal);
    }
    comparisonModal.bsModal.show();
  }
  
  // Make openComparison globally accessible for card click handlers
  window.openComparison = openComparison;
  
  // Update slider position
  function updateSliderPosition(percentage) {
    percentage = Math.max(0, Math.min(100, percentage));
    comparisonModal.slider.style.left = percentage + '%';
    comparisonModal.rightCanvas.style.clipPath = 'inset(0 0 0 ' + percentage + '%)';
    comparisonModal.handle.setAttribute('aria-valuenow', Math.round(percentage));
  }
  
  // Slider drag handlers
  function startDrag(e) {
    comparisonModal.isDragging = true;
    e.preventDefault();
  }
  
  function drag(e) {
    if (!comparisonModal.isDragging) return;
    
    // Throttle with requestAnimationFrame (60fps max)
    if (comparisonModal.rafId) return;
    
    comparisonModal.rafId = requestAnimationFrame(() => {
      var rect = comparisonModal.container.getBoundingClientRect();
      var clientX;
      
      if (e.type.includes('touch')) {
        clientX = e.touches[0].clientX;
      } else {
        clientX = e.clientX;
      }
      
      var x = clientX - rect.left;
      var percentage = (x / rect.width) * 100;
      updateSliderPosition(percentage);
      
      comparisonModal.rafId = null;
    });
  }
  
  function stopDrag() {
    comparisonModal.isDragging = false;
    if (comparisonModal.rafId) {
      cancelAnimationFrame(comparisonModal.rafId);
      comparisonModal.rafId = null;
    }
  }
  
  // Mouse events
  comparisonModal.handle.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', stopDrag);
  
  // Touch events
  comparisonModal.handle.addEventListener('touchstart', startDrag, {passive: false});
  document.addEventListener('touchmove', drag, {passive: false});
  document.addEventListener('touchend', stopDrag);
  
  // Click to jump
  comparisonModal.container.addEventListener('click', function(e) {
    if (e.target === comparisonModal.handle || e.target.parentElement === comparisonModal.handle) return;
    var rect = comparisonModal.container.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var percentage = (x / rect.width) * 100;
    updateSliderPosition(percentage);
  });
  
  // Keyboard navigation
  comparisonModal.handle.addEventListener('keydown', function(e) {
    var current = parseFloat(comparisonModal.slider.style.left) || 50;
    var newValue = current;
    
    switch(e.key) {
      case 'ArrowLeft':
        newValue = current - 5;
        e.preventDefault();
        break;
      case 'ArrowRight':
        newValue = current + 5;
        e.preventDefault();
        break;
      case 'Home':
        newValue = 0;
        e.preventDefault();
        break;
      case 'End':
        newValue = 100;
        e.preventDefault();
        break;
    }
    
    updateSliderPosition(newValue);
  });
  
  // Comparison type change
  comparisonModal.comparisonType.addEventListener('change', function() {
    var parts = this.value.split('-');
    openComparison(parts[0], parts[1]);
  });
  
  // Download functions
  function downloadCachedImage(type) {
    if (!isDownloadReady(type)) {
      showError('Download is not ready yet. Please wait for encoding to finish.');
      return;
    }
    
    var entry = DOWNLOAD_CACHE[type];
    var link = document.createElement('a');
    var timestamp = new Date().getTime();
    link.download = 'steganography-' + type + '-' + timestamp + '.png';
    link.href = entry.objectUrl;
    link.click();
  }
  
  // Make downloadCachedImage globally accessible
  window.downloadCanvasImage = downloadCachedImage;
  
  comparisonModal.downloadLeft.addEventListener('click', function() {
    downloadCachedImage(comparisonModal.currentComparison.left);
  });
  
  comparisonModal.downloadRight.addEventListener('click', function() {
    downloadCachedImage(comparisonModal.currentComparison.right);
  });
}

// Initialize comparison modal when script loads
initComparisonModal();

// Event listeners setup
document.addEventListener('DOMContentLoaded', function() {
  // File input listeners
  var encodeFileInput = document.querySelector('input[name=baseFile]');
  if (encodeFileInput) {
    encodeFileInput.addEventListener('change', previewEncodeImage);
  }
  
  var decodeFileInput = document.querySelector('input[name=decodeFile]');
  if (decodeFileInput) {
    decodeFileInput.addEventListener('change', previewDecodeImage);
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
  function setupDragAndDrop(dropZone, fileInput) {
    if (!dropZone || !fileInput) return;
    
    // Prevent browser default behavior
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    
    // Visual feedback - add active state
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.add('drag-active');
      });
    });
    
    // Visual feedback - remove active state
    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove('drag-active');
      });
    });
    
    // Handle file drop
    dropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      
      // Validate we have files
      if (files && files.length > 0) {
        // Set to file input
        fileInput.files = files;
        
        // Trigger existing change event
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    
    // Make drop zone clickable
    dropZone.addEventListener('click', () => {
      fileInput.click();
    });
  }
  
  // Initialize both drop zones
  const encodeDropZone = document.getElementById('encodeDropZone');
  const decodeDropZone = document.getElementById('decodeDropZone');
  
  if (encodeDropZone && encodeFileInput) {
    setupDragAndDrop(encodeDropZone, encodeFileInput);
  }
  
  if (decodeDropZone && decodeFileInput) {
    setupDragAndDrop(decodeDropZone, decodeFileInput);
  }
  
  // Image Comparison Modal - Card click handlers
  var originalCard = document.querySelector('.original .card');
  var nulledCard = document.querySelector('.nulled .card');
  var messageCard = document.querySelector('.message .card');
  var downloadEncodedBtn = document.getElementById('downloadEncoded');
  
  if (originalCard) {
    originalCard.addEventListener('click', function() {
      if (comparisonModal.canvasSources['encoded']()) {
        window.openComparison('original', 'encoded');
      }
    });
  }
  
  if (nulledCard) {
    nulledCard.addEventListener('click', function() {
      if (comparisonModal.canvasSources['normalized']()) {
        window.openComparison('original', 'normalized');
      }
    });
  }
  
  if (messageCard) {
    messageCard.addEventListener('click', function(e) {
      // Don't open modal if download button was clicked
      if (e.target.closest('#downloadEncoded')) {
        return;
      }
      if (comparisonModal.canvasSources['encoded']()) {
        window.openComparison('normalized', 'encoded');
      }
    });
  }
  
  // Download encoded image button
  if (downloadEncodedBtn) {
    downloadEncodedBtn.addEventListener('click', function(e) {
      e.stopPropagation(); // Prevent card click
      window.downloadCanvasImage('encoded');
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

function previewDecodeImage() {
  var file = document.querySelector('input[name=decodeFile]').files[0];
  
  if (!validateFileType(file)) {
    return;
  }

  previewImage(file, ".decode canvas", function() {
    document.querySelector(".decode").style.display = 'block';
    
    // Detect LSB mode from uploaded image
    detectLsbMode();
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
    var manualMode = parseInt(document.getElementById('manual-lsb-mode').value);
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

function detectLsbMode() {
  try {
    var canvas = DOM_CACHE.get('decodeCanvas');
    if (!canvas) return;
    
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var pixel = imageData.data;
    
    // Always read sentinel in 1-LSB mode (first 19 pixels = 57 bits, we need 56)
    var sentinelBitsArray = [];
    for (var i = 0; i < SENTINEL_PIXELS * 4 && sentinelBitsArray.length < SENTINEL_BITS; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        sentinelBitsArray.push((pixel[i + offset] & 1).toString());
        if (sentinelBitsArray.length >= SENTINEL_BITS) break;
      }
    }
    var sentinelBits = sentinelBitsArray.join('');
    
    // Parse sentinel structure
    var magic = sentinelBits.substring(0, 16);
    var detectedMode = 1;
    var messageLength = 0;
    var isV3 = false;
    
    if (magic === MAGIC_V3) {
      // v3 format detected!
      detectedMode = parseInt(sentinelBits.substring(16, 20), 2);
      // Reserved bits 20-23 (skip)
      messageLength = parseInt(sentinelBits.substring(24, 56), 2);
      isV3 = true;
    }
    
    // Update UI
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

function previewEncodeImage() {
  var file = document.querySelector("input[name=baseFile]").files[0];
  
  clearAllDownloadCache();
  
  if (!validateFileType(file)) {
    return;
  }

  document.querySelector(".images .nulled").style.display = 'none';
  document.querySelector(".images .message").style.display = 'none';
  document.querySelector(".capacity-bar").style.display = 'none';
  var errorElement = DOM_CACHE.get('errorElement');
  if (errorElement) errorElement.style.display = 'none';

  previewImage(file, ".original canvas", function() {
    try {
      var canvas = DOM_CACHE.get('originalCanvas');
      
      // Validate dimensions
      if (!validateImageDimensions(canvas.width, canvas.height)) {
        return;
      }
      
      buildDownloadCache('original', canvas);
      
      // Default to 1-LSB for initial display
      var lsbBits = 1;
      
      // Calculate capacity based on v3 format
      var availablePixels = (canvas.width * canvas.height) - SENTINEL_PIXELS;
      var totalBits = availablePixels * lsbBits * 3;
      var capacity = Math.floor(totalBits / 8);
      
      if (!validateCapacity(capacity)) {
        return;
      }
      
      document.querySelector(".images .original").style.display = 'block';
      document.querySelector(".images").style.display = 'block';
      
      // Show capacity badge
      var capacityBadge = document.getElementById('capacity-badge');
      if (capacityBadge) {
        capacityBadge.style.display = 'inline-block';
        capacityBadge.textContent = '💾 0 / ' + capacity.toLocaleString() + ' bytes (' + lsbBits + '-LSB)';
      }
      
      // Update modal with current image data
      updateModalWithImageData(canvas.width, canvas.height, capacity, lsbBits);
      
      // Trigger message analysis if there's text in the textarea
      var messageText = DOM_CACHE.get('messageTextarea')?.value || '';
      if (messageText) {
        updateMessageAnalysis(messageText);
      }
    } catch (error) {
      showError('Error processing image: ' + error.message);
    }
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

function previewImage(file, canvasSelector, callback) {
  var image = new Image();
  var canvas = document.querySelector(canvasSelector);
  var context = canvas.getContext('2d');

  if (file) {
    image.src = URL.createObjectURL(file);

    image.onload = function() {
      canvas.width = image.width;
      canvas.height = image.height;

      context.drawImage(image, 0, 0);

      // Clean up object URL to prevent memory leak
      URL.revokeObjectURL(image.src);

      callback();
    }
  }
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
  document.querySelector(".capacity-bar").style.display = 'none';

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
      lsbBits = parseInt(document.getElementById('manual-lsb-mode').value);
    } else {
      var autoModeBadge = document.getElementById('auto-mode-badge');
      if (autoModeBadge) {
        lsbBits = parseInt(autoModeBadge.getAttribute('data-auto-mode') || 1);
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
    var totalAvailableBits = (width * height) * 3;  // Total bits in image
    if (requiredBits > (availablePixels * lsbBits * 3 + SENTINEL_BITS)) {
      showError('Message too long! Your message is ' + messageBytes.length.toLocaleString() + 
                ' bytes but this image can only hide ' + maxCapacity.toLocaleString() + 
                ' bytes with ' + lsbBits + '-LSB mode. Please use a larger image or shorter message.');
      return;
    }

    nulledCanvas.width = width;
    nulledCanvas.height = height;

    messageCanvas.width = width;
    messageCanvas.height = height;

    // Normalize the original image: clear 1-LSB for sentinel, N-LSB for message
    var original = originalContext.getImageData(0, 0, width, height);
    var pixel = original.data;
    
    // Clear 1-LSB for sentinel pixels (first 19 pixels)
    for (var i = 0; i < SENTINEL_PIXELS * 4; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        pixel[i + offset] = (pixel[i + offset] & 0xFE) & 0xFF;  // Clear 1 LSB
      }
    }
    
    // Clear N-LSB for message pixels (remaining pixels)
    var mask = ~((1 << lsbBits) - 1) & 0xFF;
    for (var i = SENTINEL_PIXELS * 4; i < pixel.length; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        pixel[i + offset] = (pixel[i + offset] & mask) & 0xFF;
      }
    }
    nulledContext.putImageData(original, 0, 0);

    // Create 56-bit v3 sentinel: magic(16) + mode(4) + reserved(4) + length(32)
    var magicBinary = MAGIC_V3;  // 16 bits: 1010101001010101 (0xAA55)
    var modeBinary = lsbBits.toString(2).padStart(4, '0');  // 4 bits: 0001-0100
    var reservedBinary = '0000';  // 4 bits: reserved for future use
    var lengthBinary = messageBytes.length.toString(2).padStart(32, '0');  // 32 bits
    var sentinelBinary = magicBinary + modeBinary + reservedBinary + lengthBinary;

    // Convert the UTF-8 bytes to a binary string
    var messageBinaryArray = [];
    for (var i = 0; i < messageBytes.length; i++) {
      var binaryByte = messageBytes[i].toString(2).padStart(8, '0');
      messageBinaryArray.push(binaryByte);
    }
    var messageBinary = messageBinaryArray.join('');
    
    var binaryMessage = sentinelBinary + messageBinary;
    document.querySelector('.binary .card-body').textContent = binaryMessage;

    // Apply the binary string to the image
    var message = nulledContext.getImageData(0, 0, width, height);
    pixel = message.data;
    var sentinelCounter = 0;
    var messageCounter = 0;
    
    // Step 1: Embed sentinel using 1-LSB (first 19 pixels = 57 bits, we use 56)
    for (var i = 0; i < SENTINEL_PIXELS * 4 && sentinelCounter < SENTINEL_BITS; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        if (sentinelCounter < SENTINEL_BITS) {
          var bit = parseInt(sentinelBinary[sentinelCounter], 2);
          pixel[i + offset] = (pixel[i + offset] | bit) & 0xFF;
          sentinelCounter++;
        }
      }
    }
    
    // Step 2: Embed message data using N-LSB mode (starting from pixel 20)
    for (var i = SENTINEL_PIXELS * 4; i < pixel.length; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        if (messageCounter + lsbBits <= messageBinary.length) {
          // Extract N bits from message binary
          var bits = parseInt(messageBinary.substring(messageCounter, messageCounter + lsbBits), 2);
          pixel[i + offset] = (pixel[i + offset] | bits) & 0xFF;
          messageCounter += lsbBits;
        } else if (messageCounter < messageBinary.length) {
          // Handle remaining bits if message doesn't align perfectly
          var remaining = messageBinary.substring(messageCounter);
          var bits = parseInt(remaining.padEnd(lsbBits, '0'), 2);
          pixel[i + offset] = (pixel[i + offset] | bits) & 0xFF;
          messageCounter = messageBinary.length;
          break;
        } else {
          break;
        }
      }
      if (messageCounter >= messageBinary.length) break;
    }
    messageContext.putImageData(message, 0, 0);
    
    buildDownloadCache('normalized', nulledCanvas);
    buildDownloadCache('encoded', messageCanvas);

    // Display capacity utilization
    var utilizationPercent = Math.round((messageBytes.length / maxCapacity) * 100);
    var progressBar = document.getElementById('capacity-progress');
    var capacityText = document.getElementById('capacity-text');
    var capacityDetails = document.getElementById('capacity-details');
    
    // Set progress bar color based on utilization
    progressBar.className = 'progress-bar';
    if (utilizationPercent < 30) {
      progressBar.classList.add('bg-success');
    } else if (utilizationPercent < 70) {
      progressBar.classList.add('bg-warning');
    } else {
      progressBar.classList.add('bg-danger');
    }
    
    progressBar.style.width = utilizationPercent + '%';
    progressBar.setAttribute('aria-valuenow', utilizationPercent);
    capacityText.textContent = utilizationPercent + '%';
    capacityDetails.textContent = 'Hidden ' + messageBytes.length.toLocaleString() + ' bytes of ' + maxCapacity.toLocaleString() + ' available (' + lsbBits + '-LSB mode). ' + (maxCapacity - messageBytes.length).toLocaleString() + ' bytes remaining.';
    
    document.querySelector(".capacity-bar").style.display = 'block';
    document.querySelector(".binary").style.display = 'block';
    document.querySelector(".images .nulled").style.display = 'block';
    document.querySelector(".images .message").style.display = 'block';
    
  } catch (error) {
    showError('Error encoding message: ' + error.message);
    console.error('Encoding error:', error);
  } finally {
    // Re-enable button
    if (encodeButton) {
      encodeButton.disabled = false;
    }
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
  
  try {
    var originalCanvas = DOM_CACHE.get('decodeCanvas');
    
    if (!originalCanvas) {
      showError('Please upload an image first.', 'decode');
      return;
    }
    
    var width = originalCanvas.width;
    var height = originalCanvas.height;
    
    // Validate dimensions
    if (!validateImageDimensions(width, height)) {
      return;
    }
    
    var originalContext = originalCanvas.getContext("2d", { willReadFrequently: true });
    var original = originalContext.getImageData(0, 0, width, height);
    var pixel = original.data;
    
    // Get detected mode and message length from detector
    var detector = document.getElementById('decode-mode-detector');
    var lsbBits = 1;
    var messageLength = 0;
    var isV3 = false;
    
    if (detector) {
      lsbBits = parseInt(detector.getAttribute('data-detected-mode') || 1);
      messageLength = parseInt(detector.getAttribute('data-message-length') || 0);
      isV3 = detector.getAttribute('data-is-v3') === 'true';
    }
    
    if (!isV3) {
      showError('This image does not contain a valid v3 steganographic message. Please ensure the image was encoded with this tool.', 'decode');
      return;
    }
    
    // Validate message length from sentinel
    if (!Number.isSafeInteger(messageLength) || messageLength < 0) {
      showError('Invalid or corrupted steganographic image.', 'decode');
      return;
    }
    
    // Handle zero-length message
    if (messageLength === 0) {
      showError('Image contains an empty message (0 bytes).', 'decode');
      return;
    }
    
    if (!validateMessageLength(messageLength)) {
      return;
    }
    
    // Calculate maximum capacity based on LSB mode
    var availablePixels = (width * height) - SENTINEL_PIXELS;
    var maxCapacity = Math.floor((availablePixels * lsbBits * 3) / 8);
    
    if (!validateCapacity(maxCapacity)) {
      return;
    }
    
    if (messageLength > maxCapacity) {
      showError('Corrupted image: Declared message length (' + messageLength.toLocaleString() + 
                ') exceeds image capacity (' + maxCapacity.toLocaleString() + ').', 'decode');
      return;
    }
    
    // Extract message data using N-LSB mode (starting from pixel 20)
    var messageBinaryArray = [];
    var mask = (1 << lsbBits) - 1;  // Create mask for N bits
    var requiredBits = messageLength * 8;
    
    for (var i = SENTINEL_PIXELS * 4; i < pixel.length && messageBinaryArray.length * lsbBits < requiredBits; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        if (messageBinaryArray.length * lsbBits >= requiredBits) break;
        var extracted = pixel[i + offset] & mask;
        var binary = extracted.toString(2).padStart(lsbBits, '0');
        messageBinaryArray.push(binary);
      }
    }
    var messageBinary = messageBinaryArray.join('');
    
    // Check if we have enough data
    if (messageBinary.length < requiredBits) {
      showError('Incomplete message data in image.', 'decode');
      return;
    }
    
    // Trim to exact message length
    messageBinary = messageBinary.substring(0, requiredBits);
    
    // Convert binary to UTF-8 byte array
    var byteArray = new Uint8Array(messageLength);
    for (var i = 0; i < messageLength; i++) {
      var byte = 0;
      for (var j = 0; j < 8; j++) {
        byte <<= 1;
        byte |= parseInt(messageBinary[i * 8 + j]);
      }
      byteArray[i] = byte;
    }
    
    // Decode UTF-8 bytes to text
    const decoder = TEXT_DECODER;
    var output = decoder.decode(byteArray);
    
    // Calculate capacity utilization
    var utilizationPercent = Math.round((messageLength / maxCapacity) * 100);
    var availablePercent = 100 - utilizationPercent;
    
    // Update capacity visualization (stacked bar)
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
    
  } catch (error) {
    showError('Error decoding message: ' + error.message, 'decode');
    console.error('Decoding error:', error);
  } finally {
    // Re-enable button
    if (decodeButton) {
      decodeButton.disabled = false;
    }
  }
}
