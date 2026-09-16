import './RightPanel.css';

const VIEW_MODES = ['result', 'original', 'split'];
const VIEW_LABELS = { result: 'Result', original: 'Original', split: 'Split' };

export default function RightPanel({
  tool, onToolChange,
  brushSize, onBrushSizeChange,
  brushOpacity, onBrushOpacityChange,
  viewMode, onViewModeChange,
  filename, dimensions,
  onDownload, onRerun,
  bleedEnabled = false, onBleedEnabledChange,
  bleedOffsetMm = 3.0, onBleedOffsetMmChange,
  bleedLoading = false, bleedError = null,
}) {
  return (
    <div className="right-panel">
      <div className="panel-section">
        <div className="panel-label">Brush Mode</div>
        <div className="mode-toggle">
          <button
            className={`mode-btn ${tool === 'erase' ? 'active' : ''}`}
            onClick={() => onToolChange('erase')}
          >
            🖌️ Erase
          </button>
          <button
            className={`mode-btn ${tool === 'restore' ? 'active' : ''}`}
            onClick={() => onToolChange('restore')}
          >
            ✨ Restore
          </button>
        </div>
      </div>

      <div className="panel-section">
        <label className="panel-label" htmlFor="brush-size">
          Brush Size — {brushSize}px
        </label>
        <input
          id="brush-size"
          type="range"
          min={5}
          max={100}
          value={brushSize}
          onChange={(e) => onBrushSizeChange(Number(e.target.value))}
          className="slider"
        />
      </div>

      <div className="panel-section">
        <label className="panel-label" htmlFor="brush-opacity">
          Opacity — {Math.round(brushOpacity * 100)}%
        </label>
        <input
          id="brush-opacity"
          type="range"
          min={10}
          max={100}
          value={Math.round(brushOpacity * 100)}
          onChange={(e) => onBrushOpacityChange(Number(e.target.value) / 100)}
          className="slider"
        />
      </div>

      <div className="panel-section">
        <div className="panel-label">View</div>
        <div className="view-tabs">
          {VIEW_MODES.map((m) => (
            <button
              key={m}
              className={`view-tab ${viewMode === m ? 'active' : ''}`}
              onClick={() => onViewModeChange(m)}
            >
              {VIEW_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-label">Cut Outline</div>
        <label className="bleed-toggle">
          <input
            type="checkbox"
            checked={!!bleedEnabled}
            onChange={(e) => onBleedEnabledChange(e.target.checked)}
            aria-label="Add white bleed"
          />
          <span>Add white bleed</span>
        </label>
        <label className="panel-label" htmlFor="bleed-offset">
          Offset — {bleedOffsetMm.toFixed(1)} mm
        </label>
        <input
          id="bleed-offset"
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={bleedOffsetMm}
          disabled={!bleedEnabled}
          onChange={(e) => onBleedOffsetMmChange(Number(e.target.value))}
          className="slider"
          aria-label="Offset"
        />
        {bleedLoading && (
          <div className="bleed-status" data-testid="bleed-spinner" role="status" aria-live="polite">
            <span className="bleed-spinner" aria-hidden="true" /> Computing bleed…
          </div>
        )}
        {bleedError && (
          <div className="bleed-error" role="alert" aria-live="assertive">⚠️ {bleedError}</div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-label">File Info</div>
        <div className="file-info">
          <div className="filename">{filename}</div>
          {dimensions.width > 0 && dimensions.height > 0 && (
            <div className="dimensions">{dimensions.width} × {dimensions.height} px</div>
          )}
        </div>
      </div>

      <div className="panel-actions">
        <button className="rerun-btn" onClick={onRerun}>↺ Re-run AI</button>
        <button className="download-btn" onClick={onDownload}>⬇ Download PNG</button>
      </div>
    </div>
  );
}
