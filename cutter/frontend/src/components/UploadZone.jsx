import { useRef } from 'react';
import './UploadZone.css';

export default function UploadZone({ onFiles }) {
  const inputRef = useRef(null);

  function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length > 0) onFiles(files);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  function handleChange(e) {
    handleFiles(e.target.files);
    e.target.value = '';
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
        multiple
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <div className="upload-icon">🖼️</div>
      <p className="upload-title">Drag &amp; drop or click to browse</p>
      <p className="upload-sub">JPEG · PNG · WebP · multiple files allowed</p>
    </div>
  );
}
