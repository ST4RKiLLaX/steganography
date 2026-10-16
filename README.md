# Steganography Online - Enhanced Edition

An enhanced fork of the original [Steganography Online](http://stylesuxx.github.io/steganography/) by stylesuxx, with modern security features, UTF-8 support, and an interactive comparison UI.

## Live Demo

Visit the enhanced version: [ST4RKiLLaX/steganography](https://st4rkillax.github.io/steganography/)

Original project: [stylesuxx/steganography](https://github.com/stylesuxx/steganography)

It provides functionality to **encode** a message in an image and to **decode** the message from the image.

## About Steganography

Steganography is the art of hiding a message inside another message. In this case we will hide a text message inside an image.
An image will most propably go unnotified, not a bunch of people will suspect a message hidden inside an image.
Steganography is **no means of encryption**, just a way of hiding data inside an image.

If you want to learn about Steganography in detail head over to [the Wikipedia article](http://en.wikipedia.org/wiki/Steganography).

## Implementation Details

### v3 Format - Fixed Sentinel Architecture

This application uses a **two-layer encoding system** for reliable detection and optimal capacity:

**Layer 1: Fixed Sentinel (Always 1-LSB)**
- First 19 pixels store metadata in stealth 1-LSB mode
- Magic number: `0xAA55` (16 bits) for format detection
- LSB mode: 4 bits (1-4) used for message
- Reserved: 4 bits for future extensions
- Message length: 32 bits (supports up to 4GB)
- Total overhead: 56 bits (7 bytes)

**Layer 2: Variable Message (Auto-Selected N-LSB)**
- Remaining pixels use optimal LSB mode (1-4)
- **Smart auto-selection**: Automatically picks minimum LSB mode needed
- Manual override: Users can force specific mode if desired

### LSB Mode Comparison

| Mode  | Capacity | Visual Impact | Overhead | Use Case |
|-------|----------|---------------|----------|----------|
| 1-LSB | Baseline | Invisible (±1) | 7 bytes | Maximum stealth |
| 2-LSB | 2× more  | Barely visible (±3) | 7 bytes | Balanced |
| 3-LSB | 3× more  | Slight noise (±7) | 7 bytes | Large messages |
| 4-LSB | 4× more  | Visible (±15) | 7 bytes | Maximum capacity |

### How It Works

1. **Auto-Selection**: System calculates minimum LSB mode needed for your message
2. **Normalization**: Image cleared - 1-LSB for sentinel pixels, N-LSB for message pixels
3. **Sentinel Encoding**: First 19 pixels encode metadata using 1-LSB (100% reliable detection)
4. **Message Encoding**: Remaining pixels encode message using auto-selected N-LSB mode
5. **Capacity Formula**:
   ```
   Available Pixels = (Width × Height) - 19
   Capacity = (Available Pixels × N × 3) ÷ 8 bytes
   ```
6. **Detection**: Always reads first 19 pixels in 1-LSB mode, validates `0xAA55` magic number
7. **Decoding**: Extracts message using detected LSB mode from sentinel
8. **Real-Time Feedback**: Live character counter, capacity analysis, and utilization progress bar

## Additional layers of security

As mentioned before, steganography is no means of encryption, just a way to hide data from plain sight. But one could, for example,
hide a pgp encrypted message inside an image. So even if the image did not go unnoticed, the message would still only 
be readable by the person it was addressed to.

---

## Credits

This project is an enhanced fork of the original [Steganography Online](http://stylesuxx.github.io/steganography/) by [stylesuxx](https://github.com/stylesuxx) (2014).

### Enhancements in This Version

**Security & Validation:**
- Comprehensive input validation (file type, size, dimensions)
- UTF-8 character encoding support (replaces charCodeAt limitation)
- XSS protection with safe DOM manipulation
- v3 format: 56-bit fixed sentinel (0xAA55 magic + mode + reserved + length)
- Two-layer architecture: 1-LSB sentinel + N-LSB message
- Optional AES-256-GCM confidentiality mode (password-based, PBKDF2-SHA256 600k iterations); sentinel is included in the GCM additional data so flipping the LSB mode, flag bits, or length makes decryption fail
- Memory leak prevention and rate limiting
- Removed GIF support (incompatible with LSB algorithm)

**User Interface:**
- **Smart auto LSB mode selection** with real-time capacity analysis
- **Dynamic badge system**: Live character counter + capacity feedback (stacked)
- **Automatic mode detection** on decode with manual override option
- Color-coded progress bar (green → yellow → orange → red)
- Dark/light mode toggle with localStorage persistence
- Modern Bootstrap 5.3 card-based layout
- **Inline Preview Architecture**: Upload previews appear directly in drop zones
- **Encoded Preview Section**: Dedicated result area with inline Original/Encoded toggle
- **Direct download buttons**: No more right-click instructions
- **Drag-and-drop file upload support**: Integrated into preview areas
- Responsive mobile-optimized design
- In-page educational cards explaining steganography and LSB encoding (v3 two-layer architecture)

**Performance:**
- TextEncoder/TextDecoder for proper Unicode handling
- Optimized binary string construction
- Canvas context optimization (willReadFrequently)
- **Worker Offload**: LSB encode/decode and PNG encoding run in Web Workers (keeps main thread responsive on large images)
- **OffscreenCanvas**: PNG conversion via `convertToBlob` in Workers (Chrome/Firefox friendly)
- **Memory Optimization**: Immediate release of intermediate buffers; blob URLs revoked when cache is invalidated (new encode, tab switch)
- **Download Optimization**: Pre-computed blob caching for instant save prompts; append link to DOM before click (Chrome-compatible)
- **Direct Save (Chrome/Edge)**: File System Access API (`showSaveFilePicker`) writes the PNG straight to the user-chosen file, bypassing the browser's download manager and its `.crdownload`/scanning delays; falls back to anchor download in Firefox/Safari

**Accessibility:**
- Keyboard navigation support
- ARIA labels for screen readers
- High contrast mode compatible

### Tech Stack
- Pure vanilla JavaScript (no jQuery)
- Bootstrap 5.3.8
- HTML5 Canvas API
- Web Workers + OffscreenCanvas for encode/decode
- Web Crypto API (PBKDF2-SHA256 + AES-256-GCM) for the optional confidentiality mode
- CSS Variables for theming
- No external dependencies for core functionality

### Browser Requirements
- Web Workers and OffscreenCanvas required (modern browsers; Safari 16.4+)
- Encryption requires a secure context (HTTPS or `localhost`) for the Web Crypto API

### Confidentiality mode

The optional **Encrypt with password** switch runs the message through AES-256-GCM
before it is hidden in the image. The key is derived from the password with
PBKDF2-SHA256 (600,000 iterations), both from the browser's built-in Web Crypto
API, so no third-party crypto library is required.

The encrypted payload layout (version 1, 45 bytes of overhead) is:

```
byte 0        version (0x01)
bytes 1-16    salt (16 random bytes)
bytes 17-28   IV (12 random bytes)
bytes 29..    ciphertext + GCM authentication tag (plaintext + 16 bytes)
```

The GCM additional data is 8 bytes: `[version, ...canonical 7-byte sentinel]`.
The sentinel encodes the LSB mode, a 4-bit flags field (`1000` for encrypted),
and the 32-bit payload length, so flipping any of these in the image makes
decryption fail with a generic "Wrong password or corrupted image" error.

**What this gives you**
- Hides *what the message says* and detects tampering of the ciphertext,
  sentinel, salt, IV, or version.
- Separates cleanly from the LSB layer, so encryption can be audited in
  isolation (`crypto.js` has no DOM or steganography dependencies).

**What it does not give you**
- Steganographic concealment: the `0xAA55` magic number and the encryption
  flag still reveal that a message exists and is encrypted.
- Password recovery: there is none. Pick a strong password.
- Resilience to re-encoding: cropping, resizing, or re-saving the PNG (which
  many social-media sites do automatically) destroys the hidden message.

**Legacy decoder behavior:** older versions of this app (before the
confidentiality mode) do not recognize the encryption flag. Opening a new
encrypted image in an older build triggers the strict UTF-8 decode in the
decode worker, which fails rather than displaying garbage.

### License
Original work © 2014 stylesuxx  
Enhanced version © 2026 ST4RKiLLaX
