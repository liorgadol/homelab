import { describe, it, expect, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { buildZip, uniqueName, outputName, zipName } from '../queue/zipAll';

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

// jsdom Blob may not expose arrayBuffer(); read through FileReader instead.
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

const blob = (text) => new Blob([text], { type: 'image/png' });
const file = (name) => new File(['x'], name, { type: 'image/jpeg' });

describe('zipName', () => {
  it('formats local time as cutter-YYYYMMDD-HHMM.zip', () => {
    expect(zipName(new Date(2026, 10, 12, 9, 5))).toBe('cutter-20261112-0905.zip');
  });
});

describe('outputName', () => {
  it('uses bleed suffix when bleed is enabled', () => {
    expect(outputName({ name: 'cat.jpg' }, { enabled: true, offsetMm: 3 })).toBe(
      'cat-bleed-3_0mm.png',
    );
  });

  it('uses nobg name when bleed is disabled', () => {
    expect(outputName({ name: 'cat.jpg' }, { enabled: false, offsetMm: 3 })).toBe('cat-nobg.png');
  });
});

describe('uniqueName', () => {
  it('suffixes duplicate names with -2, -3', () => {
    const used = new Set();
    const names = [];
    for (let i = 0; i < 3; i++) {
      const n = uniqueName('cat-nobg.png', used);
      used.add(n);
      names.push(n);
    }
    expect(names).toEqual(['cat-nobg.png', 'cat-nobg-2.png', 'cat-nobg-3.png']);
  });
});

describe('buildZip', () => {
  it('zips only done items, skips the waiting one, bleeds only bleed-enabled items', async () => {
    const addBleed = vi.fn(async () => blob('bled-cat'));
    const onProgress = vi.fn();
    const items = [
      {
        id: '1',
        file: file('cat.jpg'),
        status: 'done',
        resultBlob: blob('r1'),
        editedBlob: null,
        bleed: { enabled: true, offsetMm: 3 },
      },
      {
        id: '2',
        file: file('dog.jpg'),
        status: 'done',
        resultBlob: blob('r2'),
        editedBlob: blob('e2'),
        bleed: { enabled: false, offsetMm: 3 },
      },
      {
        id: '3',
        file: file('bird.jpg'),
        status: 'waiting',
        resultBlob: null,
        editedBlob: null,
        bleed: { enabled: true, offsetMm: 3 },
      },
    ];

    const result = await buildZip(items, { addBleed, onProgress });

    expect(result.skipped).toEqual(['bird.jpg']);

    // addBleed only for the done, bleed-enabled item, using resultBlob (no edit)
    expect(addBleed).toHaveBeenCalledTimes(1);
    expect(addBleed.mock.calls[0][0]).toBe(items[0].resultBlob);
    expect(addBleed.mock.calls[0][1]).toBe(3);

    expect(onProgress).toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);

    const entries = unzipSync(await readBytes(result.blob));
    const names = Object.keys(entries).sort();
    expect(names).toHaveLength(2);
    expect(names).toEqual(['cat-bleed-3_0mm.png', 'dog-nobg.png']);
    expect(await readText(new Blob([entries['cat-bleed-3_0mm.png']]))).toBe('bled-cat');
    expect(await readText(new Blob([entries['dog-nobg.png']]))).toBe('e2');
  });

  it('passes editedBlob (not resultBlob) to addBleed when an edit exists', async () => {
    const addBleed = vi.fn(async () => blob('bled'));
    const edited = blob('edited');
    const items = [
      {
        id: '1',
        file: file('cat.jpg'),
        status: 'done',
        resultBlob: blob('r1'),
        editedBlob: edited,
        bleed: { enabled: true, offsetMm: 2 },
      },
    ];

    await buildZip(items, { addBleed, onProgress: () => {} });

    expect(addBleed).toHaveBeenCalledTimes(1);
    expect(addBleed.mock.calls[0][0]).toBe(edited);
  });

  it('rejects with an error naming the file when addBleed fails', async () => {
    const addBleed = vi.fn(async () => {
      throw new Error('Bleed failed (500)');
    });
    const items = [
      {
        id: '1',
        file: file('cat.jpg'),
        status: 'done',
        resultBlob: blob('r1'),
        editedBlob: null,
        bleed: { enabled: true, offsetMm: 3 },
      },
    ];

    await expect(buildZip(items, { addBleed, onProgress: () => {} })).rejects.toThrow(/cat\.jpg/);
  });
});
