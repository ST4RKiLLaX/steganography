// Security Configuration
const MAX_MESSAGE_LENGTH = 10000000;      // 10MB byte limit (UTF-8 encoded)
const MAX_IMAGE_DIMENSION = 10000;         // 10,000 x 10,000 px max
const MAX_CAPACITY = 100000000;            // 100MB absolute max
const MAX_FILE_SIZE = 52428800;            // 50MB file size limit
const ALLOWED_FILE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const LENGTH_HEADER_BITS = 32;             // 32-bit header for message length

// Validation Functions
function validateFileType(file) {
  if (!file) {
    showError('No file selected. Please choose an image file.');
    return false;
  }
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    showError('Invalid file type. Please select a PNG, JPEG, GIF, or WebP image.');
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
    errorElement = document.querySelector(".error-decode");
  } else {
    errorElement = document.querySelector(".error");
  }
  
  if (errorElement) {
    errorElement.textContent = '⚠️ ' + message;
    errorElement.style.display = 'block';
  }
  // Errors persist until next operation (no auto-hide)
  // Users can manually scroll past or will be cleared on next encode/decode
}

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
});

function previewDecodeImage() {
  var file = document.querySelector('input[name=decodeFile]').files[0];
  
  if (!validateFileType(file)) {
    return;
  }

  previewImage(file, ".decode canvas", function() {
    document.querySelector(".decode").style.display = 'block';
  });
}

function previewEncodeImage() {
  var file = document.querySelector("input[name=baseFile]").files[0];
  
  if (!validateFileType(file)) {
    return;
  }

  document.querySelector(".images .nulled").style.display = 'none';
  document.querySelector(".images .message").style.display = 'none';
  document.querySelector(".capacity-bar").style.display = 'none';
  document.querySelector(".error").style.display = 'none';

  previewImage(file, ".original canvas", function() {
    try {
      var canvas = document.querySelector('.original canvas');
      
      // Validate dimensions
      if (!validateImageDimensions(canvas.width, canvas.height)) {
        return;
      }
      
      // Calculate and validate capacity (subtract header overhead)
      var totalBits = canvas.width * canvas.height * 3;
      var availableBits = totalBits - LENGTH_HEADER_BITS;
      var capacity = Math.floor(availableBits / 8);
      
      if (!validateCapacity(capacity)) {
        return;
      }
      
      document.querySelector(".images .original").style.display = 'block';
      document.querySelector(".images").style.display = 'block';
      document.getElementById('encode-capacity-value').textContent = capacity.toLocaleString();
      document.getElementById('encode-capacity').style.display = 'block';
      
      // Update modal with current image data
      updateModalWithImageData(canvas.width, canvas.height, capacity);
    } catch (error) {
      showError('Error processing image: ' + error.message);
    }
  });
}

function updateModalWithImageData(width, height, capacity) {
  var totalPixels = width * height;
  var totalBitsInImage = totalPixels * 3 * 8;  // Total bits (all 8 bits per channel)
  var lsbBits = totalPixels * 3;  // LSB bits (1 bit per channel)
  
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
  modalImageInfo.appendChild(createCodeLine('Total bits: ', totalBitsInImage.toLocaleString(), '(all image data)'));
  modalImageInfo.appendChild(createCodeLine('LSB bits: ', lsbBits.toLocaleString(), '(available for hiding)'));
  modalImageInfo.appendChild(createCodeLine('Capacity: ', capacity.toLocaleString(), 'bytes'));
  
  // Update calculation steps using safe DOM creation
  var modalCalcSteps = document.getElementById('modalCalcSteps');
  modalCalcSteps.textContent = ''; // Clear existing content
  
  var strongCalc = document.createElement('strong');
  strongCalc.textContent = 'Step-by-step:';
  modalCalcSteps.appendChild(strongCalc);
  modalCalcSteps.appendChild(document.createElement('br'));
  modalCalcSteps.appendChild(createCodeLine('1. ', width.toLocaleString() + ' × ' + height.toLocaleString() + ' = ' + totalPixels.toLocaleString(), 'pixels'));
  modalCalcSteps.appendChild(createCodeLine('2. ', totalPixels.toLocaleString() + ' × 3 = ' + lsbBits.toLocaleString(), 'LSB bits (3 channels)'));
  modalCalcSteps.appendChild(createCodeLine('3. ', lsbBits.toLocaleString() + ' ÷ 8 = ' + capacity.toLocaleString(), 'bytes'));
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
  
  document.querySelector(".error").style.display = 'none';
  document.querySelector(".binary").style.display = 'none';
  document.querySelector(".capacity-bar").style.display = 'none';

  try {
    var text = document.querySelector("textarea.message").value;
    
    // Validate message is not empty
    if (!text || text.length === 0) {
      showError('Please enter a message to encode.');
      return;
    }
    
    // Encode to UTF-8 and validate byte length
    var encoder = new TextEncoder();
    var messageBytes = encoder.encode(text);
    if (!validateMessageLength(messageBytes.length)) {
      return;
    }

    var originalCanvas = document.querySelector('.original canvas');
    var nulledCanvas = document.querySelector('.nulled canvas');
    var messageCanvas = document.querySelector('.message canvas');

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
    
    // Calculate capacity (accounting for 32-bit header)
    var totalBits = width * height * 3;
    var availableBits = totalBits - LENGTH_HEADER_BITS;
    var maxCapacity = Math.floor(availableBits / 8);
    
    if (!validateCapacity(maxCapacity)) {
      return;
    }

    // Check if the image is big enough to hide the message
    var requiredBits = LENGTH_HEADER_BITS + (messageBytes.length * 8);
    if (requiredBits > totalBits) {
      showError('Message too long! Your message is ' + messageBytes.length.toLocaleString() + 
                ' bytes but this image can only hide ' + maxCapacity.toLocaleString() + 
                ' bytes. Please use a larger image or shorter message.');
      return;
    }

    nulledCanvas.width = width;
    nulledCanvas.height = height;

    messageCanvas.width = width;
    messageCanvas.height = height;

    // Normalize the original image and draw it
    var original = originalContext.getImageData(0, 0, width, height);
    var pixel = original.data;
    for (var i = 0, n = pixel.length; i < n; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        if(pixel[i + offset] % 2 != 0) {
          pixel[i + offset]--;
        }
      }
    }
    nulledContext.putImageData(original, 0, 0);

    // Create 32-bit header with byte length
    var lengthBinary = messageBytes.length.toString(2);
    while(lengthBinary.length < LENGTH_HEADER_BITS) {
      lengthBinary = "0" + lengthBinary;
    }

    // Convert the UTF-8 bytes to a binary string using array for better performance
    var messageBinaryArray = [];
    for (var i = 0; i < messageBytes.length; i++) {
      var binaryByte = messageBytes[i].toString(2);

      // Pad with 0 until the binaryByte has a length of 8 (1 Byte)
      while(binaryByte.length < 8) {
        binaryByte = "0" + binaryByte;
      }

      messageBinaryArray.push(binaryByte);
    }
    var messageBinary = messageBinaryArray.join('');
    
    // Prepend length header to message
    var binaryMessage = lengthBinary + messageBinary;
    
    document.querySelector('.binary textarea').textContent = binaryMessage;

  // Apply the binary string to the image and draw it
  var message = nulledContext.getImageData(0, 0, width, height);
  pixel = message.data;
  var counter = 0;
  for (var i = 0, n = pixel.length; i < n; i += 4) {
    for (var offset = 0; offset < 3; offset++) {
      if (counter < binaryMessage.length) {
        pixel[i + offset] += parseInt(binaryMessage[counter]);
        counter++;
      }
      else {
        break;
      }
    }
  }
    messageContext.putImageData(message, 0, 0);

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
    capacityDetails.textContent = 'Hidden ' + messageBytes.length.toLocaleString() + ' bytes of ' + maxCapacity.toLocaleString() + ' available. ' + (maxCapacity - messageBytes.length).toLocaleString() + ' bytes remaining.';
    
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
  
  var errorDecode = document.querySelector(".error-decode");
  if (errorDecode) {
    errorDecode.style.display = 'none';
  }
  
  try {
    var originalCanvas = document.querySelector('.decode canvas');
    
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
    
    // Calculate maximum capacity
    var totalBits = width * height * 3;
    var maxCapacity = Math.floor((totalBits - LENGTH_HEADER_BITS) / 8);
    
    if (!validateCapacity(maxCapacity)) {
      return;
    }
    
    // Extract all LSBs
    var binaryData = "";
    var pixel = original.data;
    for (var i = 0, n = pixel.length; i < n; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        var value = 0;
        if(pixel[i + offset] % 2 != 0) {
          value = 1;
        }
        binaryData += value;
      }
    }
    
    // Check if we have enough data for header
    if (binaryData.length < LENGTH_HEADER_BITS) {
      showError('Image too small or does not contain a hidden message.', 'decode');
      return;
    }
    
    // Read 32-bit length header
    var lengthBinary = binaryData.substring(0, LENGTH_HEADER_BITS);
    var messageLength = parseInt(lengthBinary, 2);
    
    // Validate message length from header
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
    
    if (messageLength > maxCapacity) {
      showError('Corrupted image: Declared message length (' + messageLength.toLocaleString() + 
                ') exceeds image capacity (' + maxCapacity.toLocaleString() + ').', 'decode');
      return;
    }
    
    // Extract message binary (skip header)
    var messageBinary = binaryData.substring(LENGTH_HEADER_BITS, LENGTH_HEADER_BITS + (messageLength * 8));
    
    // Check if we have enough data
    if (messageBinary.length < messageLength * 8) {
      showError('Incomplete message data in image.', 'decode');
      return;
    }
    
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
    var decoder = new TextDecoder();
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
      'Decoded ' + messageLength.toLocaleString() + ' bytes of ' + maxCapacity.toLocaleString() + ' total capacity. ' + 
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
