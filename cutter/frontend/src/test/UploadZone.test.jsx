import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadZone from '../components/UploadZone';

describe('UploadZone', () => {
  it('renders upload prompt', () => {
    render(<UploadZone onFile={() => {}} />);
    expect(screen.getByText(/drag.*drop|click.*browse/i)).toBeInTheDocument();
  });

  it('calls onFile when a file is selected via input', async () => {
    const onFile = vi.fn();
    render(<UploadZone onFile={onFile} />);
    const input = document.querySelector('input[type="file"]');
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('calls onFile when a file is dropped', () => {
    const onFile = vi.fn();
    render(<UploadZone onFile={onFile} />);
    const zone = screen.getByTestId('upload-zone');
    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    fireEvent.drop(zone, {
      dataTransfer: { files: [file], types: ['Files'] },
    });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('ignores non-image files', () => {
    const onFile = vi.fn();
    render(<UploadZone onFile={onFile} />);
    const zone = screen.getByTestId('upload-zone');
    const file = new File(['text'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.drop(zone, {
      dataTransfer: { files: [file], types: ['Files'] },
    });
    expect(onFile).not.toHaveBeenCalled();
  });

  it('applies drag-over class on dragover and removes on dragleave', () => {
    render(<UploadZone onFile={() => {}} />);
    const zone = screen.getByTestId('upload-zone');
    fireEvent.dragOver(zone);
    expect(zone).toHaveClass('drag-over');
    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveClass('drag-over');
  });
});
