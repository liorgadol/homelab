const API = '';

async function request(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('Cannot connect to backend — is it running?');
    }
    throw err;
  }
}

export async function removeBg(file, signal) {
  const form = new FormData();
  form.append('file', file);
  const res = await request(`${API}/remove-bg`, { method: 'POST', body: form, signal });
  if (!res.ok) {
    if (res.status >= 500) throw new Error('Server error — try again');
    throw new Error(`Processing failed (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob || blob.size === 0) throw new Error('Empty response from server');
  return blob;
}

export async function addBleed(blob, offsetMm, signal) {
  const form = new FormData();
  form.append('file', blob, 'edited.png');
  const res = await request(`${API}/add-bleed?offset_mm=${offsetMm}`, {
    method: 'POST',
    body: form,
    signal,
  });
  if (!res.ok) throw new Error(`Bleed failed (${res.status})`);
  return res.blob();
}
