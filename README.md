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

The User chooses an image, the image data is then normalized, meaning that each RGB value is decremented by one if it is not even. 
This is done for every pixel in the image.

Next the message is converted to a binary representation, 8 Bits per character of the message. This binary representation 
is then applied to the normalized image, 3 Bit per pixel. This concludes, that the maximal length of a message hidden in 
an image is:

    Image Width * Image Height * 3
    ------------------------------
                  8

Since the image was normalized, we now know that an **even** r, g or b value is **0** and an **uneven** is a **1**. And this is how the
 message is decoded back from the image.

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
- 32-bit message length header for data integrity
- Memory leak prevention and rate limiting
- Removed GIF support (incompatible with LSB algorithm)

**User Interface:**
- Dark/light mode toggle with localStorage persistence
- Modern Bootstrap 5.3 card-based layout
- Interactive fullscreen image comparison slider
- Direct download buttons (no more right-click instructions)
- Responsive mobile-optimized design
- Educational modal explaining LSB steganography

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
