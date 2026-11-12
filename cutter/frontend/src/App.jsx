import { useState, useCallback, useRef } from 'react';
import UploadZone from './components/UploadZone';
import QueueStrip from './components/QueueStrip';
import Editor from './components/Editor';
import { useQueue } from './queue/useQueue';
import { buildZip, zipName } from './queue/zipAll';
import { removeBg, addBleed } from './api';
import './App.css';

function summarizeSkipped(skipped) {
  const groups = new Map();
  for (const s of skipped) groups.set(s.reason, (groups.get(s.reason) || 0) + 1);
  return [...groups.entries()]
    .map(([reason, n]) => `${n} file${n === 1 ? '' : 's'} skipped: ${reason}`)
    .join('; ');
}

export default function App() {
  const q = useQueue({ removeBg });
  const { items, selected, selectedId, select, addFiles, remove, retry, rerun, setEdited, setBleed, applyBleedToAll } = q;
  const [skippedMsg, setSkippedMsg] = useState(null);
  const [zipError, setZipError] = useState(null);
  const [zipInfo, setZipInfo] = useState(null);
  const [zipProgress, setZipProgress] = useState(null); // { n, m } | null
  const addInputRef = useRef(null);

  const handleAdd = useCallback((files) => {
    const { skipped } = addFiles(files);
    setSkippedMsg(skipped.length ? summarizeSkipped(skipped) : null);
  }, [addFiles]);

  const handleDownloadAll = useCallback(async () => {
    setZipError(null);
    setZipInfo(null);
    setZipProgress({ n: 0, m: items.filter((it) => it.status === 'done').length });
    try {
      const { blob, skipped } = await buildZip(items, {
        addBleed,
        onProgress: (n, m) => setZipProgress({ n, m }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName(new Date());
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (skipped && skipped.length) setZipInfo(`Skipped (not ready): ${skipped.join(', ')}`);
    } catch (err) {
      setZipError(err?.message || 'Download failed');
    } finally {
      setZipProgress(null);
    }
  }, [items]);

  const handleRerun = useCallback(() => {
    if (!selected) return;
    if (selected.editedBlob && !window.confirm('Discard edits and re-run AI?')) return;
    rerun(selected.id);
  }, [selected, rerun]);

  const handleClearAll = useCallback(() => {
    if (!window.confirm('Remove all images?')) return;
    items.forEach((it) => remove(it.id));
  }, [items, remove]);

  const doneCount = items.filter((it) => it.status === 'done').length;
  const zipping = zipProgress !== null;

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">✂️</span>
        <h1 className="app-title">Cutter</h1>
        <span className="app-subtitle">Background Remover for Cricut</span>
        {items.length > 0 && (
          <div className="header-actions">
            <input
              ref={addInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              hidden
              data-testid="add-input"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length) handleAdd(files);
                e.target.value = '';
              }}
            />
            <button className="new-image-btn" onClick={() => addInputRef.current?.click()}>
              + Add
            </button>
            <button className="new-image-btn" onClick={handleClearAll}>Clear all</button>
            <button
              className="new-image-btn download-all-btn"
              onClick={handleDownloadAll}
              disabled={doneCount < 1 || zipping}
            >
              {zipping ? `Preparing ${zipProgress.n}/${zipProgress.m}` : '⬇ Download all'}
            </button>
          </div>
        )}
      </header>

      {skippedMsg && (
        <div className="info-banner" role="status">
          <span>{skippedMsg}</span>
          <button className="banner-close" aria-label="Dismiss" onClick={() => setSkippedMsg(null)}>×</button>
        </div>
      )}
      {zipInfo && (
        <div className="info-banner" role="status">
          <span>{zipInfo}</span>
          <button className="banner-close" aria-label="Dismiss" onClick={() => setZipInfo(null)}>×</button>
        </div>
      )}
      {zipError && (
        <div className="error-banner banner-row" role="alert" aria-live="assertive">
          <span>⚠️ {zipError}</span>
          <button className="banner-close" aria-label="Dismiss" onClick={() => setZipError(null)}>×</button>
        </div>
      )}

      {items.length > 1 && (
        <QueueStrip
          items={items}
          selectedId={selectedId}
          onSelect={select}
          onRemove={remove}
          onRetry={retry}
          onAdd={handleAdd}
        />
      )}

      <main className="app-main">
        {items.length === 0 && (
          <div className="upload-page">
            <UploadZone onFiles={handleAdd} />
          </div>
        )}

        {selected && (selected.status === 'waiting' || selected.status === 'processing') && (
          <div className="processing-page" data-testid="processing-spinner" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <p>Removing background…</p>
          </div>
        )}

        {selected && selected.status === 'error' && (
          <div className="processing-page" data-testid="item-error">
            <div className="error-banner" role="alert" aria-live="assertive">⚠️ {selected.error}</div>
            <button className="new-image-btn" onClick={() => retry(selected.id)}>Retry</button>
          </div>
        )}

        {selected && selected.status === 'done' && (
          <div className="editor-page" data-testid="editor-container">
            <Editor
              key={selected.id}
              sourceBlob={selected.editedBlob ?? selected.resultBlob}
              originalFile={selected.file}
              bleed={selected.bleed}
              onBleedChange={(b) => setBleed(selected.id, b)}
              onEdited={(blob) => setEdited(selected.id, blob)}
              onRerun={handleRerun}
              onApplyBleedToAll={items.length > 1 ? applyBleedToAll : undefined}
            />
          </div>
        )}
      </main>
    </div>
  );
}
