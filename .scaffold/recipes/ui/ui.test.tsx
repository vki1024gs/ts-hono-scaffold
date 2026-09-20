import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { HomePage } from '../src/pages/HomePage';
import { api } from '../src/api';
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const computedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element) => computedStyle(element);
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});
test('table recipe independently loads data and forwards search into URL and contract query', async () => {
  const list = vi
    .spyOn(api.items, 'list')
    .mockResolvedValue({
      items: [
        { id: 'one', name: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      total: 1,
      page: 1,
      limit: 10,
      hasMore: false,
    });
  render(<HomePage />);
  await screen.findByText('Alpha');
  fireEvent.change(screen.getByLabelText('Search items'), {
    target: { value: 'Beta' },
  });
  fireEvent.keyDown(screen.getByLabelText('Search items'), {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
  });
  await waitFor(() => expect(window.location.search).toContain('search=Beta'));
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'Beta' }),
      expect.any(AbortSignal),
    ),
  );
});
