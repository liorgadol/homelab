import '@testing-library/jest-dom';

// @testing-library/dom's jestFakeTimersAreEnabled() checks for the `jest` global.
// Vitest doesn't inject `jest`, so waitFor's fake-timer path never activates.
// Alias vi → jest so the detection works and waitFor advances fake timers correctly.
globalThis.jest = vi;

// Mock URL.createObjectURL / revokeObjectURL (not available in jsdom)
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// Mock canvas getContext so pixel tests work in jsdom
HTMLCanvasElement.prototype.getContext = function (type) {
  if (type !== '2d') return null;
  const store = new Map();
  return {
    drawImage: vi.fn(),
    getImageData: vi.fn((x, y, w, h) => {
      const key = `${x},${y},${w},${h}`;
      return (
        store.get(key) || {
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }
      );
    }),
    putImageData: vi.fn((imgData, x, y) => {
      const key = `${x ?? 0},${y ?? 0},${imgData.width},${imgData.height}`;
      store.set(key, imgData);
    }),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  };
};

HTMLCanvasElement.prototype.toBlob = function (callback, type) {
  callback(new Blob(['fake'], { type: type || 'image/png' }));
};
