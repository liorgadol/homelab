import { useEffect, useRef, useState } from 'react';
import './QueueStrip.css';

const STATUS_LABEL = {
  waiting: 'waiting',
  processing: 'removing background',
  done: 'done',
  error: 'failed',
};
const STATUS_GLYPH = { waiting: '…', processing: '⟳', done: '✓', error: '!' };

function QueueItem({ item, selected, onSelect, onRemove, onRetry }) {
  const [url, setUrl] = useState(null);
  const { file } = item;

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const label = STATUS_LABEL[item.status];

  return (
    <div
      className={`queue-item queue-${item.status}${selected ? ' selected' : ''}`}
      data-testid="queue-item"
    >
      <button
        type="button"
        className="queue-thumb"
        aria-current={selected ? 'true' : undefined}
        aria-label={`Select ${file.name}`}
        title={file.name}
        onClick={() => onSelect(item.id)}
      >
        {url && <img src={url} alt="" draggable={false} />}
      </button>
      <span className={`queue-badge ${item.status}`} aria-label={label} role="img">
        {STATUS_GLYPH[item.status]}
      </span>
      <button
        type="button"
        className="queue-remove"
        aria-label={`Remove ${file.name}`}
        onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
      >
        ×
      </button>
      {item.status === 'error' && (
        <button
          type="button"
          className="queue-retry"
          aria-label={`Retry ${file.name}`}
          onClick={(e) => { e.stopPropagation(); onRetry(item.id); }}
        >
          ↻
        </button>
      )}
    </div>
  );
}

export default function QueueStrip({ items, selectedId, onSelect, onRemove, onRetry, onAdd }) {
  const inputRef = useRef(null);

  function handleChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) onAdd(files);
    e.target.value = '';
  }

  return (
    <div className="queue-strip" data-testid="queue-strip">
      {items.map((item) => (
        <QueueItem
          key={item.id}
          item={item}
          selected={item.id === selectedId}
          onSelect={onSelect}
          onRemove={onRemove}
          onRetry={onRetry}
        />
      ))}
      <button
        type="button"
        className="queue-add"
        onClick={() => inputRef.current?.click()}
      >
        + Add
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        data-testid="queue-add-input"
        onChange={handleChange}
      />
    </div>
  );
}
