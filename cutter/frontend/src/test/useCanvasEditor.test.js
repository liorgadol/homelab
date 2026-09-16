import { renderHook, act } from '@testing-library/react';
import { useCanvasEditor } from '../hooks/useCanvasEditor';

global.URL.createObjectURL = vi.fn(() => 'blob:mock');
global.URL.revokeObjectURL = vi.fn();

function makeBlob() {
  return new Blob(['fake-png'], { type: 'image/png' });
}

describe('useCanvasEditor', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useCanvasEditor({ resultBlob: null, originalFile: null }));
    expect(result.current.brushSize).toBe(20);
    expect(result.current.brushOpacity).toBe(0.8);
    expect(result.current.tool).toBe('erase');
    expect(result.current.viewMode).toBe('result');
  });

  it('allows changing brushSize', () => {
    const { result } = renderHook(() => useCanvasEditor({ resultBlob: null, originalFile: null }));
    act(() => result.current.setBrushSize(40));
    expect(result.current.brushSize).toBe(40);
  });

  it('allows changing brushOpacity', () => {
    const { result } = renderHook(() => useCanvasEditor({ resultBlob: null, originalFile: null }));
    act(() => result.current.setBrushOpacity(0.5));
    expect(result.current.brushOpacity).toBe(0.5);
  });

  it('allows switching tool', () => {
    const { result } = renderHook(() => useCanvasEditor({ resultBlob: null, originalFile: null }));
    act(() => result.current.setTool('restore'));
    expect(result.current.tool).toBe('restore');
  });

  it('allows switching viewMode', () => {
    const { result } = renderHook(() => useCanvasEditor({ resultBlob: null, originalFile: null }));
    act(() => result.current.setViewMode('original'));
    expect(result.current.viewMode).toBe('original');
  });

  it('download calls canvas.toBlob', () => {
    const { result } = renderHook(() =>
      useCanvasEditor({ resultBlob: makeBlob(), originalFile: new File([], 'x.jpg') }),
    );
    const canvas = document.createElement('canvas');
    result.current.canvasRef.current = canvas;
    const toBlobSpy = vi.spyOn(canvas, 'toBlob');
    act(() => result.current.download('photo.jpg'));
    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  });
});
