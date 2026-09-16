import { useRef } from 'react';
import './UploadZone.css';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export default function UploadZone({ onFile }) {
  const inputRef = useRef(null);

  function handleFile(file) {
    if (file && ACCEPTED.includes(file.type)) {
      onFile(file);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  function handleChange(e) {
    handleFile(e.target.files[0]);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload image — drag and drop or click to browse"
      className="upload-zone"
      data-testid="upload-zone"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <div className="upload-icon">🖼️</div>
      <p className="upload-title">Drag &amp; drop or click to browse</p>
      <p className="upload-sub">JPEG · PNG · WebP</p>
    </div>
  );
}
