import { useState, useRef, useCallback, useEffect } from 'react';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PER_ADD = 50;
const DEFAULT_BLEED = { enabled: false, offsetMm: 3 };

let counter = 0;
function newId() {
  counter += 1;
  return `q${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useQueue({ removeBg }) {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const lastBleed = useRef(DEFAULT_BLEED);
  const controllers = useRef(new Map()); // id -> { controller, token }
  const tokenSeq = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const update = useCallback((id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  // Worker: start next waiting item when none is processing.
  useEffect(() => {
    if (items.some((it) => it.status === 'processing')) return;
    const next = items.find((it) => it.status === 'waiting');
    if (!next) return;
    const controller = new AbortController();
    tokenSeq.current += 1;
    const token = tokenSeq.current;
    controllers.current.set(next.id, { controller, token });
    setItems((prev) =>
      prev.map((it) => (it.id === next.id ? { ...it, status: 'processing', error: null } : it)),
    );
    const isCurrent = () => controllers.current.get(next.id)?.token === token;
    Promise.resolve()
      .then(() => removeBg(next.file, controller.signal))
      .then(
        (blob) => {
          if (!isCurrent()) return;
          controllers.current.delete(next.id);
          setItems((prev) =>
            prev.map((it) =>
              it.id === next.id && it.status === 'processing'
                ? { ...it, status: 'done', resultBlob: blob }
                : it,
            ),
          );
        },
        (err) => {
          if (!isCurrent()) return;
          controllers.current.delete(next.id);
          if (err?.name === 'AbortError') return;
          setItems((prev) =>
            prev.map((it) =>
              it.id === next.id && it.status === 'processing'
                ? { ...it, status: 'error', error: err?.message || 'Processing failed' }
                : it,
            ),
          );
        },
      );
  }, [items, removeBg]);

  useEffect(
    () => () => {
      controllers.current.forEach(({ controller }) => controller.abort());
      controllers.current.clear();
    },
    [],
  );

  const addFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    const skipped = [];
    const accepted = [];
    for (const file of files) {
      if (!ACCEPTED.includes(file.type)) {
        skipped.push({ name: file.name, reason: 'unsupported type' });
      } else if (accepted.length >= MAX_PER_ADD) {
        skipped.push({ name: file.name, reason: 'limit 50 per add' });
      } else {
        accepted.push(file);
      }
    }
    if (accepted.length) {
      const created = accepted.map((file) => ({
        id: newId(),
        file,
        status: 'waiting',
        resultBlob: null,
        editedBlob: null,
        bleed: { ...lastBleed.current },
        error: null,
      }));
      setItems((prev) => [...prev, ...created]);
      if (selectedRef.current == null) {
        selectedRef.current = created[0].id;
        setSelectedId(created[0].id);
      }
    }
    return { added: accepted.length, skipped };
  }, []);

  const select = useCallback((id) => setSelectedId(id), []);

  const remove = useCallback((id) => {
    const entry = controllers.current.get(id);
    if (entry) {
      entry.controller.abort();
      controllers.current.delete(id);
    }
    const prev = itemsRef.current;
    const idx = prev.findIndex((it) => it.id === id);
    if (idx === -1) return;
    const rest = prev.filter((it) => it.id !== id);
    if (selectedRef.current === id) {
      const neighbour = rest[idx] ?? rest[idx - 1] ?? null;
      selectedRef.current = neighbour ? neighbour.id : null;
      setSelectedId(selectedRef.current);
    }
    itemsRef.current = rest;
    setItems(rest);
  }, []);

  const rerun = useCallback((id) => {
    const entry = controllers.current.get(id);
    if (entry) {
      entry.controller.abort();
      controllers.current.delete(id); // invalidates in-flight token
    }
    update(id, { status: 'waiting', resultBlob: null, editedBlob: null, error: null });
  }, [update]);

  const retry = useCallback((id) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id && it.status === 'error' ? { ...it, status: 'waiting', error: null } : it)),
    );
  }, []);

  const setEdited = useCallback((id, blob) => update(id, { editedBlob: blob }), [update]);

  const setBleed = useCallback((id, bleed) => {
    lastBleed.current = { ...bleed };
    update(id, { bleed: { ...bleed } });
  }, [update]);

  const applyBleedToAll = useCallback((bleed) => {
    lastBleed.current = { ...bleed };
    setItems((prev) => prev.map((it) => ({ ...it, bleed: { ...bleed } })));
  }, []);

  const selected = items.find((it) => it.id === selectedId) ?? null;

  return {
    items, selectedId, selected, select, addFiles, remove, retry, rerun,
    setEdited, setBleed, applyBleedToAll,
  };
}

export default useQueue;
