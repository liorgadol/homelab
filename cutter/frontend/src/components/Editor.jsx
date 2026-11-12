import { useEffect, useCallback, useRef, useState } from 'react';
import { useCanvasEditor } from '../hooks/useCanvasEditor';
import Toolbar from './Toolbar';
import RightPanel from './RightPanel';
import { addBleed } from '../api';
import './Editor.css';

const API = '';
const SAVE_DEBOUNCE_MS = 300;
const BLEED_DEBOUNCE_MS = 250;

function formatBleedSuffix(mm) {
  return `-bleed-${mm.toFixed(1).replace('.', '_')}mm`;
}

export default function Editor({
  sourceBlob, originalFile, bleed, onBleedChange, onEdited, onRerun, onRerunHigh, onApplyBleedToAll,
}) {
  // Captured once: Editor is keyed by item id, and our own onEdited must not reload the canvas.
  const [initialSource] = useState(() => sourceBlob);
  const bleedEnabled = !!bleed?.enabled;
  const bleedOffsetMm = bleed?.offsetMm ?? 3.0;
  const setBleedEnabled = useCallback(
    (enabled) => onBleedChange?.({ enabled, offsetMm: bleedOffsetMm }),
    [onBleedChange, bleedOffsetMm],
  );
  const setBleedOffsetMm = useCallback(
    (offsetMm) => onBleedChange?.({ enabled: bleedEnabled, offsetMm }),
    [onBleedChange, bleedEnabled],
  );
  const {
    canvasRef,
    viewportRef,
    editVersion,
    pan,
    spaceHeld,
    setSpaceHeld,
    isPanning,
    originalUrl,
    brushSize, setBrushSize,
    brushOpacity, setBrushOpacity,
    tool, setTool,
    viewMode, setViewMode,
    dimensions,
    zoom, setZoom,
    startDrawing, stopDrawing, doPaint,
    undo, redo,
    fitToScreen,
    download,
  } = useCanvasEditor({ resultBlob: initialSource, originalFile });

  const [bleedBlob, setBleedBlob] = useState(null);
  const [bleedPaddingPx, setBleedPaddingPx] = useState(0);
  const [bleedUrl, setBleedUrl] = useState(null);
  const [bleedLoading, setBleedLoading] = useState(false);
  const [bleedError, setBleedError] = useState(null);

  const bleedAbortRef = useRef(null);
  const bleedDebounceRef = useRef(null);

  useEffect(() => {
    if (!bleedEnabled) {
      setBleedBlob(null);
      setBleedError(null);
      setBleedLoading(false);
      if (bleedAbortRef.current) bleedAbortRef.current.abort();
      return;
    }
    if (bleedDebounceRef.current) clearTimeout(bleedDebounceRef.current);
    bleedDebounceRef.current = setTimeout(async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;

      if (bleedAbortRef.current) bleedAbortRef.current.abort();
      const controller = new AbortController();
      bleedAbortRef.current = controller;

      const form = new FormData();
      form.append('file', blob, 'edited.png');
      setBleedLoading(true);
      setBleedError(null);
      try {
        const res = await fetch(`${API}/add-bleed?offset_mm=${bleedOffsetMm}`, {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Bleed failed (${res.status})`);
        const padding = Number(res.headers.get('x-bleed-px') || '0');
        const outBlob = await res.blob();
        setBleedBlob(outBlob);
        setBleedPaddingPx(padding);
        setBleedLoading(false);
      } catch (err) {
        if (err.name === 'AbortError') return;
        setBleedError(err.message || 'Bleed failed');
        setBleedLoading(false);
      }
    }, BLEED_DEBOUNCE_MS);

    return () => { if (bleedDebounceRef.current) clearTimeout(bleedDebounceRef.current); };
  }, [bleedEnabled, bleedOffsetMm, canvasRef, editVersion]);

  // Persist edits: debounce after user edit/undo/redo (editVersion 1 is the initial load).
  const onEditedRef = useRef(onEdited);
  onEditedRef.current = onEdited;
  const saveTimerRef = useRef(null);
  const savePendingRef = useRef(false);
  const canvasElRef = useRef(null);

  useEffect(() => {
    canvasElRef.current = canvasRef.current;
  }, [canvasRef]);

  useEffect(() => {
    if (editVersion <= 1) return;
    savePendingRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      savePendingRef.current = false;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.toBlob((blob) => { if (blob) onEditedRef.current?.(blob); }, 'image/png');
    }, SAVE_DEBOUNCE_MS);
  }, [editVersion, canvasRef]);

  // Flush pending save on unmount (toBlob is started synchronously).
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    if (!savePendingRef.current) return;
    savePendingRef.current = false;
    const canvas = canvasElRef.current;
    if (canvas) canvas.toBlob((blob) => { if (blob) onEditedRef.current?.(blob); }, 'image/png');
  }, []);

  useEffect(() => {
    if (!bleedBlob) {
      setBleedUrl(null);
      return;
    }
    const url = URL.createObjectURL(bleedBlob);
    setBleedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bleedBlob]);

  useEffect(() => {
    const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    function handleKey(e) {
      const key = (e.key || '').toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === ' ' || e.code === 'Space') {
        if (isTyping(e.target) || (e.target?.tagName === 'BUTTON')) return;
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && key === 'y') { e.preventDefault(); redo(); return; }
      if (mod || e.altKey || isTyping(e.target)) return;
      if (key === 'e') setTool('erase');
      if (key === 'r') setTool('restore');
    }
    function handleKeyUp(e) {
      if (e.key === ' ' || e.code === 'Space') setSpaceHeld(false);
    }
    function handleBlur() { setSpaceHeld(false); }
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [undo, redo, setTool, setSpaceHeld]);

  const canvasAreaRef = useRef(null);
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      setZoom((z) => Math.max(0.1, Math.min(4, z - e.deltaY * 0.001)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  const toggleView = useCallback(() => {
    setViewMode((v) => v === 'result' ? 'original' : 'result');
  }, [setViewMode]);

  const handleDownload = useCallback(async () => {
    const name = originalFile?.name || 'image.png';
    if (!bleedEnabled) {
      download(name);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not read canvas');
      const outBlob = await addBleed(blob, bleedOffsetMm);
      download(name, { blob: outBlob, suffix: formatBleedSuffix(bleedOffsetMm) });
    } catch (err) {
      setBleedError(err.message || 'Bleed failed');
    }
  }, [download, originalFile, bleedEnabled, bleedOffsetMm, canvasRef]);

  return (
    <div className="editor">
      <Toolbar
        tool={tool}
        onToolChange={setTool}
        onUndo={undo}
        onRedo={redo}
        onFitToScreen={fitToScreen}
        onToggleView={toggleView}
      />

      <div className="canvas-area" ref={canvasAreaRef}>
        <div className="view-chips">
          {['result', 'original', 'split'].map((m) => (
            <button
              key={m}
              className={`view-chip ${viewMode === m ? 'active' : ''}`}
              onClick={() => setViewMode(m)}
              aria-pressed={viewMode === m}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        <div className="canvas-viewport" ref={viewportRef}>
          <div
            className={`canvas-scaler ${viewMode === 'split' ? 'split-mode' : ''}`}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }}
          >
            {originalUrl && (viewMode === 'original' || viewMode === 'split') && (
              <div className={viewMode === 'split' ? 'split-pane' : ''}>
                {viewMode === 'split' && <div className="split-label">Original</div>}
                <img src={originalUrl} alt="Original" className="original-img" />
              </div>
            )}

            {/* Canvas — ALWAYS mounted, hidden only in 'original' mode */}
            <div className={`${viewMode === 'split' ? 'split-pane' : ''} ${viewMode === 'original' ? 'canvas-hidden' : ''} canvas-stack`}>
              {viewMode === 'split' && <div className="split-label">Result</div>}
              {bleedEnabled && bleedUrl && viewMode !== 'original' && (
                <img
                  src={bleedUrl}
                  alt=""
                  aria-hidden="true"
                  className="bleed-layer"
                  style={{
                    top: `${-bleedPaddingPx}px`,
                    left: `${-bleedPaddingPx}px`,
                  }}
                />
              )}
              <canvas
                ref={canvasRef}
                className="editor-canvas"
                role="img"
                aria-label={`Canvas editor for ${originalFile?.name || 'image'}`}
                style={{ cursor: isPanning ? 'grabbing' : spaceHeld ? 'grab' : 'crosshair' }}
                onMouseDown={startDrawing}
                onMouseMove={doPaint}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
              />
            </div>
          </div>
        </div>

        <div className="zoom-controls">
          <button className="zoom-btn" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))} aria-label="Zoom out">−</button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="zoom-btn" onClick={() => setZoom((z) => Math.min(4, z + 0.1))} aria-label="Zoom in">+</button>
        </div>
      </div>

      <RightPanel
        tool={tool}
        onToolChange={setTool}
        brushSize={brushSize}
        onBrushSizeChange={setBrushSize}
        brushOpacity={brushOpacity}
        onBrushOpacityChange={setBrushOpacity}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filename={originalFile?.name || 'image'}
        dimensions={dimensions}
        onDownload={handleDownload}
        onRerun={onRerun}
        onRerunHigh={onRerunHigh}
        onApplyBleedToAll={onApplyBleedToAll ? () => onApplyBleedToAll({ enabled: bleedEnabled, offsetMm: bleedOffsetMm }) : undefined}
        bleedEnabled={bleedEnabled}
        onBleedEnabledChange={setBleedEnabled}
        bleedOffsetMm={bleedOffsetMm}
        onBleedOffsetMmChange={setBleedOffsetMm}
        bleedLoading={bleedLoading}
        bleedError={bleedError}
      />
    </div>
  );
}
