import { useRef, useCallback, useState, useEffect } from 'react';
import { paintPixels } from './paintPixels';

export function useCanvasEditor({ resultBlob, originalFile }) {
  const canvasRef = useRef(null);
  const resultImageDataRef = useRef(null);   // AI result — never mutated
  const currentImageDataRef = useRef(null);  // working copy
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const isDrawingRef = useRef(false);

  const [brushSize, setBrushSize] = useState(20);
  const [brushOpacity, setBrushOpacity] = useState(0.8);
  const [tool, setTool] = useState('erase');
  const [viewMode, setViewMode] = useState('result');
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [originalUrl, setOriginalUrl] = useState(null);

  // Load result blob into canvas whenever it changes
  useEffect(() => {
    if (!resultBlob || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const img = new Image();
    const url = URL.createObjectURL(resultBlob);
    let revoked = false;
    const revoke = () => { if (!revoked) { revoked = true; URL.revokeObjectURL(url); } };

    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resultImageDataRef.current = imageData;
      currentImageDataRef.current = new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height,
      );
      undoStackRef.current = [];
      redoStackRef.current = [];
      revoke();
    };
    img.onerror = revoke;
    img.src = url;
    return revoke; // safety net on unmount
  }, [resultBlob]);

  // Keep original image URL in sync (use state so img tag re-renders)
  useEffect(() => {
    const url = originalFile ? URL.createObjectURL(originalFile) : null;
    setOriginalUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [originalFile]);

  const pushUndo = useCallback(() => {
    const current = currentImageDataRef.current;
    if (!current) return;
    undoStackRef.current = [
      ...undoStackRef.current.slice(-19),
      new ImageData(new Uint8ClampedArray(current.data), current.width, current.height),
    ];
    redoStackRef.current = [];
  }, []);

  const getCursorPos = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }, []);

  const doPaint = useCallback(
    (e) => {
      if (!isDrawingRef.current || !canvasRef.current || !currentImageDataRef.current || !resultImageDataRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const { x, y } = getCursorPos(e);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      paintPixels(
        imageData.data,
        resultImageDataRef.current.data,
        canvas.width,
        canvas.height,
        x,
        y,
        brushSize,
        brushOpacity,
        tool,
      );
      ctx.putImageData(imageData, 0, 0);
      currentImageDataRef.current = imageData;
    },
    [brushSize, brushOpacity, tool, getCursorPos],
  );

  const startDrawing = useCallback(
    (e) => {
      pushUndo();
      isDrawingRef.current = true;
      doPaint(e);
    },
    [pushUndo, doPaint],
  );

  const stopDrawing = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0 || !canvasRef.current || !currentImageDataRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    redoStackRef.current = [
      ...redoStackRef.current,
      new ImageData(
        new Uint8ClampedArray(currentImageDataRef.current.data),
        currentImageDataRef.current.width,
        currentImageDataRef.current.height,
      ),
    ];
    const prev = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    currentImageDataRef.current = prev;
    ctx.putImageData(prev, 0, 0);
  }, []);

  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0 || !canvasRef.current || !currentImageDataRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    undoStackRef.current = [
      ...undoStackRef.current,
      new ImageData(
        new Uint8ClampedArray(currentImageDataRef.current.data),
        currentImageDataRef.current.width,
        currentImageDataRef.current.height,
      ),
    ];
    const next = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    currentImageDataRef.current = next;
    ctx.putImageData(next, 0, 0);
  }, []);

  const fitToScreen = useCallback(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const container = canvas.parentElement;
    if (!container) return;
    const scaleX = (container.clientWidth - 40) / canvas.width;
    const scaleY = (container.clientHeight - 40) / canvas.height;
    setZoom(Math.min(scaleX, scaleY, 1));
  }, []);

  const download = useCallback(
    (filename, override) => {
      const baseName = filename.replace(/\.[^.]+$/, '');
      const suffix = override?.suffix ?? '-nobg';

      const triggerDownload = (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + suffix + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      if (override?.blob) {
        triggerDownload(override.blob);
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.toBlob(triggerDownload, 'image/png');
    },
    [],
  );

  return {
    canvasRef,
    originalUrl,
    brushSize,
    setBrushSize,
    brushOpacity,
    setBrushOpacity,
    tool,
    setTool,
    viewMode,
    setViewMode,
    dimensions,
    zoom,
    setZoom,
    startDrawing,
    stopDrawing,
    doPaint,
    undo,
    redo,
    fitToScreen,
    download,
  };
}
