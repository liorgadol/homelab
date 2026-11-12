import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import Editor from '../components/Editor';
import App from '../App';
import { useCanvasEditor } from '../hooks/useCanvasEditor';

// ---------- shared mocks ----------

// jsdom has no ImageData; the hook constructs it for undo/redo snapshots.
class FakeImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

// Image that "loads" synchronously with a 4x4 size when src is assigned.
// The hook assigns onload before src, so the callback is set by then.
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

// Stateful 2d context shared across calls, so paint/undo/redo are observable.
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

function makeBlob(text = 'fake-png') {
  return new Blob([text], { type: 'image/png' });
}

function renderEditor() {
  return render(
    <Editor resultBlob={makeBlob()} originalFile={new File(['x'], 'cat.png')} onRerun={() => {}} />,
  );
}

function getCanvas() {
  return screen.getByRole('img', { name: /canvas editor/i });
}

// A full click-style stroke on the canvas: mousedown then mouseup.
function paintStroke() {
  const canvas = getCanvas();
  fireEvent.mouseDown(canvas, { clientX: 0, clientY: 0, button: 0 });
  fireEvent.mouseUp(canvas);
}

let ctx;

beforeEach(() => {
  ctx = makeCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
  vi.stubGlobal('Image', FakeImage);
  if (!globalThis.ImageData) vi.stubGlobal('ImageData', FakeImageData);
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete global.fetch;
});

// ---------- 1. keyboard: redo, undo, tool shortcuts ----------

describe('keyboard shortcuts', () => {
  it('Cmd+Shift+Z redoes a stroke that was undone', () => {
    renderEditor();
    paintStroke();
    // Paint itself calls putImageData; record the count after the stroke
    const base = ctx.putImageData.mock.calls.length;

    // Undo with Cmd+Z (no shift)
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(ctx.putImageData).toHaveBeenCalledTimes(base + 1);
    expect(ctx.putImageData.mock.calls[base][0].data[3]).toBe(255); // pre-stroke opaque pixel

    // Redo with Cmd+Shift+Z (e.key is 'Z' when shift is held)
    fireEvent.keyDown(document.body, { key: 'Z', metaKey: true, shiftKey: true });
    expect(ctx.putImageData).toHaveBeenCalledTimes(base + 2);
    expect(ctx.putImageData.mock.calls[base + 1][0].data[3]).toBeLessThan(255); // stroke restored
  });

  it('Cmd+Z without shift undoes and does not redo', () => {
    renderEditor();
    paintStroke();
    const base = ctx.putImageData.mock.calls.length;

    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(ctx.putImageData).toHaveBeenCalledTimes(base + 1);
    expect(ctx.putImageData.mock.calls[base][0].data[3]).toBe(255);

    // Nothing left to redo: a second Cmd+Z is a no-op and no redo happened
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(ctx.putImageData).toHaveBeenCalledTimes(base + 1);
  });

  it('pressing e or r while focus is in an input does not change the tool', () => {
    renderEditor();
    const toolbar = screen.getByRole('toolbar', { name: /editor tools/i });
    const restoreBtn = within(toolbar).getByTitle('Restore');
    const eraseBtn = within(toolbar).getByTitle('Erase');

    // Put the tool into 'restore' via a plain key press on the body
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(restoreBtn).toHaveAttribute('aria-pressed', 'true');

    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      input.focus();
      fireEvent.keyDown(input, { key: 'e' });
      expect(restoreBtn).toHaveAttribute('aria-pressed', 'true');
      expect(eraseBtn).toHaveAttribute('aria-pressed', 'false');

      fireEvent.keyDown(input, { key: 'r' });
      expect(restoreBtn).toHaveAttribute('aria-pressed', 'true');
    } finally {
      input.remove();
    }
  });

  it('e and r still switch the tool when focus is on the body', () => {
    renderEditor();
    const toolbar = screen.getByRole('toolbar', { name: /editor tools/i });
    const eraseBtn = within(toolbar).getByTitle('Erase');
    const restoreBtn = within(toolbar).getByTitle('Restore');

    fireEvent.keyDown(document.body, { key: 'r' });
    expect(restoreBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document.body, { key: 'e' });
    expect(eraseBtn).toHaveAttribute('aria-pressed', 'true');
  });
});

// ---------- 2. editVersion (via hook harness) ----------

function Harness({ onReady, resultBlob }) {
  const editor = useCanvasEditor({ resultBlob, originalFile: { name: 'cat.png' } });
  useEffect(() => {
    onReady(editor);
  });
  return <canvas ref={editor.canvasRef} />;
}

function renderHarness() {
  const ref = { current: null };
  const blob = makeBlob('y');
  render(<Harness resultBlob={blob} onReady={(e) => { ref.current = e; }} />);
  return ref;
}

const fakeEvent = { button: 0, clientX: 0, clientY: 0, preventDefault() {} };

describe('editVersion', () => {
  it('increments on stopDrawing after startDrawing', () => {
    const ref = renderHarness();
    const before = ref.current.editVersion;

    act(() => ref.current.startDrawing(fakeEvent));
    expect(ref.current.editVersion).toBe(before);

    act(() => ref.current.stopDrawing());
    expect(ref.current.editVersion).toBe(before + 1);
  });

  it('does not increment on stopDrawing without a stroke (e.g. mouseleave alone)', () => {
    const ref = renderHarness();
    const before = ref.current.editVersion;

    act(() => ref.current.stopDrawing());
    expect(ref.current.editVersion).toBe(before);

    // A second stop after a real stroke must not double-count either
    act(() => ref.current.startDrawing(fakeEvent));
    act(() => ref.current.stopDrawing());
    const afterStroke = ref.current.editVersion;
    act(() => ref.current.stopDrawing());
    expect(ref.current.editVersion).toBe(afterStroke);
  });

  it('increments on undo only when a stack entry exists', () => {
    const ref = renderHarness();

    // Nothing to undo yet
    const v0 = ref.current.editVersion;
    act(() => ref.current.undo());
    expect(ref.current.editVersion).toBe(v0);

    // Make an undo entry
    act(() => ref.current.startDrawing(fakeEvent));
    act(() => ref.current.stopDrawing());
    const v1 = ref.current.editVersion;

    act(() => ref.current.undo());
    expect(ref.current.editVersion).toBe(v1 + 1);

    // Stack now empty again: no further bump
    const v2 = ref.current.editVersion;
    act(() => ref.current.undo());
    expect(ref.current.editVersion).toBe(v2);
  });

  it('increments on redo only when a redo entry exists', () => {
    const ref = renderHarness();

    act(() => ref.current.startDrawing(fakeEvent));
    act(() => ref.current.stopDrawing());
    act(() => ref.current.undo());

    const v1 = ref.current.editVersion;
    act(() => ref.current.redo());
    expect(ref.current.editVersion).toBe(v1 + 1);

    const v2 = ref.current.editVersion;
    act(() => ref.current.redo());
    expect(ref.current.editVersion).toBe(v2);
  });
});

// ---------- 3 & 4. bleed recompute and download ----------

describe('bleed sync and download', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function mockBleedResponse(body = 'bleed-png', status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => (k.toLowerCase() === 'x-bleed-px' ? '12' : null) },
      blob: async () => new Blob([body], { type: 'image/png' }),
    };
  }

  async function enableBleed() {
    fireEvent.click(screen.getByRole('checkbox', { name: /add white bleed/i }));
    await act(async () => { vi.advanceTimersByTime(300); });
  }

  it('recomputes bleed (second /add-bleed call) after a stroke ends', async () => {
    global.fetch.mockResolvedValue(mockBleedResponse());
    renderEditor();
    await enableBleed();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    paintStroke();
    // Nothing fires until the 250ms debounce elapses
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(global.fetch.mock.calls[1][0]).toMatch(/\/add-bleed\?offset_mm=3(\.0)?$/);
  });

  it('recomputes bleed after undo as well', async () => {
    global.fetch.mockResolvedValue(mockBleedResponse());
    renderEditor();
    paintStroke(); // stroke before enabling bleed; no fetch yet
    await enableBleed();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    await act(async () => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('download with bleed on POSTs a fresh /add-bleed at click time and saves that response', async () => {
    global.fetch.mockResolvedValueOnce(mockBleedResponse('bleed-png'));
    renderEditor();
    await enableBleed();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const freshBlob = new Blob(['fresh-download'], { type: 'image/png' });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      blob: async () => freshBlob,
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /download png/i }));
    });
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [url, opts] = global.fetch.mock.calls[1];
    expect(url).toMatch(/\/add-bleed\?offset_mm=3(\.0)?$/);
    expect(opts.method).toBe('POST');

    const anchor = clickSpy.mock.instances[0];
    expect(anchor.download).toBe('cat-bleed-3_0mm.png');
    // The object URL handed to the browser is built from the download response
    const lastObjectUrlArg = URL.createObjectURL.mock.calls.at(-1)[0];
    expect(lastObjectUrlArg).toBe(freshBlob);
    clickSpy.mockRestore();
  });

  it('download with bleed on shows the bleed error alert when the server returns an error', async () => {
    global.fetch.mockResolvedValueOnce(mockBleedResponse('bleed-png'));
    renderEditor();
    await enableBleed();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => null } });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /download png/i }));
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Bleed failed \(500\)/));
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('download with bleed on shows the bleed error alert when the request rejects', async () => {
    global.fetch.mockResolvedValueOnce(mockBleedResponse('bleed-png'));
    renderEditor();
    await enableBleed();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    global.fetch.mockRejectedValueOnce(new Error('network down'));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /download png/i }));
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/network down/));
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});

// ---------- 5. pan (Space + drag, middle mouse) does not paint or push undo ----------

describe('pan does not paint or touch undo history', () => {
  it('Space held + mousedown pans instead of painting', () => {
    const { container } = renderEditor();
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });

    fireEvent.mouseDown(getCanvas(), { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(window, { clientX: 30, clientY: 40 });
    fireEvent.mouseUp(window);

    expect(ctx.putImageData).not.toHaveBeenCalled();
    expect(container.querySelector('.canvas-scaler').style.transform).toContain('translate(20px, 30px)');

    // No undo entry was pushed, so Cmd+Z changes nothing
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(ctx.putImageData).not.toHaveBeenCalled();

    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
  });

  it('middle-button mousedown pans instead of painting', () => {
    const { container } = renderEditor();

    fireEvent.mouseDown(getCanvas(), { clientX: 10, clientY: 10, button: 1 });
    fireEvent.mouseMove(window, { clientX: 15, clientY: 25 });
    fireEvent.mouseUp(window);

    expect(ctx.putImageData).not.toHaveBeenCalled();
    expect(container.querySelector('.canvas-scaler').style.transform).toContain('translate(5px, 15px)');

    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });
});

// ---------- 6. wheel zoom ----------

describe('wheel zoom', () => {
  it('prevents default page scroll and changes the zoom label', () => {
    const { container } = renderEditor();
    const label = container.querySelector('.zoom-label');
    expect(label.textContent).toBe('100%');

    const area = container.querySelector('.canvas-area');
    const ev = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
    act(() => {
      area.dispatchEvent(ev);
    });

    expect(ev.defaultPrevented).toBe(true);
    expect(label.textContent).toBe('90%');
  });
});

// ---------- 7. App processing screen copy ----------

describe('App processing screen', () => {
  it('no longer says the first run downloads the AI model', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => new Promise(() => {}), // never resolves: stays on processing screen
    });

    render(<App />);
    const input = document.querySelector('input[type="file"]');
    await userEvent.upload(input, new File(['img'], 'test.jpg', { type: 'image/jpeg' }));

    const spinner = screen.getByTestId('processing-spinner');
    expect(spinner).toHaveTextContent('Removing background');
    expect(spinner.textContent).not.toMatch(/downloads the AI model/i);
  });
});
