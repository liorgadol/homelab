import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueueStrip from '../components/QueueStrip';

function makeItems() {
  return [
    { id: 'a', file: new File(['a'], 'a.jpg', { type: 'image/jpeg' }), status: 'waiting' },
    { id: 'b', file: new File(['b'], 'b.png', { type: 'image/png' }), status: 'processing' },
    { id: 'c', file: new File(['c'], 'c.webp', { type: 'image/webp' }), status: 'done' },
    { id: 'd', file: new File(['d'], 'd.jpg', { type: 'image/jpeg' }), status: 'error', error: 'boom' },
  ];
}

function renderStrip(overrides = {}) {
  const props = {
    items: makeItems(),
    selectedId: 'a',
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onRetry: vi.fn(),
    onAdd: vi.fn(),
    ...overrides,
  };
  const utils = render(<QueueStrip {...props} />);
  return { ...utils, props };
}

function itemFor(name) {
  return screen.getByRole('button', { name: `Select ${name}` }).closest('[data-testid="queue-item"]');
}

describe('QueueStrip', () => {
  beforeEach(() => {
    URL.createObjectURL.mockClear();
    URL.revokeObjectURL.mockClear();
  });

  it('renders one item per queue entry', () => {
    renderStrip();
    expect(screen.getAllByTestId('queue-item')).toHaveLength(4);
  });

  it('renders a status badge per item with the expected aria-label', () => {
    renderStrip();
    expect(within(itemFor('a.jpg')).getByRole('img', { name: 'waiting' })).toBeInTheDocument();
    expect(within(itemFor('b.png')).getByRole('img', { name: 'removing background' })).toBeInTheDocument();
    expect(within(itemFor('c.webp')).getByRole('img', { name: 'done' })).toBeInTheDocument();
    expect(within(itemFor('d.jpg')).getByRole('img', { name: 'failed' })).toBeInTheDocument();
  });

  it('shows an object-URL thumbnail for each item file', () => {
    renderStrip();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(4);
    const a = itemFor('a.jpg');
    expect(a.querySelector('img')).toHaveAttribute('src', 'blob:mock-url');
  });

  it('clicking a thumbnail calls onSelect with that item id', async () => {
    const { props } = renderStrip();
    await userEvent.click(screen.getByRole('button', { name: 'Select b.png' }));
    expect(props.onSelect).toHaveBeenCalledWith('b');
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it('clicking × calls onRemove with the id and not onSelect', async () => {
    const { props } = renderStrip();
    await userEvent.click(screen.getByRole('button', { name: 'Remove b.png' }));
    expect(props.onRemove).toHaveBeenCalledWith('b');
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('retry button appears only for items in error', () => {
    renderStrip();
    expect(screen.getByRole('button', { name: 'Retry d.jpg' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry a.jpg' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry b.png' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry c.webp' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Retry / })).toHaveLength(1);
  });

  it('clicking retry calls onRetry with the id and not onSelect', async () => {
    const { props } = renderStrip();
    await userEvent.click(screen.getByRole('button', { name: 'Retry d.jpg' }));
    expect(props.onRetry).toHaveBeenCalledWith('d');
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it('marks only the selected item with aria-current="true"', () => {
    renderStrip({ selectedId: 'c' });
    const current = document.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName('Select c.webp');
    expect(screen.getByRole('button', { name: 'Select a.jpg' })).not.toHaveAttribute('aria-current');
  });

  it('has a hidden multiple file input that calls onAdd with a File array', async () => {
    const { props } = renderStrip();
    const input = screen.getByTestId('queue-add-input');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('multiple');
    const files = [
      new File(['x'], 'x.jpg', { type: 'image/jpeg' }),
      new File(['y'], 'y.png', { type: 'image/png' }),
    ];
    await userEvent.upload(input, files);
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(props.onAdd).toHaveBeenCalledWith(files);
  });

  it('+ Add button is present', () => {
    renderStrip();
    expect(screen.getByRole('button', { name: '+ Add' })).toBeInTheDocument();
  });

  it('revokes thumbnail object URLs on unmount', () => {
    const { unmount } = renderStrip();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('revokes the old thumbnail URL when an item file changes', () => {
    URL.createObjectURL.mockClear();
    URL.createObjectURL.mockImplementation(() => 'blob:first');
    const items = makeItems();
    const { rerender, props } = renderStrip({ items });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(4);

    URL.createObjectURL.mockImplementation(() => 'blob:second');
    const replaced = [
      { ...items[0], file: new File(['z'], 'a.jpg', { type: 'image/jpeg' }) },
      ...items.slice(1),
    ];
    rerender(<QueueStrip {...props} items={replaced} />);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(5);
    URL.createObjectURL.mockImplementation(() => 'blob:mock-url');
  });
});
