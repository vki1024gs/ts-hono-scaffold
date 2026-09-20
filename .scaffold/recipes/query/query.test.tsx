import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { HomePage, queryClient } from '../src/pages/HomePage';
import { api, ApiError } from '../src/api';
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});
test('query recipe loads and invalidates after a write without a UI library', async () => {
  const list = vi
    .spyOn(api.items, 'list')
    .mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      hasMore: false,
    });
  vi.spyOn(api.items, 'create').mockResolvedValue({
    id: 'one',
    name: 'Alpha',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  render(<HomePage />);
  await screen.findByText('No items yet.');
  fireEvent.change(screen.getByLabelText('New item'), {
    target: { value: 'Alpha' },
  });
  fireEvent.click(screen.getByText('Add item'));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
});
test('read retries exclude 4xx and mutation retries are disabled', () => {
  const options = queryClient.getDefaultOptions();
  const retry = options.queries?.retry;
  if (typeof retry !== 'function')
    throw Error('Expected explicit retry policy');
  expect(retry(0, new ApiError(403, 'FORBIDDEN', 'Denied'))).toBe(false);
  expect(retry(0, new ApiError(500, 'INTERNAL', 'Failed'))).toBe(true);
  expect(retry(1, new Error('Network'))).toBe(false);
  expect(options.mutations?.retry).toBe(false);
});
