import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unzipSync } from 'fflate';
import App from '../App';

// jsdom Blob may not expose arrayBuffer(); polyfill it via FileReader.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer() {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(this);
    });
  };
}

// ---------- canvas / image shims (same approach as round1.test.jsx) ----------

// jsdom has no ImageData; the hook constructs it for undo/redo snapshots.
class FakeImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

// Image that "loads" synchronously with a 4x4 size when src is assigned.
class FakeImage {
  set src(value) {
    this._src = value;
    this.naturalWidth = 4;
    this.naturalHeight = 4;
    if (this.onload) this.onload();
  }
  get src() {
    return this._src;
  }
}

// Stateful 2d context so paint/undo are observable.
function makeCtx() {
  const ctx = {
    buffer: null,
    drawImage: vi.fn((img) => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const buf = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        buf[i * 4] = 100;
        buf[i * 4 + 1] = 100;
        buf[i * 4 + 2] = 100;
        buf[i * 4 + 3] = 255;
      }
      ctx.buffer = buf;
    }),
    getImageData: vi.fn((x, y, w, h) => ({
      data: ctx.buffer ? new Uint8ClampedArray(ctx.buffer) : new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
    putImageData: vi.fn((img) => {
      ctx.buffer = new Uint8ClampedArray(img.data);
    }),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  };
  return ctx;
}

// ---------- fetch router state ----------

let bgMode; // 'immediate' | 'deferred'
let bgPending; // [{ name, resolve }] one per /remove-bg call, in call order
let bgCalls; // file names sent to /remove-bg
let bleedCalls; // [{ url, text }] for every /add-bleed call (preview and zip)
let bleedFail; // when true, /add-bleed responds 500
let savedBlobs; // every blob produced by canvas.toBlob, in order
let downloads; // anchor.download values that were clicked
let blobSeq;
let ctx;

function headers(obj) {
  return { get: (k) => obj[k.toLowerCase()] ?? null };
}

function pngResponse(text) {
  return {
    ok: true,
    status: 200,
    headers: headers({}),
    blob: async () => new Blob([text], { type: 'image/png' }),
  };
}

function readBytes(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

async function readText(blob) {
  return new TextDecoder().decode(await readBytes(blob));
}

async function fetchRouter(url, init = {}) {
  if (url.startsWith('/remove-bg')) {
    const name = init.body.get('file').name;
    bgCalls.push(name);
    return new Promise((resolve) => {
      bgPending.push({ name, resolve });
      if (bgMode === 'immediate') resolve(pngResponse(`nobg:${name}`));
    });
  }
  if (url.startsWith('/add-bleed')) {
    const text = await readText(init.body.get('file'));
    bleedCalls.push({ url, text });
    if (bleedFail) return { ok: false, status: 500, headers: headers({}) };
    return {
      ok: true,
      status: 200,
      headers: headers({ 'x-bleed-px': '12' }),
      blob: async () => new Blob([`bleed:${text}`], { type: 'image/png' }),
    };
  }
  throw new Error(`unexpected fetch ${url}`);
}

// ---------- helpers ----------

const jpg = (name) => new File([`img-${name}`], name, { type: 'image/jpeg' });

async function uploadFiles(files) {
  await act(async () => {
    fireEvent.drop(screen.getByTestId('upload-zone'), { dataTransfer: { files } });
  });
}

async function finishBg(i) {
  const entry = bgPending[i];
  await act(async () => {
    entry.resolve(pngResponse(`nobg:${entry.name}`));
  });
}

function getCanvas() {
  return screen.getByRole('img', { name: /canvas editor/i });
}

function canvasFor(name) {
  return screen.getByRole('img', { name: `Canvas editor for ${name}` });
}

// Click-style stroke, same coordinates as round1.test.jsx (rect is zero-size in jsdom).
function stroke() {
  const canvas = getCanvas();
  fireEvent.mouseDown(canvas, { clientX: 0, clientY: 0, button: 0 });
  fireEvent.mouseUp(canvas);
}

function selectItem(name) {
  fireEvent.click(screen.getByRole('button', { name: `Select ${name}` }));
}

function bleedCheckbox() {
  return screen.getByRole('checkbox', { name: 'Add white bleed' });
}

function clickDownloadAll() {
  fireEvent.click(screen.getByRole('button', { name: /Download all/ }));
}

function lastZipBlob() {
  return URL.createObjectURL.mock.calls
    .map((c) => c[0])
    .filter((b) => b && b.type === 'application/zip')
    .at(-1);
}

async function unzipTexts(blob) {
  const entries = unzipSync(await readBytes(blob));
  const out = {};
  for (const [name, bytes] of Object.entries(entries)) {
    out[name] = new TextDecoder().decode(bytes);
  }
  return out;
}

// Helper for the "switch items then come back" flow; returns the Blob the Editor was given.
function createObjectURLArgsSince(index) {
  return URL.createObjectURL.mock.calls.slice(index).map((c) => c[0]);
}

beforeEach(() => {
  bgMode = 'immediate';
  bgPending = [];
  bgCalls = [];
  bleedCalls = [];
  bleedFail = false;
  savedBlobs = [];
  downloads = [];
  blobSeq = 0;
  ctx = makeCtx();

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(cb, type) {
    blobSeq += 1;
    const b = new Blob([`edit-${blobSeq}`], { type: type || 'image/png' });
    savedBlobs.push(b);
    cb(b);
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    downloads.push(this.download);
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);

  vi.stubGlobal('Image', FakeImage);
  if (!globalThis.ImageData) vi.stubGlobal('ImageData', FakeImageData);
  global.fetch = vi.fn(fetchRouter);
  URL.createObjectURL.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete global.fetch;
});

// ---------- tests ----------

describe('batch queue integration', () => {
  it('shows the first editor while the second file is still processing, calling /remove-bg sequentially', async () => {
    bgMode = 'deferred';
    render(<App />);
    await uploadFiles([jpg('a.jpg'), jpg('b.jpg')]);

    await waitFor(() => expect(bgCalls).toEqual(['a.jpg']));
    expect(screen.getByTestId('processing-spinner')).toBeInTheDocument();

    await finishBg(0);

    expect(await screen.findByTestId('editor-container')).toBeInTheDocument();
    await waitFor(() => expect(bgCalls).toEqual(['a.jpg', 'b.jpg']));
    expect(screen.getByRole('img', { name: 'done' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'removing background' })).toBeInTheDocument();
  });

  it('renders no queue strip for a single file', async () => {
    render(<App />);
    await uploadFiles([jpg('solo.jpg')]);

    expect(await screen.findByTestId('editor-container')).toBeInTheDocument();
    expect(screen.queryByTestId('queue-strip')).toBeNull();
  });

  it('skips unsupported files with a banner that can be dismissed', async () => {
    render(<App />);
    await uploadFiles([new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }), jpg('cat.jpg')]);

    expect(await screen.findByText('1 file skipped: unsupported type')).toBeInTheDocument();
    expect(await screen.findByTestId('editor-container')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('1 file skipped: unsupported type')).toBeNull();
  });

  it('keeps edits when switching items after the 300ms save debounce', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App />);
    await uploadFiles([jpg('a.jpg'), jpg('b.jpg')]);
    await waitFor(() => expect(canvasFor('a.jpg')).toBeInTheDocument());

    stroke();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const edited = savedBlobs.at(-1);

    selectItem('b.jpg');
    await waitFor(() => expect(canvasFor('b.jpg')).toBeInTheDocument());

    const mark = URL.createObjectURL.mock.calls.length;
    selectItem('a.jpg');
    await waitFor(() => expect(canvasFor('a.jpg')).toBeInTheDocument());

    expect(createObjectURLArgsSince(mark)).toContain(edited);
  });

  it('flushes an in-progress edit on item switch (Review Focus #2)', async () => {
    render(<App />);
    await uploadFiles([jpg('a.jpg'), jpg('b.jpg')]);
    await waitFor(() => expect(canvasFor('a.jpg')).toBeInTheDocument());

    // Switch before the debounce elapses: the unmount flush must save the stroke.
    stroke();
    selectItem('b.jpg');
    await waitFor(() => expect(canvasFor('b.jpg')).toBeInTheDocument());
    const flushed = savedBlobs.at(-1);
    expect(flushed).toBeDefined();

    const mark = URL.createObjectURL.mock.calls.length;
    selectItem('a.jpg');
    await waitFor(() => expect(canvasFor('a.jpg')).toBeInTheDocument());

    expect(createObjectURLArgsSince(mark)).toContain(flushed);
  });

  it('zips only bleed-enabled items through /add-bleed and names the zip cutter-YYYYMMDD-HHMM.zip', async () => {
    render(<App />);
    await uploadFiles([jpg('a.jpg'), jpg('b.jpg')]);
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'done' })).toHaveLength(2));

    // Enable bleed on a.jpg and let its preview request finish.
    selectItem('a.jpg');
    await waitFor(() => expect(canvasFor('a.jpg')).toBeInTheDocument());
    fireEvent.click(bleedCheckbox());
    await waitFor(() => expect(bleedCalls.length).toBeGreaterThan(0));
    await act(async () => {});

    // Only the zip should count from here on.
    bleedCalls.splice(0);
    selectItem('b.jpg');
    await waitFor(() => expect(canvasFor('b.jpg')).toBeInTheDocument());
    clickDownloadAll();

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]).toMatch(/^cutter-\d{8}-\d{4}\.zip$/);

    expect(bleedCalls).toHaveLength(1);
    expect(bleedCalls[0].url).toBe('/add-bleed?offset_mm=3');
    expect(bleedCalls[0].text).toBe('nobg:a.jpg');

    const entries = await unzipTexts(lastZipBlob());
    expect(Object.keys(entries).sort()).toEqual(['a-bleed-3_0mm.png', 'b-nobg.png']);
    expect(entries['a-bleed-3_0mm.png']).toBe('bleed:nobg:a.jpg');
    expect(entries['b-nobg.png']).toBe('nobg:b.jpg');
  });

  it('gives duplicate filenames unique names inside the zip (Review Focus #4)', async () => {
    render(<App />);
    await uploadFiles([jpg('cat.jpg'), jpg('cat.jpg')]);
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'done' })).toHaveLength(2));

    clickDownloadAll();
    await waitFor(() => expect(downloads).toHaveLength(1));

    const entries = await unzipTexts(lastZipBlob());
    expect(Object.keys(entries).sort()).toEqual(['cat-nobg-2.png', 'cat-nobg.png']);
  });

  it('excludes items still processing from the zip and lists them in the info banner (Review Focus #3)', async () => {
    bgMode = 'deferred';
    render(<App />);
    await uploadFiles([jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')]);

    await waitFor(() => expect(bgCalls).toEqual(['a.jpg']));
    await finishBg(0);
    await waitFor(() => expect(bgCalls).toEqual(['a.jpg', 'b.jpg']));
    await finishBg(1);
    await waitFor(() => expect(bgCalls).toEqual(['a.jpg', 'b.jpg', 'c.jpg']));

    clickDownloadAll();
    await waitFor(() => expect(downloads).toHaveLength(1));

    expect(screen.getByText('Skipped (not ready): c.jpg')).toBeInTheDocument();
    const entries = await unzipTexts(lastZipBlob());
    expect(Object.keys(entries).sort()).toEqual(['a-nobg.png', 'b-nobg.png']);
  });

  it('aborts the zip with an error naming the file when /add-bleed fails (Review Focus #5)', async () => {
    render(<App />);
    await uploadFiles([jpg('a.jpg'), jpg('b.jpg')]);
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'done' })).toHaveLength(2));

    selectItem('a.jpg');
    await waitFor(() => expect(canvasFor('a.jpg')).toBeInTheDocument());
    fireEvent.click(bleedCheckbox());
    await waitFor(() => expect(bleedCalls.length).toBeGreaterThan(0));
    await act(async () => {});

    bleedFail = true;
    clickDownloadAll();

    expect(await screen.findByText(/a\.jpg: Bleed failed \(500\)/)).toBeInTheDocument();
    expect(downloads).toHaveLength(0);
  });

  it('asks before re-running AI when edits exist, and only re-runs on confirm', async () => {
    render(<App />);
    await uploadFiles([jpg('cat.jpg')]);
    expect(await screen.findByTestId('editor-container')).toBeInTheDocument();

    // Fake timers only for the save debounce, enabled after the editor has mounted.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stroke();
    act(() => {
      vi.advanceTimersByTime(300);
    });

    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /Re-run AI/ }));
    expect(window.confirm).toHaveBeenLastCalledWith('Discard edits and re-run AI?');
    expect(bgCalls).toHaveLength(1);
    expect(getCanvas()).toBeInTheDocument(); // edits kept, editor still mounted

    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Re-run AI/ }));
    await waitFor(() => expect(bgCalls).toHaveLength(2));
    expect(await screen.findByTestId('editor-container')).toBeInTheDocument();
  });

  it('"Apply outline to all" copies the bleed setting onto other items', async () => {
    render(<App />);
    await uploadFiles([jpg('a.jpg'), jpg('b.jpg')]);
    await waitFor(() => expect(canvasFor('a.jpg')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'done' })).toHaveLength(2));

    fireEvent.click(bleedCheckbox());
    fireEvent.click(screen.getByRole('button', { name: 'Apply outline to all' }));

    selectItem('b.jpg');
    await waitFor(() => expect(canvasFor('b.jpg')).toBeInTheDocument());
    expect(bleedCheckbox()).toBeChecked();
  });

  it('removes an item via its "Remove <name>" button and clears back to the upload zone via Clear all', async () => {
    render(<App />);
    await uploadFiles([jpg('a.jpg'), jpg('b.jpg')]);
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'done' })).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Remove a.jpg' }));
    expect(screen.queryByRole('button', { name: 'Select a.jpg' })).toBeNull();
    // One item left: strip hidden, remaining item's editor shown.
    expect(screen.queryByTestId('queue-strip')).toBeNull();
    expect(await screen.findByTestId('editor-container')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(window.confirm).toHaveBeenLastCalledWith('Remove all images?');
    expect(await screen.findByTestId('upload-zone')).toBeInTheDocument();
  });
});
