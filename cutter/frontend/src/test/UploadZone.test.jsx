import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadZone from '../components/UploadZone';

describe('UploadZone', () => {
  it('renders upload prompt', () => {
    render(<UploadZone onFiles={() => {}} />);
    expect(screen.getByText(/drag.*drop|click.*browse/i)).toBeInTheDocument();
  });

  it('file input accepts multiple files', () => {
    render(<UploadZone onFiles={() => {}} />);
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('multiple');
  });

  it('calls onFiles with an array when a file is selected via input', async () => {
    const onFiles = vi.fn();
    render(<UploadZone onFiles={onFiles} />);
    const input = document.querySelector('input[type="file"]');
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('calls onFiles with all selected files when several are chosen via input', async () => {
    const onFiles = vi.fn();
    render(<UploadZone onFiles={onFiles} />);
    const input = document.querySelector('input[type="file"]');
    const files = [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ];
    await userEvent.upload(input, files);
    expect(onFiles).toHaveBeenCalledWith(files);
  });

  it('calls onFiles with an array when a file is dropped', () => {
    const onFiles = vi.fn();
    render(<UploadZone onFiles={onFiles} />);
    const zone = screen.getByTestId('upload-zone');
    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    fireEvent.drop(zone, {
      dataTransfer: { files: [file], types: ['Files'] },
    });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('passes all dropped files (3 files -> array of 3) and leaves filtering to useQueue', () => {
    const onFiles = vi.fn();
    render(<UploadZone onFiles={onFiles} />);
    const zone = screen.getByTestId('upload-zone');
    const files = [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
      new File(['c'], 'c.webp', { type: 'image/webp' }),
    ];
    fireEvent.drop(zone, {
      dataTransfer: { files, types: ['Files'] },
    });
    expect(onFiles).toHaveBeenCalledTimes(1);
    const arg = onFiles.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
    expect(arg).toHaveLength(3);
    expect(arg).toEqual(files);
  });

  it('does not filter non-image files in the zone (useQueue filters)', () => {
    const onFiles = vi.fn();
    render(<UploadZone onFiles={onFiles} />);
    const zone = screen.getByTestId('upload-zone');
    const file = new File(['text'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.drop(zone, {
      dataTransfer: { files: [file], types: ['Files'] },
    });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('applies drag-over class on dragover and removes on dragleave', () => {
    render(<UploadZone onFiles={() => {}} />);
    const zone = screen.getByTestId('upload-zone');
    fireEvent.dragOver(zone);
    expect(zone).toHaveClass('drag-over');
    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveClass('drag-over');
  });
});
