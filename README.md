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
- Memory leak prevention and rate limiting
- Removed GIF support (incompatible with LSB algorithm)

**User Interface:**
- **Smart auto LSB mode selection** with real-time capacity analysis
- **Dynamic badge system**: Live character counter + capacity feedback (stacked)
- **Automatic mode detection** on decode with manual override option
- Color-coded progress bar (green → yellow → orange → red)
- Dark/light mode toggle with localStorage persistence
- Modern Bootstrap 5.3 card-based layout
- Interactive fullscreen image comparison slider
- Direct download buttons (no more right-click instructions)
- Drag-and-drop file upload support
- Responsive mobile-optimized design
- Educational modal explaining LSB steganography (v3 two-layer architecture)

**Performance:**
- TextEncoder/TextDecoder for proper Unicode handling
- Optimized binary string construction
- Canvas context optimization (willReadFrequently)
- 60fps slider animations with CSS clip-path

**Accessibility:**
- Keyboard navigation support
- ARIA labels for screen readers
- Focus management in modals
- High contrast mode compatible

### Tech Stack
- Pure vanilla JavaScript (no jQuery)
- Bootstrap 5.3.3
- HTML5 Canvas API
- CSS Variables for theming
- No external dependencies for core functionality

### License
Original work © 2014 stylesuxx  
Enhanced version © 2026 ST4RKiLLaX
