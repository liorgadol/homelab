import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import RightPanel from '../components/RightPanel';

const defaultProps = {
  tool: 'erase',
  onToolChange: vi.fn(),
  brushSize: 20,
  onBrushSizeChange: vi.fn(),
  brushOpacity: 0.8,
  onBrushOpacityChange: vi.fn(),
  viewMode: 'result',
  onViewModeChange: vi.fn(),
  filename: 'photo.jpg',
  dimensions: { width: 1200, height: 1600 },
  onDownload: vi.fn(),
  onRerun: vi.fn(),
};

describe('RightPanel', () => {
  it('renders brush size slider', () => {
    render(<RightPanel {...defaultProps} />);
    expect(screen.getByLabelText(/brush size/i)).toBeInTheDocument();
  });

  it('renders brush opacity slider', () => {
    render(<RightPanel {...defaultProps} />);
    expect(screen.getByLabelText(/opacity/i)).toBeInTheDocument();
  });

  it('calls onBrushSizeChange when slider changes', () => {
    const onBrushSizeChange = vi.fn();
    render(<RightPanel {...defaultProps} onBrushSizeChange={onBrushSizeChange} />);
    fireEvent.change(screen.getByLabelText(/brush size/i), { target: { value: '40' } });
    expect(onBrushSizeChange).toHaveBeenCalledWith(40);
  });

  it('calls onDownload when download button clicked', () => {
    const onDownload = vi.fn();
    render(<RightPanel {...defaultProps} onDownload={onDownload} />);
    fireEvent.click(screen.getByText(/download png/i));
    expect(onDownload).toHaveBeenCalled();
  });

  it('shows dimensions', () => {
    render(<RightPanel {...defaultProps} />);
    expect(screen.getByText(/1200.*1600|1200 × 1600/i)).toBeInTheDocument();
  });

  it('highlights the active view mode tab', () => {
    render(<RightPanel {...defaultProps} viewMode="original" />);
    expect(screen.getByText('Original').closest('button')).toHaveClass('active');
  });
});
