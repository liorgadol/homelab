import { describe, it, expect } from 'vitest';

describe('Canvas Mock', () => {
  it('stores and retrieves pixel data via putImageData and getImageData', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Create test pixel data
    const pixelData = new Uint8ClampedArray([255, 0, 0, 255]);
    const imgData = { data: pixelData, width: 1, height: 1 };

    // Put the image data
    ctx.putImageData(imgData, 0, 0);

    // Get the image data back
    const retrieved = ctx.getImageData(0, 0, 1, 1);

    // Verify the data persists
    expect(retrieved.data).toEqual(pixelData);
    expect(retrieved.width).toBe(1);
    expect(retrieved.height).toBe(1);
  });

  it('returns blank pixels for unset coordinates', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Get unset image data
    const blank = ctx.getImageData(10, 10, 2, 2);

    expect(blank.data).toEqual(new Uint8ClampedArray(16)); // 2*2*4 = 16 bytes
    expect(blank.width).toBe(2);
    expect(blank.height).toBe(2);
  });
});
