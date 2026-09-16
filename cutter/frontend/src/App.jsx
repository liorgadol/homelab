import { useState, useCallback } from 'react';
import UploadZone from './components/UploadZone';
import Editor from './components/Editor';
import './App.css';

const API = '';

export default function App() {
  const [mode, setMode] = useState('upload'); // 'upload' | 'processing' | 'editing'
  const [originalFile, setOriginalFile] = useState(null);
  const [resultBlob, setResultBlob] = useState(null);
  const [error, setError] = useState(null);

  const handleFile = useCallback(async (file) => {
    setOriginalFile(file);
    setMode('processing');
    setError(null);

    const controller = new AbortController();
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API}/remove-bg`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status >= 500) throw new Error('Server error — try again');
        throw new Error(`Processing failed (${res.status})`);
      }
      const blob = await res.blob();
      if (!blob || blob.size === 0) throw new Error('Empty response from server');
      setResultBlob(blob);
      setMode('editing');
    } catch (err) {
      if (err.name === 'AbortError') return; // cancelled — ignore
      if (err instanceof TypeError) {
        setError('Cannot connect to backend — is it running?');
      } else {
        setError(err.message);
      }
      setMode('upload');
    }
  }, []);

  const handleNewImage = useCallback(() => {
    setMode('upload');
    setOriginalFile(null);
    setResultBlob(null);
    setError(null);
  }, []);

  const handleRerun = useCallback(async () => {
    if (!originalFile) return;
    await handleFile(originalFile);
  }, [originalFile, handleFile]);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">✂️</span>
        <h1 className="app-title">Cutter</h1>
        <span className="app-subtitle">Background Remover for Cricut</span>
        {mode === 'editing' && (
          <button className="new-image-btn" onClick={handleNewImage}>
            + New Image
          </button>
        )}
      </header>

      <main className="app-main">
        {mode === 'upload' && (
          <div className="upload-page">
            {error && <div className="error-banner" role="alert" aria-live="assertive">⚠️ {error}</div>}
            <UploadZone onFile={handleFile} />
          </div>
        )}

        {mode === 'processing' && (
          <div className="processing-page" data-testid="processing-spinner" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <p>Removing background…</p>
            <p className="processing-sub">First run downloads the AI model (~170 MB)</p>
          </div>
        )}

        {mode === 'editing' && (
          <div className="editor-page" data-testid="editor-container">
            <Editor
              resultBlob={resultBlob}
              originalFile={originalFile}
              onRerun={handleRerun}
            />
          </div>
        )}
      </main>
    </div>
  );
}
