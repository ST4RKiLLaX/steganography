var SENTINEL_BITS = 56;
var SENTINEL_PIXELS = 19;
var MAGIC_V3 = '1010101001010101';
var MIN_LSB_BITS = 1;
var MAX_LSB_BITS = 4;
var MAX_MESSAGE_LENGTH = 10000000;
var MAX_THEORETICAL_EMBED_CAPACITY_BYTES = 150000000;

var TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

function sanitizeDecodedMessage(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
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

self.onmessage = function(e) {
  if (e.data.type !== 'decode') return;
  var width = e.data.imageData.width;
  var height = e.data.imageData.height;
  var pixel = new Uint8ClampedArray(e.data.imageData.data);

  try {
    var parsed = parseSentinelFromPixels(pixel);
    var lsbBits = parsed.lsbBits;
    var messageLength = parsed.messageLength;
    var isV3 = parsed.isV3;

    if (!isV3) {
      self.postMessage({ type: 'error', message: 'This image does not contain a valid v3 steganographic message. Please ensure the image was encoded with this tool.' });
      return;
    }
    if (!Number.isSafeInteger(messageLength) || messageLength < 0 || messageLength > MAX_MESSAGE_LENGTH) {
      self.postMessage({ type: 'error', message: 'Invalid or corrupted steganographic image.' });
      return;
    }
    if (messageLength === 0) {
      self.postMessage({ type: 'error', message: 'Image contains an empty message (0 bytes).' });
      return;
    }
    if (!Number.isInteger(lsbBits) || lsbBits < MIN_LSB_BITS || lsbBits > MAX_LSB_BITS) {
      self.postMessage({ type: 'error', message: 'Invalid or corrupted steganographic image.' });
      return;
    }

    var availablePixels = (width * height) - SENTINEL_PIXELS;
    var maxCapacity = Math.floor((availablePixels * lsbBits * 3) / 8);

    if (!Number.isSafeInteger(maxCapacity) || maxCapacity > MAX_THEORETICAL_EMBED_CAPACITY_BYTES) {
      self.postMessage({ type: 'error', message: 'Image capacity exceeds safety limits.' });
      return;
    }
    if (messageLength > maxCapacity) {
      self.postMessage({ type: 'error', message: 'Corrupted image: Declared message length exceeds image capacity.' });
      return;
    }

    var byteArray = new Uint8Array(messageLength);
    var mask = (1 << lsbBits) - 1;
    var totalBits = messageLength * 8;
    var bitBuf = 0;
    var bitCount = 0;
    var byteIdx = 0;
    var producedBits = 0;

    outer: for (var i = SENTINEL_PIXELS * 4; i < pixel.length; i += 4) {
      for (var offset = 0; offset < 3; offset++) {
        var chunk = pixel[i + offset] & mask;
        var take = lsbBits;
        var remaining = totalBits - producedBits;
        if (remaining < lsbBits) {
          // Partial tail chunk: encoder left-shifted message bits into the
          // high positions of the slot, so drop the low (lsbBits - remaining)
          // garbage bits.
          take = remaining;
          chunk = chunk >>> (lsbBits - take);
        }
        bitBuf = (bitBuf << take) | chunk;
        bitCount += take;
        producedBits += take;
        while (bitCount >= 8) {
          bitCount -= 8;
          byteArray[byteIdx++] = (bitBuf >>> bitCount) & 0xFF;
          if (byteIdx === messageLength) break outer;
        }
        if (producedBits >= totalBits) break outer;
      }
    }

    if (byteIdx < messageLength) {
      self.postMessage({ type: 'error', message: 'Incomplete message data in image.' });
      return;
    }

    var output = sanitizeDecodedMessage(TEXT_DECODER.decode(byteArray));

    self.postMessage({
      type: 'result',
      output: output,
      messageLength: messageLength,
      lsbBits: lsbBits,
      maxCapacity: maxCapacity
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || 'Decode failed' });
  }
};
