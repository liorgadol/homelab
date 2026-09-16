import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

describe('App state machine', () => {
  it('starts in upload mode', () => {
    render(<App />);
    expect(screen.getByTestId('upload-zone')).toBeInTheDocument();
  });

  it('shows processing spinner after file selected', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => new Promise(() => {}), // never resolves — stays in processing
    });

    render(<App />);
    const input = document.querySelector('input[type="file"]');
    const file = new File(['img'], 'test.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);

    expect(screen.getByTestId('processing-spinner')).toBeInTheDocument();
  });

  it('shows editor after successful processing', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    });

    render(<App />);
    const input = document.querySelector('input[type="file"]');
    const file = new File(['img'], 'test.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);

    await waitFor(() => {
      expect(screen.getByTestId('editor-container')).toBeInTheDocument();
    });
  });

  it('shows error and returns to upload on backend failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    render(<App />);
    const input = document.querySelector('input[type="file"]');
    const file = new File(['img'], 'test.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);

    await waitFor(() => {
      expect(screen.getByTestId('upload-zone')).toBeInTheDocument();
      expect(screen.getByText(/error|failed/i)).toBeInTheDocument();
    });
  });
});
