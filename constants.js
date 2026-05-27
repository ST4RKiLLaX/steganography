// Shared constants and bit-extraction helpers. Loaded both by index.html
// (regular <script>) and by workers via importScripts('constants.js').

var SENTINEL_BITS = 56;                  // Fixed 1-LSB sentinel (magic + mode + reserved + length)
var SENTINEL_PIXELS = 19;                // ceil(56 / 3) pixels needed for sentinel
var MAGIC_V3 = '1010101001010101';       // 0xAA55 (16-bit magic number)
var MIN_LSB_BITS = 1;                    // Minimum LSB mode
var MAX_LSB_BITS = 4;                    // Maximum LSB mode
var MAX_MESSAGE_LENGTH = 10000000;       // 10MB byte limit (UTF-8 encoded)
var MAX_THEORETICAL_EMBED_CAPACITY_BYTES = 150000000;  // ~150MB safety cap

function getBit(bytes, bitIndex) {
  return (bytes[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
}

function getBits(bytes, bitIndex, n) {
  var result = 0;
  for (var i = 0; i < n; i++) result = (result << 1) | getBit(bytes, bitIndex + i);
  return result;
}
