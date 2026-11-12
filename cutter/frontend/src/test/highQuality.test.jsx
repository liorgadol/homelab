import { render, screen, fireEvent, act, waitFor, renderHook, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { removeBg } from '../api';
import { useQueue } from '../queue/useQueue';
import QueueStrip from '../components/QueueStrip';
import App from '../App';

// ---------- api.removeBg ----------

describe('removeBg quality query param', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['png'], { type: 'image/png' }),
    }));
  });
  afterEach(() => {
    delete global.fetch;
  });

  it('defaults to ?quality=standard', async () => {
    await removeBg(new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect(global.fetch.mock.calls[0][0]).toBe('/remove-bg?quality=standard');
  });

  it('sends ?quality=high when asked for high', async () => {
    await removeBg(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), undefined, 'high');
    expect(global.fetch.mock.calls[0][0]).toBe('/remove-bg?quality=high');
  });
});

// ---------- useQueue rerun with quality ----------

const blob = (text) => new Blob([text], { type: 'image/png' });

// jsdom Blob has no text(); read through FileReader.
function readText(b) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsText(b);
  });
}
const file = (name, type = 'image/jpeg') => new File(['x'], name, { type });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setupQueue() {
  const pending = [];
  const removeBg = vi.fn(() => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  });
  const { result } = renderHook(() => useQueue({ removeBg }));
  return { removeBg, pending, result };
}

describe('useQueue quality on rerun', () => {
  it('rerun(id, "high") calls removeBg with "high" and sets item.quality', async () => {
    const { result, removeBg, pending } = setupQueue();
    act(() => {
      result.current.addFiles([file('a.jpg')]);
    });
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(1));
    expect(removeBg.mock.calls[0][2]).toBe('standard');
    const id = result.current.items[0].id;

    await act(async () => {
      pending[0].resolve(blob('std'));
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));

    act(() => {
      result.current.rerun(id, 'high');
    });
    expect(result.current.items[0].quality).toBe('high');
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(2));
    expect(removeBg.mock.calls[1][2]).toBe('high');
    expect(result.current.items[0].quality).toBe('high');
  });

  it('plain rerun(id) on a high-quality item keeps "high"', async () => {
    const { result, removeBg, pending } = setupQueue();
    act(() => {
      result.current.addFiles([file('a.jpg')]);
    });
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(1));
    const id = result.current.items[0].id;
    await act(async () => {
      pending[0].resolve(blob('std'));
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));

    act(() => {
      result.current.rerun(id, 'high');
    });
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(2));
    await act(async () => {
      pending[1].resolve(blob('hq'));
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));

    act(() => {
      result.current.rerun(id);
    });
    expect(result.current.items[0].quality).toBe('high');
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(3));
    expect(removeBg.mock.calls[2][2]).toBe('high');
  });

  it('rerun in high quality while processing ignores the stale standard result', async () => {
    const { result, removeBg, pending } = setupQueue();
    act(() => {
      result.current.addFiles([file('a.jpg')]);
    });
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(1));
    expect(result.current.items[0].status).toBe('processing');
    const id = result.current.items[0].id;

    act(() => {
      result.current.rerun(id, 'high');
    });
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(2));
    expect(removeBg.mock.calls[1][2]).toBe('high');

    // The stale standard request finally resolves after the rerun.
    await act(async () => {
      pending[0].resolve(blob('stale-standard'));
    });
    expect(result.current.items[0].status).toBe('processing');
    expect(result.current.items[0].resultBlob).toBeFalsy();

    await act(async () => {
      pending[1].resolve(blob('hq-result'));
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));
    expect(result.current.items[0].quality).toBe('high');
    expect(await readText(result.current.items[0].resultBlob)).toBe('hq-result');
  });
});

// ---------- QueueStrip HQ badge ----------

describe('QueueStrip high-quality badge', () => {
  function itemFor(name) {
    return screen.getByRole('button', { name: `Select ${name}` }).closest('[data-testid="queue-item"]');
  }

  it('shows the "high quality" badge only for high-quality items', () => {
    const items = [
      { id: 'a', file: new File(['a'], 'a.jpg', { type: 'image/jpeg' }), status: 'done', quality: 'high' },
      { id: 'b', file: new File(['b'], 'b.jpg', { type: 'image/jpeg' }), status: 'done', quality: 'standard' },
      { id: 'c', file: new File(['c'], 'c.jpg', { type: 'image/jpeg' }), status: 'done' },
    ];
    render(
      <QueueStrip
        items={items}
        selectedId="a"
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        onAdd={vi.fn()}
      />,
    );
    expect(within(itemFor('a.jpg')).getByRole('img', { name: 'high quality' })).toBeInTheDocument();
    expect(within(itemFor('b.jpg')).queryByRole('img', { name: 'high quality' })).toBeNull();
    expect(within(itemFor('c.jpg')).queryByRole('img', { name: 'high quality' })).toBeNull();
    expect(screen.getAllByRole('img', { name: 'high quality' })).toHaveLength(1);
  });
});

// ---------- App: re-run in high quality ----------

let bgMode; // 'immediate' | 'deferred'
let bgPending; // [{ name, resolve }]
let bgUrls; // every /remove-bg URL requested, in order
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

async function fetchRouter(url, init = {}) {
  if (url.startsWith('/remove-bg')) {
    const name = init.body.get('file').name;
    bgUrls.push(url);
    return new Promise((resolve) => {
      bgPending.push({ name, resolve });
      if (bgMode === 'immediate') resolve(pngResponse(`nobg:${name}`));
    });
  }
  throw new Error(`unexpected fetch ${url}`);
}

// Canvas shims (same approach as batch.test.jsx) so painting produces edits.
function makeCtx() {
  const c = {
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
      c.buffer = buf;
    }),
    getImageData: vi.fn((x, y, w, h) => ({
      data: c.buffer ? new Uint8ClampedArray(c.buffer) : new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
    putImageData: vi.fn((img) => {
      c.buffer = new Uint8ClampedArray(img.data);
    }),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  };
  return c;
}

class FakeImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

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

const jpg = (name) => new File([`img-${name}`], name, { type: 'image/jpeg' });

async function uploadFiles(files) {
  await act(async () => {
    fireEvent.drop(screen.getByTestId('upload-zone'), { dataTransfer: { files } });
  });
}

function getCanvas() {
  return screen.getByRole('img', { name: /canvas editor/i });
}

function stroke() {
  const canvas = getCanvas();
  fireEvent.mouseDown(canvas, { clientX: 0, clientY: 0, button: 0 });
  fireEvent.mouseUp(canvas);
}

// Single-item App hides the strip, so "done" is observed as: no spinner and an editor mounted.
async function waitForIdle() {
  await waitFor(() => {
    expect(screen.queryByTestId('processing-spinner')).toBeNull();
    expect(screen.getByTestId('editor-container')).toBeInTheDocument();
  });
}

function hqButton() {
  return screen.queryByRole('button', { name: /Re-run in high quality/ });
}

describe('App high-quality re-run', () => {
  beforeEach(() => {
    bgMode = 'immediate';
    bgPending = [];
    bgUrls = [];
    ctx = makeCtx();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(cb, type) {
      cb(new Blob(['edit'], { type: type || 'image/png' }));
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

  it('shows the high-quality button for a done standard item and re-runs at quality=high on click', async () => {
    render(<App />);
    await uploadFiles([jpg('cat.jpg')]);
    await waitForIdle();
    expect(bgUrls).toEqual(['/remove-bg?quality=standard']);

    bgMode = 'deferred';
    fireEvent.click(hqButton());

    await waitFor(() => expect(bgUrls).toEqual(['/remove-bg?quality=standard', '/remove-bg?quality=high']));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(await screen.findByText('High quality — about 15 s…')).toBeInTheDocument();
    expect(screen.queryByText('Removing background…')).toBeNull();
  });

  it('removes the high-quality button once the item is high quality and done', async () => {
    render(<App />);
    await uploadFiles([jpg('cat.jpg')]);
    await waitForIdle();
    expect(hqButton()).toBeInTheDocument();

    fireEvent.click(hqButton());
    await waitFor(() => expect(bgUrls).toHaveLength(2));
    await waitForIdle();
    expect(screen.queryByText('High quality — about 15 s…')).toBeNull();
    expect(hqButton()).toBeNull();
  });

  it('asks before discarding edits and does not re-run when the confirm is declined', async () => {
    render(<App />);
    await uploadFiles([jpg('cat.jpg')]);
    expect(await screen.findByTestId('editor-container')).toBeInTheDocument();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    stroke();
    act(() => {
      vi.advanceTimersByTime(300);
    });

    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(hqButton());
    expect(window.confirm).toHaveBeenLastCalledWith('Discard edits and re-run AI?');
    expect(bgUrls).toEqual(['/remove-bg?quality=standard']);
    expect(getCanvas()).toBeInTheDocument();
  });
});
