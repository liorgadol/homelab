import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Editor from './Editor';

function makeBlob(text = 'fake-png') {
  return new Blob([text], { type: 'image/png' });
}

describe('Editor bleed wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  function mockBleedFetch({ status = 200, bleedPx = 12, body = 'bleed-png' } = {}) {
    global.fetch.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => (k.toLowerCase() === 'x-bleed-px' ? String(bleedPx) : null) },
      blob: async () => new Blob([body], { type: 'image/png' }),
    });
  }

  it('does not call /add-bleed when toggle is off', async () => {
    render(<Editor resultBlob={makeBlob()} originalFile={new File(['x'], 'cat.png')} onRerun={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to /add-bleed with offset_mm after debounce when enabled', async () => {
    mockBleedFetch();
    render(<Editor resultBlob={makeBlob()} originalFile={new File(['x'], 'cat.png')} onRerun={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /add white bleed/i }));

    await act(async () => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const url = global.fetch.mock.calls[0][0];
    expect(url).toMatch(/\/add-bleed\?offset_mm=3(\.0)?$/);
  });

  it('aborts in-flight request when slider moves again before it resolves', async () => {
    let resolveFirst;
    global.fetch
      .mockImplementationOnce((_url, opts) => {
        return new Promise((resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          resolveFirst = resolve;
        });
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => '20' },
        blob: async () => new Blob(['bleed'], { type: 'image/png' }),
      });

    render(<Editor resultBlob={makeBlob()} originalFile={new File(['x'], 'cat.png')} onRerun={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /add white bleed/i }));
    await act(async () => { vi.advanceTimersByTime(300); });

    fireEvent.change(screen.getByLabelText(/offset/i), { target: { value: '5' } });
    await act(async () => { vi.advanceTimersByTime(300); });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('download with bleed on uses bleed blob and -bleed suffix', async () => {
    mockBleedFetch();
    render(<Editor resultBlob={makeBlob()} originalFile={new File(['x'], 'cat.png')} onRerun={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /add white bleed/i }));
    await act(async () => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /download png/i }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    const anchor = clickSpy.mock.instances[0];
    expect(anchor.download).toBe('cat-bleed-3_0mm.png');
    clickSpy.mockRestore();
  });

  it('download with bleed off uses -nobg suffix', async () => {
    render(<Editor resultBlob={makeBlob()} originalFile={new File(['x'], 'cat.png')} onRerun={() => {}} />);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /download png/i }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(clickSpy.mock.instances[0].download).toBe('cat-nobg.png');
    clickSpy.mockRestore();
  });
});
