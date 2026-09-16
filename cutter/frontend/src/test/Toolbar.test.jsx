import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Toolbar from '../components/Toolbar';

const defaultProps = {
  tool: 'erase',
  onToolChange: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onFitToScreen: vi.fn(),
  onToggleView: vi.fn(),
};

describe('Toolbar', () => {
  it('renders all tool buttons', () => {
    render(<Toolbar {...defaultProps} />);
    expect(screen.getByTitle('Erase')).toBeInTheDocument();
    expect(screen.getByTitle('Restore')).toBeInTheDocument();
    expect(screen.getByTitle('Undo')).toBeInTheDocument();
    expect(screen.getByTitle('Redo')).toBeInTheDocument();
    expect(screen.getByTitle('Fit to screen')).toBeInTheDocument();
    expect(screen.getByTitle('Toggle before/after')).toBeInTheDocument();
  });

  it('highlights the active tool', () => {
    render(<Toolbar {...defaultProps} tool="restore" />);
    expect(screen.getByTitle('Restore').closest('button')).toHaveClass('active');
    expect(screen.getByTitle('Erase').closest('button')).not.toHaveClass('active');
  });

  it('calls onToolChange with erase when erase button clicked', () => {
    const onToolChange = vi.fn();
    render(<Toolbar {...defaultProps} onToolChange={onToolChange} />);
    fireEvent.click(screen.getByTitle('Erase').closest('button'));
    expect(onToolChange).toHaveBeenCalledWith('erase');
  });

  it('calls onUndo when undo clicked', () => {
    const onUndo = vi.fn();
    render(<Toolbar {...defaultProps} onUndo={onUndo} />);
    fireEvent.click(screen.getByTitle('Undo').closest('button'));
    expect(onUndo).toHaveBeenCalled();
  });
});
