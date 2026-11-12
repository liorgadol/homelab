import { zipSync } from 'fflate';

function formatBleedSuffix(mm) {
  return `-bleed-${mm.toFixed(1).replace('.', '_')}mm`;
}

function baseName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function readBuffer(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export function uniqueName(name, used) {
  let candidate = name;
  if (used.has(candidate)) {
    const i = name.lastIndexOf('.');
    const stem = i > 0 ? name.slice(0, i) : name;
    const ext = i > 0 ? name.slice(i) : '';
    let n = 2;
    do {
      candidate = `${stem}-${n}${ext}`;
      n += 1;
    } while (used.has(candidate));
  }
  used.add(candidate);
  return candidate;
}

export function outputName(file, bleed) {
  const base = baseName(file.name);
  const suffix = bleed?.enabled ? formatBleedSuffix(bleed.offsetMm) : '-nobg';
  return `${base}${suffix}.png`;
}

export function zipName(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `cutter-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.zip`;
}

export async function buildZip(items, { addBleed, onProgress } = {}) {
  const done = items.filter((it) => it.status === 'done');
  const skipped = items.filter((it) => it.status !== 'done').map((it) => it.file.name);
  const used = new Set();
  const files = {};
  let count = 0;
  onProgress?.(0, done.length);
  for (const item of done) {
    const source = item.editedBlob ?? item.resultBlob;
    let out = source;
    if (item.bleed?.enabled) {
      try {
        out = await addBleed(source, item.bleed.offsetMm);
      } catch (err) {
        throw new Error(`${item.file.name}: ${err.message}`);
      }
    }
    const name = uniqueName(outputName(item.file, item.bleed), used);
    files[name] = new Uint8Array(await readBuffer(out));
    count += 1;
    onProgress?.(count, done.length);
  }
  const zipped = zipSync(files, { level: 0 });
  return { blob: new Blob([zipped], { type: 'application/zip' }), skipped };
}
