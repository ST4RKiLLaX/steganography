// Shared constants and helpers. Loaded both by index.html (regular <script>)
// and by workers via importScripts('constants.js'). No DOM or app-specific
// state - safe to import from crypto.js and from tests.

// v3 sentinel layout:
//   bits 0-15  magic (0xAA55)
//   bits 16-19 LSB mode (1-4)
//   bits 20-23 flags (0000 plaintext, 1000 encrypted; others reserved)
//   bits 24-55 payload length (bytes, big-endian)
var SENTINEL_BITS = 56;
var SENTINEL_PIXELS = 19;                // ceil(56 / 3) pixels needed
var SENTINEL_BYTES = 7;                  // 56 bits packed MSB-first

var MAGIC_V3 = '1010101001010101';       // 0xAA55 as bitstring
var MAGIC_BYTES = [0xAA, 0x55];

var MIN_LSB_BITS = 1;
var MAX_LSB_BITS = 4;

var FLAGS_PLAINTEXT = '0000';
var FLAGS_ENCRYPTED = '1000';            // bit 20 = "encrypted"

var MAX_MESSAGE_LENGTH = 10000000;       // 10MB plaintext byte limit (UTF-8)
var MAX_THEORETICAL_EMBED_CAPACITY_BYTES = 150000000;  // ~150MB safety cap

// Encryption payload layout (v1):
//   version (1) | salt (16) | iv (12) | ciphertext + GCM tag (n + 16)
var ENCRYPTION_PAYLOAD_VERSION = 1;
var PBKDF2_ITERATIONS = 600000;          // OWASP 2023 recommendation
var SALT_BYTES = 16;
var IV_BYTES = 12;
var GCM_TAG_BYTES = 16;
var ENCRYPTION_HEADER_BYTES = 1 + SALT_BYTES + IV_BYTES;    // 29
var ENCRYPTION_OVERHEAD_BYTES = ENCRYPTION_HEADER_BYTES + GCM_TAG_BYTES;  // 45
var ENCRYPTION_MIN_PAYLOAD_BYTES = ENCRYPTION_OVERHEAD_BYTES + 1;         // 46

function isValidFlags(flags) {
  return flags === FLAGS_PLAINTEXT || flags === FLAGS_ENCRYPTED;
}

function getBit(bytes, bitIndex) {
  return (bytes[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
}

function getBits(bytes, bitIndex, n) {
  var result = 0;
  for (var i = 0; i < n; i++) result = (result << 1) | getBit(bytes, bitIndex + i);
  return result;
}

// Reads the 56 1-LSB sentinel bits from the first 19 pixels of RGBA pixel
// data. Returns the parsed fields plus a flagsValid guard - callers must
// reject sentinels where isV3 is true but flagsValid is false.
function parseSentinelFromPixels(pixel) {
  var bitsArr = [];
  for (var i = 0; i < SENTINEL_PIXELS * 4 && bitsArr.length < SENTINEL_BITS; i += 4) {
    for (var offset = 0; offset < 3; offset++) {
      bitsArr.push((pixel[i + offset] & 1).toString());
      if (bitsArr.length >= SENTINEL_BITS) break;
    }
  }
  var bits = bitsArr.join('');
  var magic = bits.substring(0, 16);
  var isV3 = magic === MAGIC_V3;
  var lsbBits = isV3 ? parseInt(bits.substring(16, 20), 2) : 1;
  var flags = isV3 ? bits.substring(20, 24) : FLAGS_PLAINTEXT;
  var messageLength = isV3 ? parseInt(bits.substring(24, 56), 2) : 0;
  return {
    isV3: isV3,
    lsbBits: lsbBits,
    flags: flags,
    flagsValid: isV3 && isValidFlags(flags),
    isEncrypted: flags === FLAGS_ENCRYPTED,
    messageLength: messageLength
  };
}

// Produces the canonical 7-byte sentinel for GCM additional data. Encode
// and decode both call this with the same inputs so the AAD matches.
function buildSentinelBytes(lsbBits, flags, messageLength) {
  if (!Number.isInteger(lsbBits) || lsbBits < MIN_LSB_BITS || lsbBits > MAX_LSB_BITS) {
    throw new Error('buildSentinelBytes: invalid lsbBits');
  }
  if (!isValidFlags(flags)) {
    throw new Error('buildSentinelBytes: invalid flags');
  }
  if (!Number.isSafeInteger(messageLength) || messageLength < 0 || messageLength > 0xFFFFFFFF) {
    throw new Error('buildSentinelBytes: invalid messageLength');
  }
  var flagsInt = parseInt(flags, 2);
  var bytes = new Uint8Array(SENTINEL_BYTES);
  bytes[0] = MAGIC_BYTES[0];
  bytes[1] = MAGIC_BYTES[1];
  bytes[2] = ((lsbBits & 0x0F) << 4) | (flagsInt & 0x0F);
  bytes[3] = (messageLength >>> 24) & 0xFF;
  bytes[4] = (messageLength >>> 16) & 0xFF;
  bytes[5] = (messageLength >>> 8) & 0xFF;
  bytes[6] = messageLength & 0xFF;
  return bytes;
}

// Strips Unicode bidi override characters that could visually spoof text.
// Shared because the main thread needs it after decrypting.
function sanitizeDecodedMessage(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
}
