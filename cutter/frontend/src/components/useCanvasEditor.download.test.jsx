import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useCanvasEditor } from '../hooks/useCanvasEditor';
import { useEffect } from 'react';

function Harness({ onReady, resultBlob }) {
  const editor = useCanvasEditor({ resultBlob, originalFile: { name: 'cat.png' } });
  useEffect(() => { onReady(editor); }, [editor, onReady]);
  return <canvas ref={editor.canvasRef} />;
}

describe('useCanvasEditor.download override', () => {
  it('downloads provided blob with custom suffix when override passed', async () => {
    let api;
    const blob = new Blob(['x'], { type: 'image/png' });
    render(<Harness resultBlob={new Blob(['y'], { type: 'image/png' })} onReady={(e) => { api = e; }} />);

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await act(async () => {
      api.download('cat.png', { blob, suffix: '-bleed-3_0mm' });
    });
    const anchor = clickSpy.mock.instances[0];
    expect(anchor.download).toBe('cat-bleed-3_0mm.png');
    clickSpy.mockRestore();
  });
});
