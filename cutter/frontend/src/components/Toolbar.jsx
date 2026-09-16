import './Toolbar.css';

const TOOLS = [
  { id: 'erase', icon: '🖌️', label: 'Erase' },
  { id: 'restore', icon: '✨', label: 'Restore' },
];

export default function Toolbar({ tool, onToolChange, onUndo, onRedo, onFitToScreen, onToggleView }) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Editor tools">
      {TOOLS.map(({ id, icon, label }) => (
        <button
          key={id}
          className={`tool-btn ${tool === id ? 'active' : ''}`}
          onClick={() => onToolChange(id)}
          title={label}
          aria-pressed={tool === id}
        >
          <span>{icon}</span>
        </button>
      ))}

      <div className="toolbar-divider" role="separator" aria-orientation="horizontal" />

      <button className="tool-btn" onClick={onUndo} title="Undo" aria-label="Undo">
        <span>↩️</span>
      </button>
      <button className="tool-btn" onClick={onRedo} title="Redo" aria-label="Redo">
        <span>↪️</span>
      </button>

      <div className="toolbar-divider" role="separator" aria-orientation="horizontal" />

      <button className="tool-btn" onClick={onToggleView} title="Toggle before/after" aria-label="Toggle before/after">
        <span>👁️</span>
      </button>
      <button className="tool-btn" onClick={onFitToScreen} title="Fit to screen" aria-label="Fit to screen">
        <span>⊡</span>
      </button>
    </div>
  );
}
