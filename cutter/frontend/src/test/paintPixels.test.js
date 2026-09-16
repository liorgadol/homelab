import { paintPixels } from '../hooks/paintPixels';

function makeImageData(width, height, fillAlpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 0] = 100; // R
    data[i * 4 + 1] = 100; // G
    data[i * 4 + 2] = 100; // B
    data[i * 4 + 3] = fillAlpha; // A
  }
  return data;
}

describe('paintPixels — erase', () => {
  it('reduces alpha of center pixel when erasing', () => {
    const data = makeImageData(10, 10, 255);
    const result = makeImageData(10, 10, 255);
    paintPixels(data, result, 10, 10, 5, 5, 4, 1.0, 'erase');
    const centerIdx = (5 * 10 + 5) * 4 + 3;
    expect(data[centerIdx]).toBe(0); // fully erased with opacity 1.0
  });

  it('does not reduce alpha below 0', () => {
    const data = makeImageData(10, 10, 0);
    const result = makeImageData(10, 10, 255);
    paintPixels(data, result, 10, 10, 5, 5, 4, 1.0, 'erase');
    const centerIdx = (5 * 10 + 5) * 4 + 3;
    expect(data[centerIdx]).toBe(0);
  });

  it('only modifies pixels within the brush radius', () => {
    const data = makeImageData(10, 10, 255);
    const result = makeImageData(10, 10, 255);
    paintPixels(data, result, 10, 10, 5, 5, 2, 1.0, 'erase'); // small brush r=1
    // pixel far from center (0,0) should be unchanged
    expect(data[3]).toBe(255);
  });
});

describe('paintPixels — restore', () => {
  it('increases alpha up to the result alpha', () => {
    const data = makeImageData(10, 10, 0); // current: fully transparent
    const result = makeImageData(10, 10, 200); // original result: alpha=200
    paintPixels(data, result, 10, 10, 5, 5, 4, 1.0, 'restore');
    const centerIdx = (5 * 10 + 5) * 4 + 3;
    expect(data[centerIdx]).toBe(200); // restored up to result alpha
  });

  it('does not restore beyond the result alpha', () => {
    const data = makeImageData(10, 10, 150);
    const result = makeImageData(10, 10, 100); // result alpha is 100
    paintPixels(data, result, 10, 10, 5, 5, 4, 1.0, 'restore');
    const centerIdx = (5 * 10 + 5) * 4 + 3;
    expect(data[centerIdx]).toBe(100); // capped at result alpha
  });
});

describe('paintPixels — edge cases', () => {
  it('handles opacity=0 without changing pixels', () => {
    const data = makeImageData(10, 10, 255);
    const result = makeImageData(10, 10, 255);
    paintPixels(data, result, 10, 10, 5, 5, 4, 0.0, 'erase');
    const centerIdx = (5 * 10 + 5) * 4 + 3;
    expect(data[centerIdx]).toBe(255);
  });

  it('erase with brushSize=1 affects only center pixel', () => {
    const data = makeImageData(10, 10, 255);
    const result = makeImageData(10, 10, 255);
    paintPixels(data, result, 10, 10, 5, 5, 1, 1.0, 'erase');
    const centerIdx = (5 * 10 + 5) * 4 + 3;
    expect(data[centerIdx]).toBe(0);
    // Adjacent pixel should be unchanged
    const adjIdx = (4 * 10 + 5) * 4 + 3;
    expect(data[adjIdx]).toBe(255);
  });
});
