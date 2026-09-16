import { useEffect, useCallback, useRef, useState } from 'react';
import { useCanvasEditor } from '../hooks/useCanvasEditor';
import Toolbar from './Toolbar';
import RightPanel from './RightPanel';
import './Editor.css';

const API = '';
const BLEED_DEBOUNCE_MS = 250;

function formatBleedSuffix(mm) {
  return `-bleed-${mm.toFixed(1).replace('.', '_')}mm`;
}

export default function Editor({ resultBlob, originalFile, onRerun }) {
  const {
    canvasRef,
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
  } = useCanvasEditor({ resultBlob, originalFile });

  const [bleedEnabled, setBleedEnabled] = useState(false);
  const [bleedOffsetMm, setBleedOffsetMm] = useState(3.0);
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
  }, [bleedEnabled, bleedOffsetMm, canvasRef]);

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
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      if (e.key === 'e') setTool('erase');
      if (e.key === 'r') setTool('restore');
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [undo, redo, setTool]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.1, Math.min(4, z - e.deltaY * 0.001)));
  }, [setZoom]);

  const toggleView = useCallback(() => {
    setViewMode((v) => v === 'result' ? 'original' : 'result');
  }, [setViewMode]);

  const handleDownload = useCallback(() => {
    const name = originalFile?.name || 'image.png';
    if (bleedEnabled && bleedBlob) {
      download(name, { blob: bleedBlob, suffix: formatBleedSuffix(bleedOffsetMm) });
    } else {
      download(name);
    }
  }, [download, originalFile, bleedEnabled, bleedBlob, bleedOffsetMm]);

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

      <div className="canvas-area" onWheel={handleWheel}>
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

        <div className="canvas-viewport">
          <div
            className={`canvas-scaler ${viewMode === 'split' ? 'split-mode' : ''}`}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
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
                style={{ cursor: 'crosshair' }}
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
