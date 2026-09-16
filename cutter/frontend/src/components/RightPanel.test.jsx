import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import RightPanel from './RightPanel';

function renderPanel(overrides = {}) {
  const defaults = {
    tool: 'erase', onToolChange: vi.fn(),
    brushSize: 20, onBrushSizeChange: vi.fn(),
    brushOpacity: 0.8, onBrushOpacityChange: vi.fn(),
    viewMode: 'result', onViewModeChange: vi.fn(),
    filename: 'cat.png', dimensions: { width: 800, height: 600 },
    onDownload: vi.fn(), onRerun: vi.fn(),
    bleedEnabled: false, onBleedEnabledChange: vi.fn(),
    bleedOffsetMm: 3.0, onBleedOffsetMmChange: vi.fn(),
    bleedLoading: false, bleedError: null,
  };
  return { props: { ...defaults, ...overrides }, ...render(<RightPanel {...defaults} {...overrides} />) };
}

describe('RightPanel Cut Outline', () => {
  it('renders the Cut Outline section with checkbox and slider', () => {
    renderPanel();
    expect(screen.getByText(/cut outline/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /add white bleed/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/offset/i)).toBeInTheDocument();
  });

  it('calls onBleedEnabledChange when checkbox is toggled', () => {
    const onBleedEnabledChange = vi.fn();
    renderPanel({ onBleedEnabledChange });
    fireEvent.click(screen.getByRole('checkbox', { name: /add white bleed/i }));
    expect(onBleedEnabledChange).toHaveBeenCalledWith(true);
  });

  it('calls onBleedOffsetMmChange with numeric mm value when slider moves', () => {
    const onBleedOffsetMmChange = vi.fn();
    renderPanel({ bleedEnabled: true, onBleedOffsetMmChange });
    const slider = screen.getByLabelText(/offset/i);
    fireEvent.change(slider, { target: { value: '5' } });
    expect(onBleedOffsetMmChange).toHaveBeenCalledWith(5);
  });

  it('shows a spinner when bleedLoading is true', () => {
    renderPanel({ bleedEnabled: true, bleedLoading: true });
    expect(screen.getByTestId('bleed-spinner')).toBeInTheDocument();
  });

  it('shows error message when bleedError is set', () => {
    renderPanel({ bleedEnabled: true, bleedError: 'Server error' });
    expect(screen.getByText(/server error/i)).toBeInTheDocument();
  });
});
