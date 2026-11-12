import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useQueue } from '../queue/useQueue';

const blob = (text) => new Blob([text], { type: 'image/png' });
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

// removeBg mock: every call returns a deferred the test resolves/rejects by hand.
function makeRemoveBg() {
  const pending = [];
  const removeBg = vi.fn(() => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  });
  return { removeBg, pending };
}

function setup() {
  const mock = makeRemoveBg();
  const hook = renderHook(() => useQueue({ removeBg: mock.removeBg }));
  return { ...mock, result: hook.result };
}

describe('useQueue', () => {
  it('runs removeBg sequentially: second call only after first resolves', async () => {
    const { result, removeBg, pending } = setup();
    const a = file('a.jpg');
    const b = file('b.jpg');

    act(() => {
      result.current.addFiles([a, b]);
    });

    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(1));
    expect(removeBg.mock.calls[0][0]).toBe(a);

    // Still only one request in flight
    await act(async () => {});
    expect(removeBg).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0].resolve(blob('a-result'));
    });

    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(2));
    expect(removeBg.mock.calls[1][0]).toBe(b);
    expect(result.current.items[0].status).toBe('done');
    expect(result.current.items[0].resultBlob).toBeTruthy();

    await act(async () => {
      pending[1].resolve(blob('b-result'));
    });
    await waitFor(() => expect(result.current.items[1].status).toBe('done'));
  });

  it('skips unsupported types and reports them', () => {
    const { result } = setup();
    let r;
    act(() => {
      r = result.current.addFiles([file('doc.pdf', 'application/pdf'), file('ok.png', 'image/png')]);
    });
    expect(r.added).toBe(1);
    expect(r.skipped).toEqual([{ name: 'doc.pdf', reason: 'unsupported type' }]);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].file.name).toBe('ok.png');
  });

  it('accepts webp as well as jpeg and png', () => {
    const { result } = setup();
    let r;
    act(() => {
      r = result.current.addFiles([file('w.webp', 'image/webp')]);
    });
    expect(r.added).toBe(1);
    expect(r.skipped).toEqual([]);
  });

  it('caps a single add at 50 files and skips the rest', () => {
    const { result } = setup();
    const files = Array.from({ length: 51 }, (_, i) => file(`img${i}.jpg`));
    let r;
    act(() => {
      r = result.current.addFiles(files);
    });
    expect(r.added).toBe(50);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toEqual({ name: 'img50.jpg', reason: 'limit 50 per add' });
    expect(result.current.items).toHaveLength(50);
  });

  it('auto-selects the first added item when nothing is selected', () => {
    const { result } = setup();
    act(() => {
      result.current.addFiles([file('a.jpg'), file('b.jpg')]);
    });
    expect(result.current.selectedId).toBe(result.current.items[0].id);
    expect(result.current.selected.file.name).toBe('a.jpg');
  });

  it('removing a processing item discards its late result and the next item starts', async () => {
    const { result, removeBg, pending } = setup();
    act(() => {
      result.current.addFiles([file('a.jpg'), file('b.jpg')]);
    });
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(1));
    const aId = result.current.items[0].id;

    act(() => {
      result.current.remove(aId);
    });

    // The in-flight request for a.jpg is aborted
    expect(removeBg.mock.calls[0][1]?.aborted).toBe(true);

    // Worker moves on to b.jpg
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(2));
    expect(removeBg.mock.calls[1][0].name).toBe('b.jpg');
    expect(result.current.items.map((i) => i.file.name)).toEqual(['b.jpg']);

    // Late result for the removed item must be ignored, not crash, not re-added
    await act(async () => {
      pending[0].resolve(blob('late'));
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].file.name).toBe('b.jpg');
    expect(result.current.items[0].resultBlob).toBeFalsy();
    expect(result.current.items.some((i) => i.id === aId)).toBe(false);
  });

  it('error then retry re-runs the item and completes it', async () => {
    const { result, removeBg, pending } = setup();
    const a = file('a.jpg');
    act(() => {
      result.current.addFiles([a]);
    });
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(1));
    const id = result.current.items[0].id;

    await act(async () => {
      pending[0].reject(new Error('Server error — try again'));
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('error'));
    expect(result.current.items[0].error).toBeTruthy();

    act(() => {
      result.current.retry(id);
    });
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(2));
    expect(removeBg.mock.calls[1][0]).toBe(a);

    await act(async () => {
      pending[1].resolve(blob('ok'));
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));
  });

  it('rerun clears resultBlob and editedBlob and re-processes', async () => {
    const { result, removeBg, pending } = setup();
    act(() => {
      result.current.addFiles([file('a.jpg')]);
    });
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(1));
    const id = result.current.items[0].id;

    await act(async () => {
      pending[0].resolve(blob('r'));
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));

    act(() => {
      result.current.setEdited(id, blob('edited'));
    });
    expect(result.current.items[0].editedBlob).toBeTruthy();

    act(() => {
      result.current.rerun(id);
    });

    expect(result.current.items[0].resultBlob).toBeFalsy();
    expect(result.current.items[0].editedBlob).toBeFalsy();
    await waitFor(() => expect(removeBg).toHaveBeenCalledTimes(2));
  });

  it('new items inherit the last bleed set via setBleed', () => {
    const { result } = setup();
    act(() => {
      result.current.addFiles([file('a.jpg')]);
    });
    expect(result.current.items[0].bleed).toEqual({ enabled: false, offsetMm: 3 });

    act(() => {
      result.current.setBleed(result.current.items[0].id, { enabled: true, offsetMm: 5 });
    });
    expect(result.current.items[0].bleed).toEqual({ enabled: true, offsetMm: 5 });

    act(() => {
      result.current.addFiles([file('b.jpg')]);
    });
    expect(result.current.items[1].bleed).toEqual({ enabled: true, offsetMm: 5 });
  });

  it('applyBleedToAll sets bleed on every item and on later additions', () => {
    const { result } = setup();
    act(() => {
      result.current.addFiles([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    });

    act(() => {
      result.current.applyBleedToAll({ enabled: true, offsetMm: 2 });
    });
    for (const item of result.current.items) {
      expect(item.bleed).toEqual({ enabled: true, offsetMm: 2 });
    }

    act(() => {
      result.current.addFiles([file('d.jpg')]);
    });
    expect(result.current.items[3].bleed).toEqual({ enabled: true, offsetMm: 2 });
  });

  it('removing the selected item selects a remaining neighbour', () => {
    const { result } = setup();
    act(() => {
      result.current.addFiles([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    });
    const [a, b, c] = result.current.items;

    act(() => {
      result.current.select(b.id);
    });
    expect(result.current.selectedId).toBe(b.id);

    act(() => {
      result.current.remove(b.id);
    });
    expect(result.current.items.map((i) => i.id)).not.toContain(b.id);
    expect([a.id, c.id]).toContain(result.current.selectedId);
  });
});
