self.onmessage = function(e) {
  if (e.data.type !== 'toBlob') return;
  var width = e.data.width;
  var height = e.data.height;
  var data = e.data.data;
  try {
    var canvas = new OffscreenCanvas(width, height);
    var ctx = canvas.getContext('2d');
    var imageData = new ImageData(new Uint8ClampedArray(data), width, height);
    ctx.putImageData(imageData, 0, 0);
    canvas.convertToBlob({ type: 'image/png' }).then(function(blob) {
      self.postMessage({ type: 'blob', blob: blob, width: width, height: height });
    }).catch(function(err) {
      self.postMessage({ type: 'error', message: err.message || 'Failed to encode PNG.' });
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
