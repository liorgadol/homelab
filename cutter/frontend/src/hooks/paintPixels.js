/**
 * Paint a circular brush stroke onto pixel data (in place).
 *
 * @param {Uint8ClampedArray} data       - current canvas pixel data (modified in place)
 * @param {Uint8ClampedArray} resultData - original AI result pixel data (read-only reference)
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} x                    - brush center X (canvas pixels)
 * @param {number} y                    - brush center Y (canvas pixels)
 * @param {number} brushSize            - diameter in pixels
 * @param {number} opacity              - 0.0–1.0
 * @param {'erase'|'restore'} tool
 */
export function paintPixels(data, resultData, canvasWidth, canvasHeight, x, y, brushSize, opacity, tool) {
  const r = brushSize / 2;
  const alphaChange = Math.round(opacity * 255);
  const cx = Math.round(x);
  const cy = Math.round(y);

  for (let dy = -Math.ceil(r); dy < Math.ceil(r); dy++) {
    for (let dx = -Math.ceil(r); dx < Math.ceil(r); dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || px >= canvasWidth || py < 0 || py >= canvasHeight) continue;
      const idx = (py * canvasWidth + px) * 4 + 3;
      if (tool === 'erase') {
        data[idx] = Math.max(0, data[idx] - alphaChange);
      } else {
        const origAlpha = resultData[idx];
        data[idx] = Math.min(origAlpha, data[idx] + alphaChange);
      }
    }
  }
}
